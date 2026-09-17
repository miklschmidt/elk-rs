//! Parity with the elkjs build archboard lays its boards out with.
//!
//! Each fixture under `tests/fixtures/archboard/<group>/<id>.json` is
//! `{ graph, layoutOptions }` exactly as archboard passes it to
//! `elk.layout(graph, { layoutOptions })`; `<id>.elkjs.json` is what elkjs
//! 0.12.0, with archboard's interactive-layout patch, returned for it.
//! Coordinates must match exactly.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde_json::Value;

use org_eclipse_elk_graph_json::org::eclipse::elk::graph::json::layout_api;

/// elkjs lays every fixture out in milliseconds; a layout still running after this never returns.
const LAYOUT_TIMEOUT: Duration = Duration::from_secs(60);

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/archboard")
}

fn read_json(path: &Path) -> Value {
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|err| panic!("{}: {err}", path.display()))
}

/// Lay one fixture out on elk-rs, failing instead of hanging when the layout does not return.
fn solve(group: &str, id: &str) -> Result<Value, String> {
    let input = read_json(&fixture_dir().join(group).join(format!("{id}.json")));
    let graph = serde_json::to_string(&input["graph"]).unwrap();
    let options = serde_json::to_string(&input["layoutOptions"]).unwrap();
    let (sender, receiver) = mpsc::channel();
    thread::Builder::new()
        .name(format!("layout {group}/{id}"))
        .spawn(move || {
            let _ = sender.send(layout_api::layout_json(&graph, &options));
        })
        .unwrap();
    match receiver.recv_timeout(LAYOUT_TIMEOUT) {
        Ok(result) => result.map(|out| serde_json::from_str(&out).expect("layout output json")),
        Err(_) => Err(format!("did not return within {LAYOUT_TIMEOUT:?}")),
    }
}

/// Every place the two graphs differ, ignoring echoed layout options and elkjs-internal keys.
fn differences(reference: &Value, candidate: &Value, path: &str, out: &mut Vec<String>) {
    match (reference, candidate) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            if a != b {
                out.push(format!("{path}: elkjs {a} vs elk-rs {b}"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            let mut keys: Vec<&String> = a.keys().chain(b.keys()).collect();
            keys.sort();
            keys.dedup();
            for key in keys {
                if key == "layoutOptions" || key.starts_with('$') {
                    continue;
                }
                let child = format!("{path}.{key}");
                match (a.get(key), b.get(key)) {
                    (Some(x), Some(y)) => differences(x, y, &child, out),
                    (x, y) => out.push(format!("{child}: elkjs {x:?} vs elk-rs {y:?}")),
                }
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                out.push(format!("{path}: elkjs has {} items, elk-rs {}", a.len(), b.len()));
            }
            for (index, (x, y)) in a.iter().zip(b.iter()).enumerate() {
                differences(x, y, &format!("{path}.{index}"), out);
            }
        }
        (a, b) => {
            if a != b {
                out.push(format!("{path}: elkjs {a} vs elk-rs {b}"));
            }
        }
    }
}

fn assert_parity(group: &str, ids: &[&str]) {
    let mut failures = Vec::new();
    for id in ids {
        match solve(group, id) {
            Ok(candidate) => {
                let expected = read_json(&fixture_dir().join(group).join(format!("{id}.elkjs.json")));
                let mut out = Vec::new();
                differences(&expected, &candidate, "", &mut out);
                if !out.is_empty() {
                    let count = out.len();
                    out.truncate(6);
                    failures.push(format!("{group}/{id} ({count} differences):\n  {}", out.join("\n  ")));
                }
            }
            Err(message) => failures.push(format!("{group}/{id}: {message}")),
        }
    }
    assert!(failures.is_empty(), "differs from elkjs:\n{}", failures.join("\n"));
}

/// A port of a compound node that no edge inside the node uses is placed below the ports that
/// are, not at the top of the node.
#[test]
fn compound_node_port_without_inner_edges_follows_the_other_ports() {
    assert_parity("focused", &["compound-port-without-inner-edges"]);
}
