#!/usr/bin/env bash
# LinkageLab - pull the working branch and start the local server.
#   ./dev-branch.sh [branch]   (branch defaults to the .dev-branch file, then main)
set -u
cd "$(dirname "$0")"

BRANCH="${1:-}"
[ -z "$BRANCH" ] && [ -f .dev-branch ] && BRANCH="$(head -n1 .dev-branch | tr -d '[:space:]')"
[ -z "$BRANCH" ] && BRANCH=main
PORT="${PORT:-8000}"

echo "========================================"
echo "  LinkageLab dev launcher"
echo "  Branch: $BRANCH"
echo "  Folder: $PWD"
echo "========================================"

command -v git >/dev/null 2>&1 || { echo "[!] git not found. Install it from https://git-scm.com/"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "[!] node not found. Install Node.js LTS from https://nodejs.org/"; exit 1; }

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "[!] You have uncommitted changes; commit or discard them first."
    git status --short
    exit 1
fi

echo "[1/3] Fetching origin/$BRANCH ..."
git fetch origin "$BRANCH" || { echo "[!] Could not fetch '$BRANCH' from origin."; exit 1; }
CURRENT="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT" != "$BRANCH" ]; then
    echo "      Switching from $CURRENT to $BRANCH ..."
    if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
        git checkout "$BRANCH" || exit 1
    else
        git checkout -b "$BRANCH" --track "origin/$BRANCH" || exit 1
    fi
fi
git pull --ff-only origin "$BRANCH" || { echo "[!] Branch could not be fast-forwarded; resolve local commits first."; exit 1; }
echo "      Now at: $(git log -1 --pretty=format:'%h  %s  (%cr)')"
echo

if [ ! -d node_modules ]; then
    echo "[2/3] First run: installing dependencies (npm ci) ..."
    npm ci --no-audit --no-fund || echo "      npm ci failed; the app itself needs no dependencies, continuing."
else
    echo "[2/3] Dependencies present."
fi
echo

open_url() {
    local url="$1"
    if command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 &
    else echo "      Open $url in your browser."; fi
}

if (command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1) \
   || (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$PORT "); then
    echo "[3/3] Something is already listening on port $PORT - reusing it."
    echo "      If that is an OLD server, stop it and run this again."
    open_url "http://localhost:$PORT/index.html"
    echo "      Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) after each update."
    exit 0
fi

echo "[3/3] Starting server on http://localhost:$PORT  (Ctrl+C to stop)"
echo "      Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) after each update."
( sleep 2; open_url "http://localhost:$PORT/index.html" ) &
exec node scripts/static-server.mjs --port "$PORT"
