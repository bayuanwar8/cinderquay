#!/usr/bin/env bash
# shoot.sh — staged screenshot for Cinderquay (workstream D).
# Usage: tools/shoot.sh <shot-name> <out.jpg> [port] [seed]
#   shot-name: combat | buy | plant | scores | start | end
# Serves this worktree on localhost, screenshots it with
# chrome-headless-shell (reused hs-profile-1-board, swiftshader),
# kills the server by PID (never pkill -f). Console output goes to
# <out>.console.log next to the screenshot.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHOT="${1:?shot name required}"
OUT="${2:?output jpg required}"
PORT="${3:-8901}"
SEED="${4:-1}"
HS="$HOME/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell"
PROFILE="$HOME/workspace/makefun/.tmp/hs-profile-1-board"
URL="http://127.0.0.1:${PORT}/game/?shot=${SHOT}&seed=${SEED}"

cd "$ROOT" || exit 1
python3 -m http.server "$PORT" >/tmp/cq-http-$PORT.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; wait $SRV 2>/dev/null' EXIT
for _ in $(seq 1 50); do
  curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/game/" 2>/dev/null && break
  sleep 0.2
done
"$HS" --enable-unsafe-swiftshader --use-angle=swiftshader --no-sandbox \
  --disable-dev-shm-usage --hide-scrollbars --enable-logging=stderr \
  --user-data-dir="$PROFILE" --window-size=1280,720 \
  --virtual-time-budget=15000 --screenshot="$OUT" "$URL" \
  >"${OUT}.console.log" 2>&1
RC=$?
kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; trap - EXIT
if [ $RC -ne 0 ]; then echo "SHOT-FAIL rc=$RC shot=$SHOT"; exit $RC; fi
SIZE=$(stat -c%s "$OUT")
SHA=$(sha256sum "$OUT" | cut -d' ' -f1)
ERR=$(grep -ciE 'CONSOLE.*(Uncaught|Error|Failed to load|net::ERR)' "${OUT}.console.log" || true)
echo "SHOT-OK $OUT ${SIZE}B sha256=$SHA console_errors=$ERR"
