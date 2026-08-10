#!/usr/bin/env bash
#
# Recompile better-sqlite3 from source inside an older container, so the addon we
# ship targets an older glibc/libstdc++ than upstream's bundled prebuilds.
#
# better-sqlite3 v13 ships N-API prebuilds for every platform. They are portable
# across runtimes, but they are linked against whatever toolchain upstream builds
# on -- currently glibc 2.34/GCC 11 (x64) and glibc 2.38/GCC 13 (arm64). That is
# far newer than the assets previous Trilium releases shipped (glibc 2.29), and
# it drops distributions we still support (Debian 12 / Raspberry Pi OS bookworm
# on arm64, Ubuntu 20.04 / Debian 11 on x64). Nothing in better-sqlite3 needs a
# newer glibc; the floor is purely an artifact of the build host, so we rebuild
# on an older one and substitute the result.
#
# Usage: ./build-portable-better-sqlite3.sh [arch]
#   arch: x64 or arm64 (default: the host's arch)
#
# Environment variables:
#   BS3_BUILD_IMAGE     container image to compile in (default: node:22-bullseye).
#                       The image's glibc sets the floor, so this is the knob that
#                       decides which distributions we support:
#                         node:22-bullseye (glibc 2.31, GCC 10) -> Debian 11+,
#                           Ubuntu 20.04+; restores roughly the v0.104.1 floor.
#                         node:24-bookworm (glibc 2.36, GCC 12) -> Debian 12+,
#                           Ubuntu 22.04+, RHEL 9+.
#                       The Node version is irrelevant to the result: the addon is
#                       N-API, so it does not bind to the runtime it was built on.
#                       g++/make come from buildpack-deps in the full (non-slim)
#                       images; python3 does not, so it is apt-installed when
#                       missing (which also makes -slim images usable).
#   BS3_DOCKER          command used to reach Docker (default: docker). Set to
#                       "sudo docker" where the daemon needs root.
#   BS3_NO_DOCKER       if set, compile directly on the host instead of in a
#                       container. Only useful for testing the mechanism; the
#                       resulting floor is the host's, not the image's.
#   BS3_PRUNE_PREBUILDS if set, delete the prebuilds for every other platform
#                       from the shipped copies (saves ~15 MB per artifact).
#
# Must run after `pnpm install` and before any `*:build` task, since the build
# scripts copy node_modules/better-sqlite3 into dist/ verbatim.

set -euo pipefail

ARCH="${1:-$(node -p 'process.arch')}"
IMAGE="${BS3_BUILD_IMAGE:-node:22-bullseye}"

case "$ARCH" in
    x64|arm64) ;;
    *) echo "Unsupported architecture: $ARCH (expected x64 or arm64)" >&2; exit 1 ;;
esac

TARGET="linux-$ARCH"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Report the highest versioned symbol an addon references from each of the two
# libraries whose version floors we care about. These are the numbers a host has
# to satisfy in order to load it.
floors() {
    local f="$1"
    if [ ! -f "$f" ] || ! command -v objdump > /dev/null; then
        echo "(unavailable)"
        return
    fi
    local glibc glibcxx
    glibc="$(objdump -T "$f" | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1)"
    glibcxx="$(objdump -T "$f" | grep -o 'GLIBCXX_[0-9.]*' | sort -uV | tail -1)"
    echo "${glibc:-none} / ${glibcxx:-none}"
}

# nodeLinker is "hoisted", so each package that depends on better-sqlite3 gets its
# own directory tree rather than a symlink into a single store location. The build
# scripts resolve <app>/node_modules first and fall back to the root, so every
# copy has to receive the rebuilt binary.
mapfile -t BS3_DIRS < <(find . -type d -name better-sqlite3 -path '*/node_modules/better-sqlite3' -not -path './*/dist/*' -not -path './node_modules/@types/*' | sort)
if [ "${#BS3_DIRS[@]}" -eq 0 ]; then
    echo "No better-sqlite3 installation found -- run 'pnpm install' first." >&2
    exit 1
fi

BUILD_DIR="${BS3_DIRS[0]}"
echo "Compiling in:  $BUILD_DIR"
echo "Target:        $TARGET"
echo "Before:        $(floors "$BUILD_DIR/prebuilds/$TARGET.node" 2>/dev/null || echo "(upstream prebuild)")"

# force_build is required: better-sqlite3's binding.gyp resolves both of its
# targets to `type: none` whenever a prebuild for the host exists, so an ordinary
# node-gyp run emits a stamp file and no addon at all.
BUILD_SCRIPT='
set -eu
bs3_dir="$1"
repo_root="$2"
owner="${3:-}"

# buildpack-deps (the base of the full node images) provides g++ and make but not
# python3, which node-gyp requires. Install whatever is missing rather than
# assuming, so both full and -slim images work.
missing=""
for tool in python3 make g++; do
    command -v "$tool" > /dev/null 2>&1 || missing="$missing $tool"
