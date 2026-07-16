#!/usr/bin/env bash
#
# From-source build of the Clipper2 C++ -> WASM artifact — the CI-reproducible
# path referenced by the task card's "build reproducible in CI".
#
# M0 ships the prebuilt `clipper2-wasm` npm artifact (see prepare-wasm.mjs); this
# script exists so the binary can be rebuilt from source and diffed. It is gated
# on the Emscripten SDK and is intended to run in a dedicated CI job
# (mymindstorm/setup-emsdk) or locally after `source /path/to/emsdk_env.sh`.
#
# ErikSom/Clipper2-WASM has no top-level CMake project: it vendors the Clipper2
# core as a git submodule (AngusJohnson/Clipper2) and links its prebuilt static
# libs from a hand-rolled em++ script. So the reproducible build is two stages,
# mirroring the upstream README.dev.md:
#   1. CMake-build the Clipper2 core static libs (libClipper2Z.a, libClipper2Zutils.a).
#   2. Run upstream's clipper2-wasm/compile-wasm.sh to emit the wasm + JS glue.
#
# Usage:  pnpm --filter geometry-wasm build:wasm
# Env:    CLIPPER2_WASM_REF  git ref of ErikSom/Clipper2-WASM (default: main)
set -euo pipefail

if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc (Emscripten) is not on PATH." >&2
  echo "  Install the emsdk and 'source emsdk_env.sh', or run" >&2
  echo "  'pnpm --filter geometry-wasm build' to use the prebuilt npm artifact." >&2
  exit 1
fi

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$PKG_DIR/wasm-build"           # git-ignored scratch
VENDOR_DIR="$PKG_DIR/vendor"              # tracked output
SRC_DIR="$BUILD_DIR/Clipper2-WASM"
REF="${CLIPPER2_WASM_REF:-main}"

echo "[geometry-wasm] building Clipper2 -> WASM from source (ref: $REF)"
mkdir -p "$BUILD_DIR" "$VENDOR_DIR"

# Clone the WASM wrapper; the Clipper2 core lives in the `clipper2` submodule.
if [ ! -d "$SRC_DIR/.git" ]; then
  git clone --depth 1 --branch "$REF" \
    https://github.com/ErikSom/Clipper2-WASM.git "$SRC_DIR"
fi
git -C "$SRC_DIR" submodule update --init --recursive --depth 1

# Stage 1: CMake-build the Clipper2 core static libs the wrapper links against.
# Utilities stay ON (libClipper2Zutils.a is required); tests/examples are off to
# keep the Emscripten build lean and dependency-free.
cd "$SRC_DIR/clipper2/CPP"
emcmake cmake -B build -S . \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS_RELEASE="-O3" \
  -DCLIPPER2_HI_PRECISION=OFF \
  -DCLIPPER2_TESTS=OFF \
  -DCLIPPER2_EXAMPLES=OFF
cmake --build build -j"$(nproc 2>/dev/null || echo 4)" \
  --target Clipper2Z Clipper2Zutils

# Stage 2: emit the wasm + JS glue via the upstream script (run from repo root;
# its paths are relative). `prod` matches the flags of the prebuilt npm artifact.
cd "$SRC_DIR"
bash clipper2-wasm/compile-wasm.sh prod

# Collect the emitted glue + wasm next to the package for inspection/diffing
# against the prebuilt npm artifact (node_modules/clipper2-wasm/dist).
find "$SRC_DIR/clipper2-wasm/dist" \
  \( -name 'clipper2z*.wasm' -o -name 'clipper2z*.js' \) -exec cp {} "$VENDOR_DIR/" \;

echo "[geometry-wasm] built Clipper2 WASM into $VENDOR_DIR"
echo "[geometry-wasm] diff against node_modules/clipper2-wasm/dist to verify reproducibility."
