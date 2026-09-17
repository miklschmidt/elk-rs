/**
 * `@archboard/elk-rs/worker.browser` is a module Web Worker script: load it with
 * `new Worker(url, { type: 'module' })` (or a bundler's worker import) and hand the
 * worker to `ELK` through `workerFactory`. It exports nothing.
 *
 * Workers can share one compiled module: post {@link ElkWorkerInitMessage} to a
 * worker before anything else.
 */
export {};

/** Instantiate the worker from a module compiled on the page from `@archboard/elk-rs/wasm-url`. */
export interface ElkWorkerInitMessage {
    cmd: 'init';
    module: WebAssembly.Module;
    /** When set, the worker answers `{ id, data: null }` once instantiated. */
    id?: number;
}
