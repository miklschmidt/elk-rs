'use strict';

/**
 * elk-rs Worker script — runs in Web Worker or Node.js/Bun worker_threads.
 *
 * Loads a backend and handles the elkjs-compatible message protocol.
 * Also exports a `Worker` class for in-process use (like elkjs's fake worker).
 *
 * Loading this file on a main thread (Node.js, Bun or a browser window)
 * installs no message handler: only the `Worker` export is meant for use there.
 */

// --- Where this script runs ---

/** The parent port when this script runs in a Node.js or Bun worker thread, else null. */
function workerThreadParentPort() {
  try {
    var wt = require('worker_threads');
    if (!wt.isMainThread && wt.parentPort) {
      return wt.parentPort;
    }
  } catch (e) { /* not Node.js or Bun */ }
  return null;
}

/**
 * Whether this script runs in a Web Worker. Bun's main thread also exposes
 * `self.postMessage` without a `window`, so only a real worker global scope counts.
 */
function isWebWorkerScope() {
  if (typeof Bun !== 'undefined' && Bun.isMainThread) {
    return false;
  }
  return typeof WorkerGlobalScope !== 'undefined'
    && typeof self !== 'undefined'
    && self instanceof WorkerGlobalScope;
}

// --- In-process (fake) Worker for Node.js direct use ---

function FakeWorker() {
  this._backend = null;
  this._initPromise = null;
}

FakeWorker.prototype._ensureBackend = function() {
  if (this._backend) return Promise.resolve(this._backend);
  if (this._initPromise) return this._initPromise;

  var self = this;
  this._initPromise = new Promise(function(resolve, reject) {
    try {
      self._backend = require('./backend-node.js').loadBackend();
      resolve(self._backend);
    } catch (err) {
      reject(err);
    }
  });
  return this._initPromise;
};

FakeWorker.prototype.postMessage = function(msg) {
  var self = this;
  setTimeout(function() {
    self._ensureBackend().then(function(backend) {
      self._handleMessage(backend, msg);
    }).catch(function(err) {
      if (self.onmessage) {
        self.onmessage({ data: { id: msg.id, error: convertError(err) } });
      }
    });
  }, 0);
};

FakeWorker.prototype._handleMessage = function(backend, msg) {
  var result;
  try {
    result = handleCommand(backend, msg);
    if (this.onmessage) {
      this.onmessage({ data: { id: msg.id, data: result } });
    }
  } catch (err) {
    if (this.onmessage) {
      this.onmessage({ data: { id: msg.id, error: convertError(err) } });
    }
  }
};

FakeWorker.prototype.terminate = function() {
  // Nothing to clean up for in-process worker
};

// --- Command handling (shared between Web Worker and FakeWorker) ---

function handleCommand(backend, msg) {
  switch (msg.cmd) {
    case 'register':
      // All algorithms are built-in; nothing to register
      return null;

    case 'layout': {
      var graphJson = JSON.stringify(msg.graph);
      var optionsJson = JSON.stringify(msg.layoutOptions || {});
      var resultJson = backend.layout_json(graphJson, optionsJson);
      return JSON.parse(resultJson);
    }

    case 'algorithms':
      return JSON.parse(backend.known_layout_algorithms());

    case 'options':
      return JSON.parse(backend.known_layout_options());

    case 'categories':
      return JSON.parse(backend.known_layout_categories());

    default:
      throw new Error('Unknown command: ' + msg.cmd);
  }
}

function convertError(err) {
  if (err instanceof Error) {
    return { message: err.message };
  }
  if (typeof err === 'string') {
    return { message: err };
  }
  return { message: String(err) };
}

// --- Worker mode ---

var _parentPort = workerThreadParentPort();

if (_parentPort) {
  // Node.js or Bun worker thread: native addon first, then WASM.
  var nodeBackend = null;
  var nodeBackendError = null;
  try {
    nodeBackend = require('./backend-node.js').loadBackend();
  } catch (err) {
    nodeBackendError = err;
  }

  _parentPort.on('message', function(msg) {
    if (!nodeBackend) {
      _parentPort.postMessage({ id: msg.id, error: convertError(nodeBackendError) });
      return;
    }
    try {
      var result = handleCommand(nodeBackend, msg);
      _parentPort.postMessage({ id: msg.id, data: result });
    } catch (err) {
      _parentPort.postMessage({ id: msg.id, error: convertError(err) });
    }
  });
} else if (isWebWorkerScope()) {
  // Browser Web Worker: WASM via dynamic import.
  var wasmReady = import('../dist/wasm/org_eclipse_elk_wasm.js').then(function(module) {
    if (module.default && typeof module.default === 'function') {
      return module.default().then(function() {
        return module;
      });
    }
    return module;
  });

  self.onmessage = function(e) {
    var msg = e.data;
    wasmReady.then(function(backend) {
      try {
        var result = handleCommand(backend, msg);
        self.postMessage({ id: msg.id, data: result });
      } catch (err) {
        // A Rust panic traps on WASM; report its message rather than the trap.
        var panicMessage = null;
        if (err instanceof WebAssembly.RuntimeError && backend.take_last_layout_panic) {
          try { panicMessage = backend.take_last_layout_panic(); } catch (e2) { /* trapped */ }
        }
        self.postMessage({ id: msg.id, error: panicMessage ? { message: panicMessage } : convertError(err) });
      }
    }).catch(function(err) {
      self.postMessage({ id: msg.id, error: convertError(err) });
    });
  };
}

// --- Exports ---

if (typeof module !== 'undefined' && module.exports) {
  module.exports.Worker = FakeWorker;
}
