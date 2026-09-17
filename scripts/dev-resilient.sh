#!/usr/bin/env bash
# Runs the local dev server for the demo and restarts it automatically if it
# ever exits or crashes. The plain `npx vite` process has died silently twice
# in one night with nothing keeping it alive between terminal closes/crashes;
# this closes that gap during a live presentation, where nobody has time to
# notice a dead localhost tab and manually restart it mid-demo.
set -u
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Starting AccessLens dev server on :5173 (auto-restarts on crash; Ctrl+C to stop for real)"
while true; do
  npx vite --port 5173 --strictPort
  code=$?
  if [ "$code" -eq 130 ] || [ "$code" -eq 143 ]; then
    # 130 = SIGINT (Ctrl+C), 143 = SIGTERM: a real, intentional stop.
    echo "Dev server stopped intentionally."
    break
  fi
  echo "Dev server exited unexpectedly (code $code). Restarting in 1s..."
  sleep 1
done
