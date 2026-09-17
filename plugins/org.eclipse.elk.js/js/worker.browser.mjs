/**
 * elk-rs module Web Worker for browsers and bundlers.
 *
 * An ES module with no Node.js dependencies: it instantiates the WASM build and
 * answers elkjs's worker message protocol, so `elk-api.js` drives it as it
 * drives elkjs's worker. With Vite:
 *
 *   import ELK from '@archboard/elk-rs/js/elk-api.js';
 *   import ElkWorker from '@archboard/elk-rs/worker.browser?worker';
 *   const elk = new ELK({ workerFactory: () => new ElkWorker() });
 */
import init, {
  known_layout_algorithms,
  known_layout_categories,
  known_layout_options,
  layout_json,
  reset_instance,
  take_last_layout_panic,
} from '../dist/wasm/org_eclipse_elk_wasm.js';

// Spelled out here so that bundlers emit the binary next to this worker.
const ready = init({
  module_or_path: new URL('../dist/wasm/org_eclipse_elk_wasm_bg.wasm', import.meta.url),
});

function handleCommand(msg) {
  switch (msg.cmd) {
    case 'register':
      // Every algorithm is built in.
      return null;
    case 'layout':
      return JSON.parse(layout_json(JSON.stringify(msg.graph), JSON.stringify(msg.layoutOptions || {})));
    case 'algorithms':
      return JSON.parse(known_layout_algorithms());
    case 'options':
      return JSON.parse(known_layout_options());
    case 'categories':
      return JSON.parse(known_layout_categories());
    default:
      throw new Error('Unknown command: ' + msg.cmd);
  }
}

/**
 * The message of a failed command. A Rust panic aborts on WASM: the call traps,
 * the panic's message is kept for `take_last_layout_panic`, and the instance's
 * memory may be inconsistent, so it is replaced before the next command.
 */
function failureMessage(err) {
  if (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError) {
    let message = null;
    try { message = take_last_layout_panic(); } catch (e) { /* trapped instance */ }
    reset_instance();
    return message || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

self.onmessage = (event) => {
  const msg = event.data;
  ready.then(
    () => {
      let data;
      try {
        data = handleCommand(msg);
      } catch (err) {
        self.postMessage({ id: msg.id, error: { message: failureMessage(err) } });
        return;
      }
      self.postMessage({ id: msg.id, data });
    },
    (err) => self.postMessage({ id: msg.id, error: { message: failureMessage(err) } }),
  );
};
