/*******************************************************************************
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
// What a consumer of the published package gets: type declarations for every
// export under TypeScript's bundler resolution, and a module Web Worker for
// browsers that needs nothing from Node.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')));

const bun = (() => {
  if (process.versions.bun) return process.execPath;
  const probe = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  return probe.status === 0 ? 'bun' : null;
})();

let consumer;
beforeAll(() => {
  consumer = mkdtempSync(path.join(tmpdir(), 'elk-rs-consumer-'));
  mkdirSync(path.join(consumer, 'node_modules', '@archboard'), { recursive: true });
  symlinkSync(PKG, path.join(consumer, 'node_modules', pkg.name), 'dir');
});
afterAll(() => rmSync(consumer, { recursive: true, force: true }));

describe('type declarations', () => {
  it('type-check every export under moduleResolution bundler', () => {
    writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        target: 'es2022',
        lib: ['es2022', 'dom'],
        types: [],
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      files: ['consumer.ts'],
    }));
    writeFileSync(path.join(consumer, 'consumer.ts'), `
      import type { ELK as ElkApi, ElkNode } from '${pkg.name}';
      import ELK from '${pkg.name}';
      import ElkConstructor from '${pkg.name}/js/elk-api.js';
      import { Worker as InProcessWorker } from '${pkg.name}/js/elk-worker.js';
      import type { ElkExtendedEdge } from '${pkg.name}/typings/elk-api.js';
      import initWasm, { layout_json } from '${pkg.name}/wasm';
      import type { ElkWorkerInitMessage } from '${pkg.name}/worker.browser';
      import wasmUrl from '${pkg.name}/wasm-url';

      export async function share(worker: Worker): Promise<void> {
        const module = await WebAssembly.compileStreaming(fetch(wasmUrl));
        const init: ElkWorkerInitMessage = { cmd: 'init', module };
        worker.postMessage(init);
      }

      const graph: ElkNode & { children: ElkNode[] } = { id: 'root', children: [{ id: 'n' }] };
      const edge: ElkExtendedEdge = { id: 'e', sources: ['n'], targets: ['n'] };
      const direct: ElkApi = new ELK();
      const worker: ElkApi = new ElkConstructor({
        workerFactory: () => new InProcessWorker() as unknown as Worker,
      });
      export async function use(): Promise<string | undefined> {
        const laidOut = await direct.layout(graph);
        await worker.layout({ ...graph, edges: [edge] });
        await initWasm();
        layout_json('{}', '{}');
        return laidOut.children?.[0]?.id;
      }
    `);
    const tsc = spawnSync(process.execPath.includes('bun') ? 'node' : process.execPath,
      [path.join(PKG, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', consumer],
      { encoding: 'utf8', cwd: consumer });
    expect(tsc.stdout + tsc.stderr).toBe('');
    expect(tsc.status).toBe(0);
  });
});

describe('module Web Worker (worker.browser)', () => {
  it.skipIf(!bun)('lays out, rejects a failed layout with an Error, and lays out again', () => {
    const script = `
      const ELK = require(${JSON.stringify(path.join(PKG, 'js', 'elk-api.js'))});
      const url = ${JSON.stringify(new URL('js/worker.browser.mjs', `file://${PKG}/`).href)};
      const elk = new ELK({ workerFactory: () => new Worker(url, { type: 'module' }) });
      const graph = { id: 'root', children: [{ id: 'a', width: 10, height: 10 }, { id: 'b', width: 10, height: 10 }],
        edges: [{ id: 'e', sources: ['a'], targets: ['b'] }] };
      const impossible = { id: 'root', children: ['a', 'b'].map((id) => ({ id, width: 10, height: 10,
        layoutOptions: { 'elk.layered.layering.layerConstraint': 'FIRST' } })),
        edges: [{ id: 'e1', sources: ['a'], targets: ['b'] }, { id: 'e2', sources: ['b'], targets: ['a'] }] };
      (async () => {
        const first = await elk.layout(graph);
        const error = await elk.layout(impossible).then(() => null, (err) => err);
        const again = await elk.layout(graph);
        console.log(JSON.stringify({
          first: first.children.map((c) => [c.x, c.y]),
          again: again.children.map((c) => [c.x, c.y]),
          isError: error instanceof Error,
          message: String(error),
        }));
        elk.terminateWorker();
      })();
    `;
    const r = spawnSync(bun, ['-e', script], { encoding: 'utf8', timeout: 9000 });
    const value = JSON.parse(r.stdout.trim().split('\n').at(-1) || 'null');
    expect(value, r.stderr).not.toBeNull();
    expect(value.isError).toBe(true);
    expect(value.message).toMatch(/UnsupportedConfigurationException/);
    expect(value.again).toEqual(value.first);
  });

  // The workers run from a copy of the package without the WASM binary, so they can only lay
  // out, and recover from a failed layout, with the module the page compiled and sent them.
  it.skipIf(!bun)('shares one compiled module across workers, through a failed layout', () => {
    const noBinary = mkdtempSync(path.join(tmpdir(), 'elk-rs-no-binary-'));
    try {
      cpSync(path.join(PKG, 'js'), path.join(noBinary, 'js'), { recursive: true });
      cpSync(path.join(PKG, 'dist', 'wasm'), path.join(noBinary, 'dist', 'wasm'), {
        recursive: true,
        filter: (source) => !source.endsWith('.wasm'),
      });
      const script = `
        const ELK = require(${JSON.stringify(path.join(PKG, 'js', 'elk-api.js'))});
        const { default: wasmUrl } = await import(${JSON.stringify(path.join(PKG, 'js', 'wasm-url.mjs'))});
        const url = ${JSON.stringify(new URL('js/worker.browser.mjs', `file://${noBinary}/`).href)};
        const graph = { id: 'root', children: [{ id: 'a', width: 10, height: 10 }, { id: 'b', width: 10, height: 10 }],
          edges: [{ id: 'e', sources: ['a'], targets: ['b'] }] };
        const impossible = { id: 'root', children: ['a', 'b'].map((id) => ({ id, width: 10, height: 10,
          layoutOptions: { 'elk.layered.layering.layerConstraint': 'FIRST' } })),
          edges: [{ id: 'e1', sources: ['a'], targets: ['b'] }, { id: 'e2', sources: ['b'], targets: ['a'] }] };
        const module = await WebAssembly.compile(await Bun.file(new URL(wasmUrl)).arrayBuffer());
        const shared = () => new ELK({ workerFactory: () => {
          const worker = new Worker(url, { type: 'module' });
          worker.postMessage({ cmd: 'init', module });
          return worker;
        } });
        const engines = [shared(), shared(), shared()];
        const unshared = new ELK({ workerFactory: () => new Worker(url, { type: 'module' }) });
        const layouts = await Promise.all(engines.map((elk) => elk.layout(graph)));
        const error = await engines[1].layout(impossible).then(() => null, (err) => String(err));
        const again = await engines[1].layout(graph);
        const withoutModule = await unshared.layout(graph).then(() => null, (err) => String(err));
        console.log(JSON.stringify({
          layouts: layouts.map((out) => out.children.map((c) => [c.x, c.y])),
          error,
          again: again.children.map((c) => [c.x, c.y]),
          withoutModule,
        }));
        [...engines, unshared].forEach((elk) => elk.terminateWorker());
      `;
      const r = spawnSync(bun, ['-e', script], { encoding: 'utf8', timeout: 9000 });
      const value = JSON.parse(r.stdout.trim().split('\n').at(-1) || 'null');
      expect(value, r.stderr).not.toBeNull();
      expect(value.layouts).toHaveLength(3);
      expect(new Set(value.layouts.map((layout) => JSON.stringify(layout))).size).toBe(1);
      expect(value.error).toMatch(/UnsupportedConfigurationException/);
      expect(value.again).toEqual(value.layouts[1]);
      expect(value.withoutModule).not.toBeNull();
    } finally {
      rmSync(noBinary, { recursive: true, force: true });
    }
  });
});
