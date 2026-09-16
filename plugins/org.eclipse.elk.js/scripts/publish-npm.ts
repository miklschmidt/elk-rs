// Publish the staged packages: every platform package first, then the root
// package whose optionalDependencies name them.
//
// usage: bun scripts/publish-npm.ts [--dry-run] [--allow-missing]
//
// A real publish uses the npm CLI, which authenticates through npm trusted
// publishing (GitHub OIDC) and attaches provenance. It refuses to run unless
// every platform package is staged, so a release never ships a root package
// pointing at binaries that were not published. A dry run packs with
// `bun publish --dry-run`, needs no credentials, and with --allow-missing
// checks whatever is staged.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { ROOT_STAGE_DIR, platformPackageSpecs, platformStageDir } from "./npm-packages";

const dryRun = process.argv.includes("--dry-run");
const allowMissing = process.argv.includes("--allow-missing");

const packageDirs = [...platformPackageSpecs.map((spec) => platformStageDir(spec.triple)), ROOT_STAGE_DIR];
const missing = packageDirs.filter((dir) => !existsSync(join(dir, "package.json")));
if (missing.length > 0 && !(dryRun && allowMissing)) {
	throw new Error(`Missing staged npm packages: ${missing.join(", ")}.`);
}

const command = dryRun ? "bun" : "npm";
const args = dryRun ? ["publish", "--dry-run"] : ["publish", "--access", "public", "--provenance"];
const env = dryRun ? { ...process.env, NPM_CONFIG_TOKEN: process.env.NPM_CONFIG_TOKEN ?? "dry-run-token" } : process.env;

for (const dir of packageDirs.filter((candidate) => !missing.includes(candidate))) {
	console.log(`\n=== ${command} ${args.join(" ")} in ${dir}`);
	const result = spawnSync(command, args, { cwd: dir, env, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.signal) process.kill(process.pid, result.signal);
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed in ${dir}`);
	}
}
