/*******************************************************************************
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
// Backend selection, worker detection and error reporting, each exercised in
// a fresh child process so that what a real caller sees (exit status, stdout,
// stderr, globals) is what is asserted.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bun = (() => {
  if (process.versions.bun) return process.execPath;
  const probe = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  return probe.status === 0 ? 'bun' : null;
})();
const node = process.versions.bun ? 'node' : process.execPath;

const graph = {
  id: 'root',
  layoutOptions: { 'elk.algorithm': 'layered', 'elk.edgeRouting': 'ORTHOGONAL' },
  children: [
    { id: 'n1', width: 30, height: 30 },
    { id: 'n2', width: 30, height: 30 },
    { id: 'n3', width: 30, height: 30 },
  ],
  edges: [
    { id: 'e1', sources: ['n1'], targets: ['n2'] },
    { id: 'e2', sources: ['n1'], targets: ['n3'] },
  ],
};

// Every node must be in the first layer, but they form a cycle: ELK refuses it.
const impossibleGraph = {
  id: 'root',
  layoutOptions: { 'elk.algorithm': 'layered' },
  children: ['n1', 'n2', 'n3'].map((id) => ({
    id, width: 30, height: 30, layoutOptions: { 'elk.layered.layering.layerConstraint': 'FIRST' },
  })),
  edges: [
    { id: 'e1', sources: ['n1'], targets: ['n2'] },
    { id: 'e2', sources: ['n2'], targets: ['n3'] },
    { id: 'e3', sources: ['n3'], targets: ['n1'] },
  ],
};

/** Run a CommonJS snippet with `root` bound to a package directory; the snippet prints one JSON line. */
function run(runtime, root, body) {
  const script = `const root = ${JSON.stringify(root)};\n${body}`;
  const result = spawnSync(runtime, ['-e', script], { encoding: 'utf8', cwd: root, timeout: 9000 });
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  let value;
  try { value = JSON.parse(lines.at(-1)); } catch { value = undefined; }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, value };
}

const layoutSnippet = (entry, graphValue, options = '') => `
  const ELK = require(require('path').join(root, ${JSON.stringify(entry)}));
  const elk = new ELK(${options});
  elk.layout(${JSON.stringify(graphValue)}).then(
    (out) => { console.log(JSON.stringify({ ok: true, out })); elk.terminateWorker(); },
    (err) => { console.log(JSON.stringify({ ok: false, message: String(err && err.message || err) })); elk.terminateWorker(); },
  );
`;

// A copy of the package that ships no native addon anywhere it could be resolved from.
let wasmOnly;
beforeAll(() => {
  wasmOnly = mkdtempSync(path.join(tmpdir(), 'elk-rs-wasm-only-'));
  cpSync(path.join(PKG, 'js'), path.join(wasmOnly, 'js'), { recursive: true });
  cpSync(path.join(PKG, 'dist', 'wasm'), path.join(wasmOnly, 'dist', 'wasm'), { recursive: true });
  cpSync(path.join(PKG, 'package.json'), path.join(wasmOnly, 'package.json'));
});
afterAll(() => rmSync(wasmOnly, { recursive: true, force: true }));

const distDir = path.join(PKG, 'dist');
const hasNative = existsSync(distDir) && readdirSync(distDir).some((f) => f.endsWith('.node'));

describe('WASM fallback when no native addon is available', () => {
  const runtimes = [['node', node], ['bun', bun]];
  for (const [name, runtime] of runtimes) {
    it.skipIf(!runtime)(`lays out through js/index.js on ${name}`, () => {
      const r = run(runtime, wasmOnly, layoutSnippet('js/index.js', graph));
      expect(r.value, r.stderr).toMatchObject({ ok: true });
      expect(r.value.out.children).toHaveLength(3);
      expect(r.value.out.edges[0].sections).toHaveLength(1);
    });

    it.skipIf(!runtime)(`lays out through the in-process fake worker on ${name}`, () => {
      const r = run(runtime, wasmOnly, `
        const API = require(require('path').join(root, 'js/elk-api.js'));
        const { Worker } = require(require('path').join(root, 'js/elk-worker.js'));
        ${layoutSnippet('js/elk-api.js', graph, '{ workerFactory: () => new Worker() }')
          .replace(/const ELK = require\([^;]*;/, 'const ELK = API;')}
      `);
      expect(r.value, r.stderr).toMatchObject({ ok: true });
      expect(r.value.out.children).toHaveLength(3);
    });
  }

  it('lays out through a worker_threads worker on node', () => {
    const r = run(node, wasmOnly, layoutSnippet('js/index.js', graph,
      `{ workerUrl: require('path').join(root, 'js/elk-worker.js') }`));
    expect(r.value, r.stderr).toMatchObject({ ok: true });
    expect(r.value.out.children).toHaveLength(3);
  });

  it('gives the same layout as the native addon', () => {
    if (!hasNative) return;
    const viaWasm = run(node, wasmOnly, layoutSnippet('js/index.js', graph));
    const viaNative = run(node, PKG, layoutSnippet('js/index.js', graph));
    expect(viaWasm.value.out).toEqual(viaNative.value.out);
  });
});

describe('elk-worker.js on a main thread', () => {
  it.skipIf(!bun)('does not take over the global message handler on Bun', () => {
    const r = run(bun, PKG, `
      require(require('path').join(root, 'js/elk-worker.js'));
      setTimeout(() => console.log(JSON.stringify({ onmessage: typeof self.onmessage })), 50);
    `);
    expect(r.status, r.stderr).toBe(0);
    expect(r.value.onmessage).not.toBe('function');
  });

  it.skipIf(!bun)('still answers when it runs inside a Bun Worker', () => {
    const r = run(bun, PKG, layoutSnippet('js/elk-api.js', graph,
      `{ workerFactory: () => new Worker(require('path').join(root, 'js/elk-worker.js')) }`));
    expect(r.value, r.stderr).toMatchObject({ ok: true });
    expect(r.value.out.children).toHaveLength(3);
  });
});

describe('layout errors', () => {
  const cases = [['native addon', PKG], ['WASM', null]];
  for (const [name, dir] of cases) {
    it(`reject with ELK's message and write nothing to stderr (${name})`, () => {
      const root = dir ?? wasmOnly;
      if (dir && !hasNative) return;
      const r = run(node, root, layoutSnippet('js/index.js', impossibleGraph));
      expect(r.value, r.stderr).toMatchObject({ ok: false });
      expect(r.value.message).toMatch(/^org\.eclipse\.elk\.core\.UnsupportedConfigurationException: /);
      expect(r.stderr).toBe('');
    });

    it(`leave the engine usable after an error (${name})`, () => {
      const root = dir ?? wasmOnly;
      if (dir && !hasNative) return;
      const r = run(node, root, `
        const ELK = require(require('path').join(root, 'js/index.js'));
        const elk = new ELK();
        elk.layout(${JSON.stringify(impossibleGraph)}).catch(() => null)
          .then(() => elk.layout(${JSON.stringify(graph)}))
          .then((out) => console.log(JSON.stringify({ ok: true, out })),
                (err) => console.log(JSON.stringify({ ok: false, message: String(err.message) })));
      `);
      expect(r.value, r.stderr).toMatchObject({ ok: true });
      expect(r.value.out.children).toHaveLength(3);
    });
  }
});
