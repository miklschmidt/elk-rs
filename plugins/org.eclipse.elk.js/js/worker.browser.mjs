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
 *
 * A pool of workers can share one compiled module: compile it once on the page
 * and send it as the first message, `{ cmd: 'init', module }`, before any other.
 *
 *   import wasmUrl from '@archboard/elk-rs/wasm-url';
 *   const module = await WebAssembly.compileStreaming(fetch(wasmUrl));
 *   const elk = new ELK({
 *     workerFactory: () => {
 *       const worker = new ElkWorker();
 *       worker.postMessage({ cmd: 'init', module });
 *       return worker;
 *     },
 *   });
 *
 * A worker that receives no module compiles its own from the binary next to it,
 * when the first command that needs it arrives.
 */
import init, {
  known_layout_algorithms,
  known_layout_categories,
  known_layout_options,
  layout_json,
  reset_instance,
  take_last_layout_panic,
} from '../dist/wasm/org_eclipse_elk_wasm.js';

/** The instantiation every command waits for, started by the first message that needs it. */
let ready = null;

function instantiate(moduleOrPath) {
  if (!ready) {
    ready = init({ module_or_path: moduleOrPath });
  }
  return ready;
}

function ownBinary() {
  // Spelled out here so that bundlers emit the binary next to this worker.
  return new URL('../dist/wasm/org_eclipse_elk_wasm_bg.wasm', import.meta.url);
}

function handleCommand(msg) {
  switch (msg.cmd) {
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
 * memory may be inconsistent, so it is replaced before the next command, from
 * the module this worker was instantiated from (shared or its own).
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

/** Answer a message; one without an id (such as a page's own init message) gets no answer. */
function reply(msg, answer) {
  if (msg.id !== undefined) {
    self.postMessage({ id: msg.id, ...answer });
  }
}

self.onmessage = (event) => {
  const msg = event.data;

  if (msg.cmd === 'register') {
    // Every algorithm is built in; this needs no instance, so it starts no compile.
    reply(msg, { data: null });
    return;
  }

  // A module that arrives after instantiation has started is not needed any more.
  const started = msg.cmd === 'init' && msg.module ? instantiate(msg.module) : instantiate(ownBinary());
  started.then(
    () => {
      if (msg.cmd === 'init') {
        reply(msg, { data: null });
        return;
      }
      let data;
      try {
        data = handleCommand(msg);
      } catch (err) {
        reply(msg, { error: { message: failureMessage(err) } });
        return;
      }
      reply(msg, { data });
    },
    (err) => reply(msg, { error: { message: failureMessage(err) } }),
  );
};
