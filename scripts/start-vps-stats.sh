#!/bin/bash
# Persistent launcher for vps-stats mini-service
# Designed to survive parent shell exits via setsid + nohup + disown

set -e

SERVICE_DIR="/home/z/my-project/mini-services/vps-stats"
LOG_FILE="/home/z/my-project/.zscripts/mini-service-vps-stats.log"
PID_FILE="/home/z/my-project/.zscripts/mini-service-vps-stats.pid"

# Kill any existing instance
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing instance (PID $OLD_PID)..."
    kill -9 "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
fi
pkill -f 'vps-stats/index.ts' 2>/dev/null || true
sleep 1

cd "$SERVICE_DIR"

# Fully detach: setsid (new session) + nohup + redirect stdio + disown
setsid bash -c "exec bun index.ts" > "$LOG_FILE" 2>&1 < /dev/null &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"
disown "$NEW_PID" 2>/dev/null || true

echo "Started vps-stats (PID $NEW_PID)"
sleep 3

# Verify it's listening
if ss -tlnp 2>/dev/null | grep -q ':3003'; then
  echo "OK: port 3003 is listening"
  ss -tlnp 2>/dev/null | grep ':3003'
else
  echo "FAIL: port 3003 not listening"
  echo "--- log ---"
  cat "$LOG_FILE"
  exit 1
fi
