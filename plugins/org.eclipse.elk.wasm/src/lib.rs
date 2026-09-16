use wasm_bindgen::prelude::*;

use org_eclipse_elk_graph_json::org::eclipse::elk::graph::json::layout_api;

/// Run ELK layout on a JSON graph string.
///
/// - `graph_json`: ELK graph in JSON format
/// - `options_json`: global layout options as JSON object (merged as defaults)
///
/// Returns the laid-out graph as a JSON string.
///
/// On `wasm32-unknown-unknown` a panic aborts, so a layout error raised as a
/// panic traps (a `WebAssembly.RuntimeError` in JS) instead of returning.
/// Its message is kept: read it with `take_last_layout_panic`, then discard
/// this instance, whose memory the trap may have left inconsistent.
#[wasm_bindgen]
pub fn layout_json(graph_json: &str, options_json: &str) -> Result<String, JsError> {
    layout_api::layout_json(graph_json, options_json).map_err(|e| JsError::new(&e))
}

/// The error message of the last layout that trapped, if any.
#[wasm_bindgen]
pub fn take_last_layout_panic() -> Option<String> {
    layout_api::take_last_layout_panic()
}

/// Return all registered layout algorithms as a JSON array string.
#[wasm_bindgen]
pub fn known_layout_algorithms() -> Result<String, JsError> {
    layout_api::known_layout_algorithms().map_err(|e| JsError::new(&e))
}

/// Return all registered layout options as a JSON array string.
#[wasm_bindgen]
pub fn known_layout_options() -> Result<String, JsError> {
    layout_api::known_layout_options().map_err(|e| JsError::new(&e))
}

/// Return all registered layout categories as a JSON array string.
#[wasm_bindgen]
pub fn known_layout_categories() -> Result<String, JsError> {
    layout_api::known_layout_categories().map_err(|e| JsError::new(&e))
}
