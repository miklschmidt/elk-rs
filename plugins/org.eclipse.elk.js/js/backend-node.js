'use strict';

/**
 * Backend loading for Node.js and Bun, shared by the main entry and the worker.
 *
 * A backend is an object with the functions `layout_json`,
 * `known_layout_algorithms`, `known_layout_options` and
 * `known_layout_categories`, each taking and returning JSON strings.
 *
 * The native addon is preferred; WASM is the fallback wherever no addon for
 * this platform is installed.
 */

var path = require('path');

var SCOPE = '@archboard/elk-rs-';

/** Whether this Linux process runs on musl libc rather than glibc. */
function isMusl() {
  if (process.platform !== 'linux') return false;
  try {
    var report = process.report && process.report.getReport();
    if (typeof report === 'string') report = JSON.parse(report);
    if (report && report.header) return !report.header.glibcVersionRuntime;
  } catch (e) { /* fall through */ }
  try {
    return require('fs').readFileSync('/usr/bin/ldd', 'utf8').indexOf('musl') !== -1;
  } catch (e) {
    return false;
  }
}

/**
 * The platform triple naming this host's native package and binary, such as
 * `linux-x64-gnu`, or null when no native binary is built for this host.
 */
function platformTriple(platform, arch, musl) {
  platform = platform || process.platform;
  arch = arch || process.arch;
  if (musl === undefined) musl = isMusl();
  var key = platform + '-' + arch;
  var triples = {
    'darwin-arm64': 'darwin-arm64',
    'darwin-x64': 'darwin-x64',
    'linux-x64': musl ? 'linux-x64-musl' : 'linux-x64-gnu',
    'linux-arm64': musl ? null : 'linux-arm64-gnu',
    'win32-x64': 'win32-x64-msvc',
  };
  return triples[key] || null;
}

/** The npm package that ships the native binary for a triple. */
function platformPackageName(triple) {
  return SCOPE + triple;
}

/** The native addon for this host, or null when none is installed. */
function loadNativeAddon() {
  var triple = platformTriple();
  var candidates = [];
  if (triple) {
    // 1. The platform package installed through optionalDependencies.
    candidates.push(platformPackageName(triple));
    // 2. A local build (`napi build --platform`).
    candidates.push(path.join(__dirname, '..', 'dist', 'elk-rs.' + triple + '.node'));
  }
  // 3. A local build without the platform suffix.
  candidates.push(path.join(__dirname, '..', 'dist', 'elk-rs.node'));
  for (var i = 0; i < candidates.length; i++) {
    try {
      return require(candidates[i]);
    } catch (e) {
      // Not installed or not built; try the next one.
    }
  }
  return null;
}

var WASM_GLUE = path.join(__dirname, '..', 'dist', 'wasm', 'org_eclipse_elk_wasm.node.cjs');

/**
 * The WASM backend, or null when the WASM build is missing.
 *
 * A layout error that Rust raises as a panic aborts on WASM: the call traps
 * with a `WebAssembly.RuntimeError` and the instance's memory may be left
 * inconsistent. This backend reports the panic's message instead of the trap
 * and replaces the instance, so the next layout starts clean.
 */
function loadWasm() {
  var instance;
  function instantiate() {
    delete require.cache[WASM_GLUE];
    instance = require(WASM_GLUE);
  }
  try {
    instantiate();
  } catch (e) {
    return null;
  }
  function call(name) {
    return function () {
      try {
        return instance[name].apply(null, arguments);
      } catch (err) {
        if (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError) {
          var message = null;
          try { message = instance.take_last_layout_panic(); } catch (e) { /* trapped instance */ }
          instantiate();
          throw new Error(message || err.message);
        }
        throw err;
      }
    };
  }
  return {
    layout_json: call('layout_json'),
    known_layout_algorithms: call('known_layout_algorithms'),
    known_layout_options: call('known_layout_options'),
    known_layout_categories: call('known_layout_categories'),
  };
}

/** The best available backend: native addon first, then WASM. */
function loadBackend() {
  var backend = loadNativeAddon() || loadWasm();
  if (!backend) {
    throw new Error(
      'elk-rs: Could not load the native addon or the WASM module.\n'
      + 'Ensure the package was installed correctly.'
    );
  }
  return backend;
}

module.exports = {
  isMusl: isMusl,
  platformTriple: platformTriple,
  platformPackageName: platformPackageName,
  loadNativeAddon: loadNativeAddon,
  loadWasm: loadWasm,
  loadBackend: loadBackend,
};
