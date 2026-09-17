#!/usr/bin/env bash
set -e

# Environment knobs:
#   NAPI_TARGET=<rust target>  build the native addon for another target
#   ELK_RS_SKIP_WASM=1         build only the native addon
#   ELK_RS_SKIP_NATIVE=1       build only the WASM package

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WASM_DIR="$SCRIPT_DIR/../org.eclipse.elk.wasm"
NAPI_DIR="$SCRIPT_DIR/../org.eclipse.elk.napi"
DIST_DIR="$SCRIPT_DIR/dist"

echo "=== elk-rs build ==="

# Clean
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/wasm"

# The napi-rs CLI, through npx where npm is installed and bunx otherwise.
if command -v npx &> /dev/null; then
  NAPI_CLI="npx --yes -p @napi-rs/cli@3.10.3 napi"
elif command -v bunx &> /dev/null; then
  NAPI_CLI="bunx @napi-rs/cli@3.10.3"
else
  NAPI_CLI=""
fi

# 1. WASM build
echo "--- Building WASM ---"
if [ -n "$ELK_RS_SKIP_WASM" ]; then
  echo "Skipped (ELK_RS_SKIP_WASM)."
elif command -v wasm-pack &> /dev/null; then
  # Web target: ES module glue for browsers and bundlers.
  (cd "$WASM_DIR" && wasm-pack build --target web --out-dir "$DIST_DIR/wasm" --release)
  # wasm-pack generates .gitignore (containing "*") and package.json in the output dir.
  # Remove them so npm pack can include the WASM files.
  rm -f "$DIST_DIR/wasm/.gitignore" "$DIST_DIR/wasm/package.json"

  # A panic aborts on WASM and may leave the instance's memory inconsistent, but the web
  # glue instantiates once per realm. js/worker.browser.mjs replaces a trapped instance.
  if ! grep -q 'let wasmModule, wasm;' "$DIST_DIR/wasm/org_eclipse_elk_wasm.js"; then
    echo "ERROR: the web WASM glue no longer declares 'let wasmModule, wasm;'." >&2
    exit 1
  fi
  cat >> "$DIST_DIR/wasm/org_eclipse_elk_wasm.js" <<'GLUE'

/** Replace the instance with a new one of the same module, after a call trapped. */
export function reset_instance() {
    const module = wasmModule;
    wasm = undefined;
    return initSync({ module });
}
GLUE
  cat >> "$DIST_DIR/wasm/org_eclipse_elk_wasm.d.ts" <<'GLUE'

/** Replace the instance with a new one of the same module, after a call trapped. */
export function reset_instance(): InitOutput;
GLUE

  # Node.js target: CommonJS glue that Node.js and Bun can require synchronously.
  # It loads the same .wasm binary, so only its glue is kept, next to the web glue.
  NODE_WASM_DIR="$(mktemp -d)"
  trap 'rm -rf "$NODE_WASM_DIR"' EXIT
  (cd "$WASM_DIR" && wasm-pack build --target nodejs --out-dir "$NODE_WASM_DIR" --release)
  if ! cmp -s "$NODE_WASM_DIR/org_eclipse_elk_wasm_bg.wasm" "$DIST_DIR/wasm/org_eclipse_elk_wasm_bg.wasm"; then
    echo "ERROR: the nodejs and web WASM targets produced different binaries." >&2
    exit 1
  fi
  cp "$NODE_WASM_DIR/org_eclipse_elk_wasm.js" "$DIST_DIR/wasm/org_eclipse_elk_wasm.node.cjs"
  echo "WASM build complete."
else
  echo "WARNING: wasm-pack not found. Skipping WASM build."
  echo "Install with: cargo install wasm-pack"
fi

# 2. Native addon build (stripped of symbols)
echo "--- Building native addon ---"
if [ -n "$ELK_RS_SKIP_NATIVE" ]; then
  echo "Skipped (ELK_RS_SKIP_NATIVE)."
elif [ -n "$NAPI_CLI" ] && [ -f "$NAPI_DIR/Cargo.toml" ]; then
  if [ -n "$NAPI_TARGET" ]; then
    (cd "$NAPI_DIR" && CARGO_PROFILE_RELEASE_STRIP=symbols $NAPI_CLI build --release --platform --target "$NAPI_TARGET" --output-dir "$DIST_DIR")
  else
    (cd "$NAPI_DIR" && CARGO_PROFILE_RELEASE_STRIP=symbols $NAPI_CLI build --release --platform --output-dir "$DIST_DIR")
  fi
  # napi-rs also writes JS/TS bindings; this package ships its own.
  rm -f "$DIST_DIR/index.d.ts" "$DIST_DIR/index.js"
  echo "Native addon build complete."
else
  echo "WARNING: npx/bunx not found or napi crate missing. Skipping native build."
fi

echo "=== Build complete ==="
echo "Output: $DIST_DIR/"
ls -la "$DIST_DIR/"
