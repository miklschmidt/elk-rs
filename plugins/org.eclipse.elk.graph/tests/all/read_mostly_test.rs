use std::sync::{Arc, Barrier};
use std::thread;

use org_eclipse_elk_graph::org::eclipse::elk::graph::util::read_mostly::ReadMostly;

#[test]
fn a_thread_reads_an_update_made_after_its_last_read() {
    let value = ReadMostly::new(vec![1]);
    assert_eq!(value.read(|v| v.clone()), vec![1]);
    value.update(|v| v.push(2));
    assert_eq!(value.read(|v| v.clone()), vec![1, 2]);
}

#[test]
fn every_thread_reads_updates_made_on_another_thread() {
    let value = Arc::new(ReadMostly::new(0usize));
    let threads = 8;
    let rounds = 200;
    let barrier = Arc::new(Barrier::new(threads + 1));
    let readers: Vec<_> = (0..threads)
        .map(|_| {
            let (value, barrier) = (value.clone(), barrier.clone());
            thread::spawn(move || {
                let mut last = value.read(|v| *v);
                barrier.wait();
                while last < rounds {
                    let now = value.read(|v| *v);
                    assert!(now >= last, "a read went back from {last} to {now}");
                    last = now;
                }
            })
        })
        .collect();
    barrier.wait();
    for _ in 0..rounds {
        value.update(|v| *v += 1);
    }
    for reader in readers {
        reader.join().unwrap();
    }
    assert_eq!(value.read(|v| *v), rounds);
}

#[test]
fn a_read_nested_in_a_read_sees_an_update_made_in_between() {
    let outer = ReadMostly::new(1);
    let inner = Arc::new(ReadMostly::new(10));
    let seen = outer.read(|o| {
        inner.update(|i| *i = 20);
        // The inner value's copy must be refreshed while the outer read holds this thread's copies.
        *o + inner.read(|i| *i)
    });
    assert_eq!(seen, 21);
    assert_eq!(inner.read(|i| *i), 20);
}
