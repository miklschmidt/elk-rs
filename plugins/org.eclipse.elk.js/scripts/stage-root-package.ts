// Stage the root package into dist/npm/root.
// usage: bun scripts/stage-root-package.ts
import { stageRootPackage } from "./npm-packages";

console.log(`staged ${await stageRootPackage()}`);
