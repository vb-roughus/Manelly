#!/usr/bin/env bash
# Installs what Manelly needs on macOS (via Homebrew), builds it and starts it.
#
#   ./scripts/start-mac.sh            start on port 3000
#   PORT=3001 ./scripts/start-mac.sh  start on another port
#
# Stop Manelly with Ctrl+C. Restarting and updating from Server → Allgemein in Manelly
# keep this script running: it starts Manelly again. Written for the bash 3.2 that ships with macOS.
set -euo pipefail

NODE_FORMULA="node@22"
BUILD_LOG="${TMPDIR:-/tmp}/manelly-build.log"

info() { printf '\033[1;35m▸\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31m✗\033[0m %s\n' "$*" >&2
  exit 1
}

cd "$(dirname "$0")/.."

[ "$(uname -s)" = "Darwin" ] || fail "Dieses Skript ist für macOS gedacht. Für andere Systeme siehe README."

# The build tools (Vite) need Node.js 22.12 or newer.
node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [major, minor] = process.versions.node.split(".").map(Number);
             process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' 2>/dev/null
}

load_brew() {
  command -v brew >/dev/null 2>&1 && return 0
  # A fresh Homebrew is not on the PATH until the shell profile is reloaded.
  local candidate
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "$candidate" ]; then
      eval "$("$candidate" shellenv)"
      return 0
    fi
  done
  return 1
}

install_brew() {
  info "Homebrew ist nicht installiert."
  printf 'Jetzt von https://brew.sh installieren? [j/N] '
  local answer=""
  read -r answer || true
  case "$answer" in
    j | J | ja | Ja | y | Y | yes) ;;
    *) fail "Abgebrochen. Installiere Homebrew von https://brew.sh und starte das Skript danach erneut." ;;
  esac
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_brew || fail "Homebrew wurde nicht gefunden. Öffne ein neues Terminal und starte das Skript erneut."
}

# --- Port --------------------------------------------------------------------
port="${PORT:-}"
if [ -z "$port" ] && [ -f .env ]; then
  port="$(sed -n 's/^PORT=//p' .env | tail -n 1)"
fi
port="${port:-3000}"
export PORT="$port"
url="http://localhost:$port"

if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Port $port ist schon belegt – läuft Manelly bereits? Dann öffne $url. Sonst starte mit: PORT=3001 $0"
fi

# --- Node.js -----------------------------------------------------------------
if node_ok; then
  info "Node.js $(node --version) ist vorhanden."
else
  load_brew || install_brew
  if ! brew list --versions "$NODE_FORMULA" >/dev/null 2>&1; then
    info "Installiere Node.js 22 mit Homebrew …"
    brew install "$NODE_FORMULA"
  fi
  # node@22 is keg-only, Homebrew does not put it on the PATH by itself.
  node_prefix="$(brew --prefix "$NODE_FORMULA")"
  export PATH="$node_prefix/bin:$PATH"
  node_ok || fail "Node.js aus Homebrew ($NODE_FORMULA) funktioniert nicht: $(node --version 2>&1 || true)"
  info "Verwende Node.js $(node --version) aus Homebrew."
fi

# --- Dependencies and build --------------------------------------------------
# npm records the installed state in node_modules/.package-lock.json; reinstall
# only when package-lock.json changed since then (e.g. after a git pull).
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  info "Installiere Abhängigkeiten …"
  npm ci --no-audit --no-fund
fi

info "Baue Manelly …"
if ! npm run build >"$BUILD_LOG" 2>&1; then
  cat "$BUILD_LOG" >&2
  fail "Der Build ist fehlgeschlagen (Log: $BUILD_LOG)."
fi

# --- Start -------------------------------------------------------------------
# Open the browser as soon as the server answers.
(
  for _ in $(seq 1 60); do
    if curl -fsS "$url/api/health" >/dev/null 2>&1; then
      open "$url"
      exit 0
    fi
    sleep 0.5
  done
) &

# Manelly asks for a restart with exit code 75 (RESTART_EXIT in server/src/manelly.ts), also after
# it updated itself; any other end, e.g. Ctrl+C, ends this script too.
export MANELLY_SUPERVISED=1
node_args=(server/dist/index.js)
if [ -f .env ]; then node_args=(--env-file=.env server/dist/index.js); fi

info "Starte Manelly auf $url – beenden mit Ctrl+C."
while true; do
  code=0
  node "${node_args[@]}" || code=$?
  [ "$code" = 75 ] || exit "$code"
  info "Starte Manelly neu …"
done
