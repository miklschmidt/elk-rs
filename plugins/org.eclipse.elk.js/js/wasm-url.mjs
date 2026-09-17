/**
 * The URL of elk-rs's WASM binary, for a page that compiles it once and hands
 * the module to its `@archboard/elk-rs/worker.browser` workers. Bundlers emit
 * the binary as an asset and rewrite this URL to it.
 */
export default new URL('../dist/wasm/org_eclipse_elk_wasm_bg.wasm', import.meta.url).href;
