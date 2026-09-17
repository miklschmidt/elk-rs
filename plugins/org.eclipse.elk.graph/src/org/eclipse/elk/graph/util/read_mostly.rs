//! Process-wide data that is written while registering and read on every layout.

use std::any::Any;
use std::cell::RefCell;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use super::elk_mutex::Mutex;

static NEXT_ID: AtomicUsize = AtomicUsize::new(1);

/// A thread's copy of one `ReadMostly` value: (id, generation, value).
type Snapshot = (usize, usize, Arc<dyn Any + Send + Sync>);

thread_local! {
    static SNAPSHOTS: RefCell<Vec<Snapshot>> =
        const { RefCell::new(Vec::new()) };
}

/// A value shared by every thread, replaced as a whole by writers and read without locking.
///
/// Layouts running on several threads at once read registries (option metadata, clone
/// functions) many times per layout. Behind a plain mutex those reads serialize every thread;
/// even a reader-writer lock or an `Arc` clone per read writes to memory shared by all threads.
/// Here each thread keeps its own `Arc` of the current value and a read only loads an atomic
/// generation counter to check that its copy is current. A write copies the value if a reader
/// still holds it, updates it and bumps the generation.
pub struct ReadMostly<T> {
    id: usize,
    generation: AtomicUsize,
    current: Mutex<Arc<T>>,
}

impl<T: Clone + Send + Sync + 'static> ReadMostly<T> {
    pub fn new(value: T) -> Self {
        ReadMostly {
            id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
            generation: AtomicUsize::new(0),
            current: Mutex::new(Arc::new(value)),
        }
    }

    /// Run `read` on the current value.
    pub fn read<R>(&self, read: impl FnOnce(&T) -> R) -> R {
        let generation = self.generation.load(Ordering::Acquire);
        SNAPSHOTS.with(|snapshots| {
            let current = snapshots
                .borrow()
                .iter()
                .any(|(id, seen, _)| *id == self.id && *seen == generation);
            if !current {
                if let Some(value) = self.refresh(snapshots) {
                    // Nested in a read that holds this thread's copies: read the value directly.
                    let value = value.downcast_ref::<T>().expect("snapshot holds the value's type");
                    return read(value);
                }
            }
            // Read through this thread's own `Arc` without cloning it: a clone would write the
            // reference count that every thread's copy shares.
            let snapshots = snapshots.borrow();
            let (_, _, value) = snapshots
                .iter()
                .find(|(id, _, _)| *id == self.id)
                .expect("this thread's copy");
            read(value.downcast_ref::<T>().expect("snapshot holds the value's type"))
        })
    }

    /// Replace this thread's copy with the current value. Returns the value instead when the
    /// copies are borrowed by an enclosing read on this thread.
    fn refresh(
        &self,
        snapshots: &RefCell<Vec<Snapshot>>,
    ) -> Option<Arc<dyn Any + Send + Sync>> {
        let (generation, value) = {
            let current = self.current.lock();
            // The generation is read under the lock, so it belongs to this value.
            let value: Arc<dyn Any + Send + Sync> = current.clone();
            (self.generation.load(Ordering::Acquire), value)
        };
        match snapshots.try_borrow_mut() {
            Ok(mut snapshots) => {
                snapshots.retain(|(id, _, _)| *id != self.id);
                snapshots.push((self.id, generation, value));
                None
            }
            Err(_) => Some(value),
        }
    }

    /// A number that changes whenever the value does, for caches derived from it.
    pub fn generation(&self) -> usize {
        self.generation.load(Ordering::Acquire)
    }

    /// Update the value; readers see the update on their next read.
    pub fn update<R>(&self, update: impl FnOnce(&mut T) -> R) -> R {
        let mut current = self.current.lock();
        let result = update(Arc::make_mut(&mut current));
        self.generation.fetch_add(1, Ordering::AcqRel);
        result
    }
}
