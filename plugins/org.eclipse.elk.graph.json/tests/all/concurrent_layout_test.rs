//! Hosts lay graphs out on many threads of one process (Node.js and Bun workers share one
//! native addon). Layouts running at once must neither block each other forever nor see
//! each other's state: every thread must produce exactly the single-threaded result.

use std::path::Path;
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use org_eclipse_elk_graph_json::org::eclipse::elk::graph::json::layout_api;

const THREADS: usize = 8;
const ROUNDS: usize = 2;
/// Far above what the layouts take even in a debug build; a thread still busy after this
/// is blocked or spinning.
const DEADLINE: Duration = Duration::from_secs(300);

/// `(name, graph json, options json)` for every archboard fixture.
fn fixtures() -> Vec<(String, String, String)> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/archboard");
    let mut out = Vec::new();
    for group in ["focused", "frame", "nested", "routing"] {
        let mut paths: Vec<_> = std::fs::read_dir(root.join(group))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                let name = path.file_name().unwrap().to_string_lossy();
                name.ends_with(".json") && !name.ends_with(".elkjs.json")
            })
            .collect();
        paths.sort();
        for path in paths {
            let input: Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            out.push((
                format!("{group}/{}", path.file_name().unwrap().to_string_lossy()),
                serde_json::to_string(&input["graph"]).unwrap(),
                serde_json::to_string(&input["layoutOptions"]).unwrap(),
            ));
        }
    }
    assert!(!out.is_empty(), "no fixtures under {}", root.display());
    out
}

#[test]
fn layouts_on_many_threads_at_once_match_the_single_threaded_result() {
    let fixtures = Arc::new(fixtures());
    let expected: Arc<Vec<String>> = Arc::new(
        fixtures
            .iter()
            .map(|(name, graph, options)| {
                layout_api::layout_json(graph, options)
                    .unwrap_or_else(|err| panic!("{name}: {err}"))
            })
            .collect(),
    );

    let (sender, receiver) = mpsc::channel::<Vec<String>>();
    for index in 0..THREADS {
        let (fixtures, expected, sender) = (fixtures.clone(), expected.clone(), sender.clone());
        thread::Builder::new()
            .name(format!("concurrent layout {index}"))
            .spawn(move || {
                let mut mismatches = Vec::new();
                let count = fixtures.len();
                // Each thread starts at a different fixture so different graphs overlap.
                for step in 0..count * ROUNDS {
                    let at = (step + index * count / THREADS) % count;
                    let (name, graph, options) = &fixtures[at];
                    match layout_api::layout_json(graph, options) {
                        Ok(output) if output == expected[at] => {}
                        Ok(_) => {
                            mismatches.push(format!("{name}: output differs from single-threaded"))
                        }
                        Err(err) => mismatches.push(format!("{name}: {err}")),
                    }
                }
                let _ = sender.send(mismatches);
            })
            .unwrap();
    }
    drop(sender);

    let started = Instant::now();
    let mut mismatches = Vec::new();
    for _ in 0..THREADS {
        let left = DEADLINE.saturating_sub(started.elapsed());
        match receiver.recv_timeout(left) {
            Ok(found) => mismatches.extend(found),
            Err(err) => panic!("a layout thread did not finish within {DEADLINE:?}: {err}"),
        }
    }
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}
