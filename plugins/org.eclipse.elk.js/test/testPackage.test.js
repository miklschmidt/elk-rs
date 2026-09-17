/*******************************************************************************
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
// What a consumer of the published package gets: a module Web Worker for
// browsers that needs nothing from Node.js.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bun = (() => {
  if (process.versions.bun) return process.execPath;
  const probe = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  return probe.status === 0 ? 'bun' : null;
})();

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
});
