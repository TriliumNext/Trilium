#!/usr/bin/env bash
# Deno Desktop's prebuilt webview backend dynamically links against WebKitGTK,
# which NixOS does not expose in a global library path. This helper composes
# an LD_LIBRARY_PATH from nixpkgs and launches the app. Requires nix and
# nix-ld (the deno binary itself and the compiled launcher rely on it).
set -euo pipefail
cd "$(dirname "$0")"

# `deno desktop` needs Deno >= 2.9, which nixpkgs may not have yet. Prefer
# $DENO_BIN, then PATH, then a locally downloaded official binary.
DENO_BIN="${DENO_BIN:-deno}"
if ! "$DENO_BIN" desktop --help >/dev/null 2>&1; then
    if [ -x "$HOME/.local/share/deno29/deno" ]; then
        DENO_BIN="$HOME/.local/share/deno29/deno"
    else
        echo "error: this needs Deno >= 2.9 (with the 'deno desktop' subcommand)." >&2
        echo "Download it with:" >&2
        echo "  mkdir -p ~/.local/share/deno29 && curl -sLo /tmp/deno.zip \\" >&2
        echo "    https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip \\" >&2
        echo "    && unzip -o /tmp/deno.zip -d ~/.local/share/deno29" >&2
        echo "or point DENO_BIN at a Deno >= 2.9 binary." >&2
        exit 1
    fi
fi

libs=$(nix build --no-link --print-out-paths \
    "nixpkgs#webkitgtk_4_1" "nixpkgs#gtk3" "nixpkgs#glib.out" \
    "nixpkgs#libsoup_3" "nixpkgs#stdenv.cc.cc.lib")
LD_LIBRARY_PATH=$(echo "$libs" | sed 's|$|/lib|' | paste -sd:)
export LD_LIBRARY_PATH

# The native shell spawns the core server as a `deno run` child process
# and needs to know which binary to use.
export DENO_BIN

case "${1:-start}" in
    start) ;;
    smoke) export TRILIUM_SMOKE=1 ;;
    wasm) export TRILIUM_WASM=1 ;;
    smoke-wasm) export TRILIUM_SMOKE=1 TRILIUM_WASM=1 ;;
    *) echo "usage: $0 [start|smoke|wasm|smoke-wasm]" >&2; exit 1 ;;
esac

# The `deno desktop` dev-runner compiles and bundles, but (as of 2.9.2, at
# least in this environment) exits without actually launching the app — so
# build first, then run the bundled binary directly. This also makes logs
# visible, which the detached runner never shows.
# Flags match the deno.json tasks:
# --no-check: the trilium-core graph is not type-checkable under Deno's
#   checker (needs @types/node etc.); the child server runs it anyway.
# --node-modules-dir=none: the shell binary uses only jsr:@std + node:
#   builtins, so it must not embed pnpm's node_modules (that balloons the
#   binary from ~150 KB to >1 GB). npm/core deps live in the child process.
# --allow-run: unrestricted because the shell spawns $DENO_BIN itself.
"$DENO_BIN" desktop --no-check --node-modules-dir=none \
    --allow-env --allow-read --allow-net --allow-write --allow-run main.ts

exec ./desktop-deno/desktop-deno
