# @archboard/elk-rs

ELK layout engine rewritten in Rust — drop-in replacement for [elkjs](https://github.com/kieler/elkjs) with WASM and native Node.js addon support.

> **This is a fork** of [openedges/elk-rs](https://github.com/openedges/elk-rs)
> ([source](https://github.com/miklschmidt/elk-rs/tree/archboard)), published
> under the `@archboard` scope. Besides its npm packaging it fixes three
> problems in the JS package:
>
> 1. The WASM fallback works on Node.js and Bun when no native addon is
>    installed (upstream loaded the web-target WASM without initialising it).
> 2. `js/elk-worker.js` no longer mistakes Bun's main thread for a Web Worker.
> 3. A layout error rejects with ELK's message and prints no Rust panic to
>    stderr; on WASM the message is reported instead of an `unreachable` trap,
>    and the next layout starts from a fresh instance.

## Installation

```bash
npm install @archboard/elk-rs
# or
bun add @archboard/elk-rs
```

On supported platforms a native addon is installed through an optional
dependency; everywhere else the package falls back to WASM.

| Platform | Package |
|---|---|
| macOS ARM64 (Apple Silicon) | `@archboard/elk-rs-darwin-arm64` |
| macOS x64 (Intel) | `@archboard/elk-rs-darwin-x64` |
| Linux x64 (glibc) | `@archboard/elk-rs-linux-x64-gnu` |
| Linux x64 (musl) | `@archboard/elk-rs-linux-x64-musl` |
| Linux ARM64 (glibc) | `@archboard/elk-rs-linux-arm64-gnu` |
| Windows x64 | `@archboard/elk-rs-win32-x64-msvc` |

The native addon's `layout()` runs synchronously on the calling thread (the
returned promise is already settled); run it in a Worker to keep a thread free.

## Usage

elk-rs provides an elkjs-compatible API. In most cases you can replace `elkjs` with `@archboard/elk-rs` directly:

```js
const ELK = require('@archboard/elk-rs');
const elk = new ELK();

const graph = {
  id: 'root',
  layoutOptions: { 'elk.algorithm': 'layered' },
  children: [
    { id: 'n1', width: 30, height: 30 },
    { id: 'n2', width: 30, height: 30 },
  ],
  edges: [
    { id: 'e1', sources: ['n1'], targets: ['n2'] }
  ]
};

elk.layout(graph).then(console.log);
```

### ESM

```js
import ELK from '@archboard/elk-rs';
const elk = new ELK();
```

### Browser

elk-rs works in the browser via WASM. Bundlers that respect the `"browser"` field in `package.json` will automatically use the browser entry point.

### Web Worker

```js
const ELK = require('@archboard/elk-rs');
const elk = new ELK({
  workerUrl: './node_modules/@archboard/elk-rs/js/elk-worker.js'
});
```

In Bun, as with elkjs:

```js
import ELK from '@archboard/elk-rs/js/elk-api.js';
const worker = new Worker(import.meta.resolve('@archboard/elk-rs/js/elk-worker.js'));
const elk = new ELK({ workerFactory: () => worker });
```


## API

### `new ELK(options?)`

- `defaultLayoutOptions` — default layout options applied to every `layout()` call
- `workerUrl` — URL to the worker script (enables Web Worker mode)
- `workerFactory` — custom function to create a Worker instance
- `algorithms` — list of algorithm IDs to register (all built-in by default)

### `elk.layout(graph, options?)`

Returns a `Promise<LayoutedGraph>`. The graph follows the [ELK JSON format](https://www.eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/jsonformat.html).

### `elk.knownLayoutAlgorithms()`

Returns a `Promise` with an array of registered layout algorithm descriptions.

### `elk.knownLayoutOptions()`

Returns a `Promise` with an array of available layout options.

### `elk.knownLayoutCategories()`

Returns a `Promise` with an array of layout categories.

### `elk.terminateWorker()`

Terminates the Web Worker (if one was created).

## Differences from elkjs

- **Written in Rust** — compiled to WASM instead of GWT-transpiled JavaScript
- **No GWT overhead** — faster startup, smaller memory footprint
- **Native Node.js addon** — optional NAPI binding for maximum performance
- **Same API** — elkjs-compatible `layout()`, `knownLayoutAlgorithms()`, etc.
- **Same algorithms** — layered, stress, mrtree, radial, force, disco, rectpacking, sporeOverlap, sporeCompaction

## Supported Algorithms

| Algorithm | ELK ID |
|-----------|--------|
| Layered | `org.eclipse.elk.layered` |
| Stress | `org.eclipse.elk.stress` |
| MrTree | `org.eclipse.elk.mrtree` |
| Radial | `org.eclipse.elk.radial` |
| Force | `org.eclipse.elk.force` |
| DisCo | `org.eclipse.elk.disco` |
| Rect Packing | `org.eclipse.elk.rectpacking` |
| Spore Overlap | `org.eclipse.elk.sporeOverlap` |
| Spore Compaction | `org.eclipse.elk.sporeCompaction` |

## License

[Eclipse Public License 2.0](./LICENSE)