done
if [ -n "$missing" ] && [ -n "$owner" ]; then
    echo "Installing build tools:$missing"
    apt_opts=""
    # A Debian suite stops being served from deb.debian.org once it goes EOL and
    # moves to archive.debian.org (bullseye: 2026-08-31). We deliberately build on
    # an old release to keep the glibc floor low -- see the header -- so handle the
    # move rather than being broken by it. Archived Release files are expired by
    # definition, hence Check-Valid-Until=false.
    if ! apt-get update -qq 2> /dev/null; then
        echo "deb.debian.org did not serve this suite; retrying via archive.debian.org"
        for src in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
            [ -f "$src" ] || continue
            sed -i -e "s|deb\.debian\.org|archive.debian.org|g" \
                   -e "s|security\.debian\.org|archive.debian.org|g" "$src"
        done
        apt_opts="-o Acquire::Check-Valid-Until=false"
        # Tolerate a non-zero exit: -updates/-backports are absent from the
        # archive, but the main suite still indexes, which is all we need.
        apt-get $apt_opts update -qq || true
    fi
    apt-get install -y -qq --no-install-recommends $apt_opts $missing
elif [ -n "$missing" ]; then
    echo "Missing build tools:$missing" >&2
    exit 1
fi

# Prefer the node-gyp bundled with npm (present in the official node images).
# Fall back to the workspace copy, which nixpkgs-style slim runtimes need since
# they strip node-gyp out of npm.
node_gyp="${BS3_NODE_GYP:-}"
if [ -z "$node_gyp" ]; then
    for candidate in \
        "$(npm root -g)/npm/node_modules/node-gyp/bin/node-gyp.js" \
        "$repo_root/node_modules/.bin/node-gyp"; do
        if [ -f "$candidate" ]; then node_gyp="$candidate"; break; fi
    done
fi
if [ -z "$node_gyp" ]; then
    echo "No node-gyp found. Set BS3_NODE_GYP to point at one." >&2
    exit 1
fi
echo "Using node-gyp: $node_gyp"

cd "$bs3_dir"
rm -rf build
export npm_config_force_build=1
node "$node_gyp" rebuild --release

# The container runs as root so it can apt-install python3, which would otherwise
# leave root-owned files in the bind-mounted workspace.
if [ -n "$owner" ]; then
    chown -R "$owner" "$bs3_dir"
fi
'

if [ -n "${BS3_NO_DOCKER:-}" ]; then
    echo "Building on the host (BS3_NO_DOCKER set) -- floors will be the host's."
    bash -c "$BUILD_SCRIPT" _ "$BUILD_DIR" "$REPO_ROOT"
else
    read -r -a DOCKER_CMD <<< "${BS3_DOCKER:-docker}"
    if ! "${DOCKER_CMD[@]}" info > /dev/null 2>&1; then
        echo "Cannot reach the Docker daemon via '${BS3_DOCKER:-docker}'." >&2
        echo "If Docker needs root on this machine, re-run with:" >&2
        echo "  BS3_DOCKER='sudo docker' $0 $ARCH" >&2
        exit 1
    fi
    # Be explicit about the target platform: a no-op on CI, where the arm64 job
    # runs on a native arm64 runner, but it lets the arm64 build be reproduced
    # locally on an x64 machine that has binfmt/qemu registered.
    DOCKER_PLATFORM="linux/$([ "$ARCH" = "x64" ] && echo amd64 || echo arm64)"
    echo "Building in:   $IMAGE ($DOCKER_PLATFORM, via ${DOCKER_CMD[*]})"
    "${DOCKER_CMD[@]}" run --rm \
        --platform "$DOCKER_PLATFORM" \
        -e npm_config_devdir=/tmp/.node-gyp \
        -e "BS3_NODE_GYP=${BS3_NODE_GYP:-}" \
        -v "$REPO_ROOT:/repo" \
        -w /repo \
        "$IMAGE" \
        bash -c "$BUILD_SCRIPT" _ "/repo/${BUILD_DIR#./}" /repo "$(id -u):$(id -g)"
fi

COMPILED="$BUILD_DIR/build/Release/better_sqlite3.node"
if [ ! -f "$COMPILED" ]; then
    echo "Compile produced no addon at $COMPILED (force_build did not take effect?)" >&2
    exit 1
fi

# Substitute the compiled addon for the upstream prebuild in every copy. Replace
# via rename rather than writing in place: these files are hardlinks into the
# pnpm store, and an in-place write would mutate the store for every project on
# the machine.
for dir in "${BS3_DIRS[@]}"; do
    dest="$dir/prebuilds/$TARGET.node"
    mkdir -p "$dir/prebuilds"
    cp "$COMPILED" "$dest.tmp"
    mv -f "$dest.tmp" "$dest"

    if [ -n "${BS3_PRUNE_PREBUILDS:-}" ]; then
        find "$dir/prebuilds" -name '*.node' ! -name "$TARGET.node" -delete
    fi
    echo "Installed:     $dest"
done

echo "After:         $(floors "$COMPILED")"

# Prove the substituted binary actually loads and can execute a query, so a
# silently broken artifact can't reach the release.
node -e '
const Database = require("better-sqlite3");
const db = new Database(":memory:");
const { v } = db.prepare("select sqlite_version() v").get();
db.close();
console.log("Verified:      loads, SQLite " + v);
'
