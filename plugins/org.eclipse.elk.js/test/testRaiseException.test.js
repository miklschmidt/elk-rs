/*******************************************************************************
 * Ported from elkjs — Copyright (c) 2020 Kiel University and others.
 * SPDX-License-Identifier: EPL-2.0
 *******************************************************************************/
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ELK from '../js/index.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const elk = new ELK();

// A simple cycle for which it is not possible to have all nodes in the very first layer
const graph = {
  id: "root",
  properties: { 'algorithm': 'layered' },
  children: [
    { id: "n1", width: 30, height: 30, layoutOptions: { layerConstraint: "FIRST" } },
    { id: "n2", width: 30, height: 30, layoutOptions: { layerConstraint: "FIRST" } },
    { id: "n3", width: 30, height: 30, layoutOptions: { layerConstraint: "FIRST" } }
  ],
  edges: [
    { id: "e1", sources: ["n1"], targets: ["n2"] },
    { id: "e2", sources: ["n2"], targets: ["n3"] },
    { id: "e3", sources: ["n3"], targets: ["n1"] }
  ]
};

const UNSUPPORTED = /org\.eclipse\.elk\.core\.UnsupportedConfigurationException/;

describe('Exceptions', () => {
  describe('#layout()', () => {

    it('should report an unsupported configuration.', async () => {
      await expect(elk.layout(graph)).rejects.toThrow(UNSUPPORTED);
    });

  });

  // elkjs rejects with an error whose string form carries the message; code that logs or
  // rethrows `String(error)` depends on it, whichever way the layout ran.
  describe('rejects with an Error carrying the message', () => {
    const API = require('../js/elk-api.js');
    const { Worker: FakeWorker } = require('../js/elk-worker.js');
    const modes = [
      ['direct', () => new ELK()],
      ['in-process worker', () => new API({ workerFactory: () => new FakeWorker() })],
      ['worker_threads worker', () => new ELK({ workerUrl: path.join(__dirname, '../js/elk-worker.js') })],
    ];
    for (const [mode, create] of modes) {
      it(mode, async () => {
        const engine = create();
        try {
          const error = await engine.layout(graph).then(() => null, (err) => err);
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toMatch(UNSUPPORTED);
          expect(String(error)).toMatch(UNSUPPORTED);
        } finally {
          engine.terminateWorker();
        }
      });
    }
  });
});
