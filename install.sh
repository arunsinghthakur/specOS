#!/usr/bin/env bash
# specOS installer.
#
# Remote (once pushed to a git host):
#   curl -fsSL https://raw.githubusercontent.com/arunsinghthakur/specOS/main/install.sh | bash
#
# Local (from an already-cloned checkout):
#   bash install.sh
#
# Both paths end up in the same place: a cloned/updated checkout, dependencies installed,
# built, and the `specos` command linked onto your PATH.
#
# Env vars (all optional):
#   SPECOS_REPO_URL     git remote to clone when not already inside a checkout
#                        (default below — update once you've pushed this repo somewhere)
#   SPECOS_INSTALL_DIR  where to clone to when not already inside a checkout (default: ~/specos)

set -euo pipefail

REPO_URL="${SPECOS_REPO_URL:-https://github.com/arunsinghthakur/specOS.git}"
INSTALL_DIR="${SPECOS_INSTALL_DIR:-$HOME/specos}"

log() { printf '==> %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not found on PATH."
}

require_cmd git
require_cmd node
require_cmd npm

node_major=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$node_major" -lt 20 ]; then
  die "Node.js >= 20 is required (found $(node -v)). Install a newer Node and re-run."
fi

# Are we already inside a specOS checkout? (bash install.sh from a local clone)
if [ -f "package.json" ] && grep -q '"name": "specos"' package.json 2>/dev/null; then
  PROJECT_DIR="$(pwd)"
  log "Running from an existing checkout at $PROJECT_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  log "Found existing checkout at $INSTALL_DIR — pulling latest"
  git -C "$INSTALL_DIR" pull --ff-only
  PROJECT_DIR="$INSTALL_DIR"
else
  log "Cloning specOS into $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
  PROJECT_DIR="$INSTALL_DIR"
fi

cd "$PROJECT_DIR"

log "Installing dependencies"
npm install

log "Building"
npm run build

log "Linking the 'specos' command onto your PATH"
npm link

log "Done. Run 'specos --help' to get started."
