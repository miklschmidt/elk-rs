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

/// Run `read` on this thread's copy of value `id`, refreshing it from `current` when its
/// generation is stale. Not generic, so each `ReadMostly::read` instantiation stays small.
fn with_snapshot(
    id: usize,
    generation: &AtomicUsize,
    current: &dyn Fn() -> (usize, Arc<dyn Any + Send + Sync>),
    read: &mut dyn FnMut(&(dyn Any + Send + Sync)),
) {
    let generation = generation.load(Ordering::Acquire);
    SNAPSHOTS.with(|snapshots| {
        {
            let snapshots = snapshots.borrow();
            if let Some((_, seen, value)) = snapshots.iter().find(|(seen_id, _, _)| *seen_id == id)
            {
                if *seen == generation {
                    // Read through this thread's own `Arc` without cloning it: a clone would
                    // write the reference count that every thread's copy shares.
                    read(value.as_ref());
                    return;
                }
            }
        }
        let (generation, value) = current();
        match snapshots.try_borrow_mut() {
            Ok(mut copies) => {
                copies.retain(|(seen_id, _, _)| *seen_id != id);
                copies.push((id, generation, value));
                drop(copies);
                let copies = snapshots.borrow();
                let (_, _, value) = copies.last().expect("the copy just stored");
                read(value.as_ref());
            }
            // Nested in a read that holds this thread's copies: read the value directly.
            Err(_) => read(value.as_ref()),
        }
    });
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
    ///
    /// Without threads (WASM without atomics) nothing can contend, and cloning the `Arc` under
    /// the uncontended lock is cheaper than the per-thread copies.
    #[cfg(all(target_arch = "wasm32", not(target_feature = "atomics")))]
    #[inline]
    pub fn read<R>(&self, read: impl FnOnce(&T) -> R) -> R {
        let current = self.current.lock().clone();
        read(&current)
    }

    /// Run `read` on the current value.
    #[cfg(not(all(target_arch = "wasm32", not(target_feature = "atomics"))))]
    #[inline]
    pub fn read<R>(&self, read: impl FnOnce(&T) -> R) -> R {
        let mut read = Some(read);
        let mut result = None;
        with_snapshot(
            self.id,
            &self.generation,
            &self.current_any(),
            &mut |value| {
                let value = value
                    .downcast_ref::<T>()
                    .expect("snapshot holds the value's type");
                let read = read.take().expect("read runs once");
                result = Some(read(value));
            },
        );
        result.expect("read ran")
    }

    /// The current value, for a thread whose copy is stale.
    fn current_any(&self) -> impl Fn() -> (usize, Arc<dyn Any + Send + Sync>) + '_ {
        move || {
            let current = self.current.lock();
            // The generation is read under the lock, so it belongs to this value.
            let value: Arc<dyn Any + Send + Sync> = current.clone();
            (self.generation.load(Ordering::Acquire), value)
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
