// Stage native platform packages into dist/npm/<triple>.
// usage: bun scripts/stage-platform-package.ts <triple>...
import { stagePlatformPackage } from "./npm-packages";

const triples = process.argv.slice(2);
if (triples.length === 0) {
	throw new Error("Name at least one platform triple to stage, e.g. linux-x64-gnu.");
}
for (const triple of triples) {
	console.log(`staged ${await stagePlatformPackage(triple)}`);
}
