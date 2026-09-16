// Load a staged platform package's addon and lay out a small graph with it.
// usage: node scripts/smoke-native.cjs dist/npm/<triple>
'use strict';

const path = require('path');

const dir = path.resolve(process.argv[2] || '.');
const pkg = require(path.join(dir, 'package.json'));
const addon = require(path.join(dir, pkg.main));

const graph = {
  id: 'root',
  layoutOptions: { 'elk.algorithm': 'layered', 'elk.edgeRouting': 'ORTHOGONAL' },
  children: [
    { id: 'a', width: 30, height: 30 },
    { id: 'b', width: 30, height: 30 },
  ],
  edges: [{ id: 'e', sources: ['a'], targets: ['b'] }],
};
const out = JSON.parse(addon.layout_json(JSON.stringify(graph), '{}'));
const [a, b] = out.children;
if (!(b.x > a.x) || out.edges[0].sections.length !== 1) {
  throw new Error(`${pkg.name}: unexpected layout ${JSON.stringify(out)}`);
}
let refused = false;
try {
  addon.layout_json(JSON.stringify({ id: 'r', layoutOptions: { 'elk.algorithm': 'nope' }, children: [{ id: 'n', width: 1, height: 1 }] }), '{}');
} catch (err) {
  refused = /UnsupportedConfigurationException/.test(err.message);
}
if (!refused) throw new Error(`${pkg.name}: an unknown algorithm was not refused`);
console.log(`${pkg.name}@${pkg.version}: layout ok on ${process.platform}-${process.arch}`);
