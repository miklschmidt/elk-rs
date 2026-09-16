// The npm packages this directory publishes, and how each is staged.
//
// `@archboard/elk-rs` holds the JS API, typings and the WASM build. Each
// native addon ships in its own `@archboard/elk-rs-<triple>` package, pulled
// in through `optionalDependencies` and selected by npm through `os`, `cpu`
// and `libc`. Staging copies exactly what a package ships into
// `dist/npm/<dir>` so that publishing packs nothing else.
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(PACKAGE_DIR, "..", "..");
export const PUBLISH_ROOT = join(PACKAGE_DIR, "dist", "npm");
export const ROOT_STAGE_DIR = join(PUBLISH_ROOT, "root");

export interface PlatformPackageSpec {
	/** The napi-rs platform triple; names the binary and the package. */
	readonly triple: string;
	/** The Rust target the binary is compiled for. */
	readonly rustTarget: string;
	readonly os: readonly string[];
	readonly cpu: readonly string[];
	readonly libc?: readonly string[];
	readonly description: string;
}

export const platformPackageSpecs: readonly PlatformPackageSpec[] = [
	{
		triple: "darwin-arm64",
		rustTarget: "aarch64-apple-darwin",
		os: ["darwin"],
		cpu: ["arm64"],
		description: "macOS ARM64 (Apple Silicon)",
	},
	{
		triple: "darwin-x64",
		rustTarget: "x86_64-apple-darwin",
		os: ["darwin"],
		cpu: ["x64"],
		description: "macOS x64 (Intel)",
	},
	{
		triple: "linux-x64-gnu",
		rustTarget: "x86_64-unknown-linux-gnu",
		os: ["linux"],
		cpu: ["x64"],
		libc: ["glibc"],
		description: "Linux x64 (glibc)",
	},
	{
		triple: "linux-x64-musl",
		rustTarget: "x86_64-unknown-linux-musl",
		os: ["linux"],
		cpu: ["x64"],
		libc: ["musl"],
		description: "Linux x64 (musl)",
	},
	{
		triple: "linux-arm64-gnu",
		rustTarget: "aarch64-unknown-linux-gnu",
		os: ["linux"],
		cpu: ["arm64"],
		libc: ["glibc"],
		description: "Linux ARM64 (glibc)",
	},
	{
		triple: "win32-x64-msvc",
		rustTarget: "x86_64-pc-windows-msvc",
		os: ["win32"],
		cpu: ["x64"],
		description: "Windows x64 (MSVC)",
	},
];

export async function readRootPackageJson(): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(join(PACKAGE_DIR, "package.json"), "utf8"));
}

export function platformPackageName(rootName: string, triple: string): string {
	return `${rootName}-${triple}`;
}

export function platformSpec(triple: string): PlatformPackageSpec {
	const spec = platformPackageSpecs.find((candidate) => candidate.triple === triple);
	if (!spec) {
		const known = platformPackageSpecs.map((candidate) => candidate.triple).join(", ");
		throw new Error(`Unknown platform triple ${triple}. Known triples: ${known}.`);
	}
	return spec;
}

export function platformStageDir(triple: string): string {
	return join(PUBLISH_ROOT, triple);
}

/** Stage `@archboard/elk-rs-<triple>` from `dist/elk-rs.<triple>.node`. */
export async function stagePlatformPackage(triple: string): Promise<string> {
	const spec = platformSpec(triple);
	const root = await readRootPackageJson();
	const binary = `elk-rs.${spec.triple}.node`;
	const source = join(PACKAGE_DIR, "dist", binary);
	await requireFile(source, "Build the native addon first (`bash build.sh`, NAPI_TARGET for a cross build).");

	const dir = platformStageDir(spec.triple);
	await resetDir(dir);
	await cp(source, join(dir, binary));
	await cp(join(PACKAGE_DIR, "LICENSE.md"), join(dir, "LICENSE.md"));
	await cp(join(REPO_ROOT, "NOTICE"), join(dir, "NOTICE"));
	await writeJson(join(dir, "package.json"), {
		name: platformPackageName(String(root.name), spec.triple),
		version: root.version,
		description: `elk-rs native binding for ${spec.description}`,
		license: root.license,
		repository: root.repository,
		homepage: root.homepage,
		os: spec.os,
		cpu: spec.cpu,
		...(spec.libc ? { libc: spec.libc } : {}),
		main: binary,
		files: [binary, "LICENSE.md", "NOTICE"],
		publishConfig: { access: "public" },
	});
	return dir;
}

/** Stage `@archboard/elk-rs` from the package's `files`, with the WASM build. */
export async function stageRootPackage(): Promise<string> {
	const root = await readRootPackageJson();
	for (const wasmFile of [
		"org_eclipse_elk_wasm_bg.wasm",
		"org_eclipse_elk_wasm.js",
		"org_eclipse_elk_wasm.node.cjs",
	]) {
		await requireFile(join(PACKAGE_DIR, "dist", "wasm", wasmFile), "Build the WASM package first (`bash build.sh`).");
	}

	const dir = ROOT_STAGE_DIR;
	await resetDir(dir);
	for (const entry of root.files as string[]) {
		const source = entry === "NOTICE" ? join(REPO_ROOT, "NOTICE") : join(PACKAGE_DIR, entry);
		await cp(source, join(dir, entry), { recursive: true });
	}
	const { devDependencies: _dev, scripts: _scripts, ...published } = root;
	await writeJson(join(dir, "package.json"), published);
	return dir;
}

async function requireFile(path: string, hint: string): Promise<void> {
	try {
		await stat(path);
	} catch {
		throw new Error(`Missing ${path}. ${hint}`);
	}
}

async function resetDir(path: string): Promise<void> {
	await rm(path, { force: true, recursive: true });
	await mkdir(path, { recursive: true });
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
