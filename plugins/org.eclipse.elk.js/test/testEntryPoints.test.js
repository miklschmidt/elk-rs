/*******************************************************************************
 * Ported from elkjs — Copyright (c) 2021 Kiel University and others.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const graph = {
  id: "root",
  properties: { 'algorithm': 'layered' },
  children: [
    { id: "n1", width: 30, height: 30 },
    { id: "n2", width: 30, height: 30 },
    { id: "n3", width: 30, height: 30 }
  ],
  edges: [
    { id: "e1", sources: [ "n1" ], targets: [ "n2" ] },
    { id: "e2", sources: [ "n1" ], targets: [ "n3" ] }
  ]
};

describe('Entry point', () => {

  describe('main entry point (direct mode)', () => {
    const ELK = require('../js/index.js');
    const elk = new ELK();

    it('should succeed.', async () => {
      await elk.layout(graph);
    });
  });

  describe('elk-api with fake worker', () => {
    const ELK = require('../js/elk-api.js');
    const elk = new ELK({
      workerFactory: function (_) {
        const { Worker } = require('../js/elk-worker.js');
        return new Worker();
      }
    });

    it('should succeed.', async () => {
      await elk.layout(graph);
    });
  });

  describe('in worker_threads', () => {
    const ELK = require('../js/index.js');
    const elk = new ELK({
      workerUrl: path.join(__dirname, '../js/elk-worker.js')
    });

    it('should succeed.', async () => {
      await elk.layout(graph);
      elk.terminateWorker();
    });
  });

  describe('platform package mapping', () => {
    const backend = require('../js/backend-node.js');
    const pkg = require('../package.json');
    const hosts = [
      ['darwin', 'arm64', false],
      ['darwin', 'x64', false],
      ['linux', 'x64', false],
      ['linux', 'x64', true],
      ['linux', 'arm64', false],
      ['win32', 'x64', false],
    ];

    it('resolves every supported host to exactly the optional platform packages', () => {
      const resolved = hosts.map(([platform, arch, musl]) =>
        backend.platformPackageName(backend.platformTriple(platform, arch, musl)));
      expect(new Set(resolved)).toEqual(new Set(Object.keys(pkg.optionalDependencies)));
    });

    it('pins every optional platform package to the package version', () => {
      for (const version of Object.values(pkg.optionalDependencies)) {
        expect(version).toBe(pkg.version);
      }
    });

    it('prefers an installed platform package over a local build and WASM', async () => {
      const root = mkdtempSync(path.join(tmpdir(), 'elk-rs-platform-pkg-'));
      try {
        cpSync(path.join(__dirname, '../js'), path.join(root, 'js'), { recursive: true });
        const name = backend.platformPackageName(backend.platformTriple());
        const dir = path.join(root, 'node_modules', ...name.split('/'));
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
        writeFileSync(path.join(dir, 'index.js'),
          'exports.layout_json = () => JSON.stringify({ id: "from-platform-package" });');
        const ELK = require(path.join(root, 'js/index.js'));
        const out = await new ELK().layout(graph);
        expect(out.id).toBe('from-platform-package');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('WASM fallback works when no NAPI binary', () => {
    // The main entry point should still work (falling back to WASM)
    const ELK = require('../js/index.js');
    const elk = new ELK();

    it('should layout successfully via fallback', async () => {
      const result = await elk.layout(graph);
      expect(result).toBeDefined();
      expect(result.id).toBe('root');
      expect(result.children).toHaveLength(3);
    });
  });

});
