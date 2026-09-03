#!/bin/bash
# Start / restart the Tor daemon for WebOS
#
# - Uses the bundled tor binary at /home/z/my-project/tor/bin/tor
# - Reads config from /home/z/my-project/tor/config/torrc
# - Runs as a detached background process (survives parent shell exits)
# - Writes logs to /home/z/my-project/tor/log/notice.log and stdout.log
#
# Usage:
#   ./start-tor.sh          # restart (kill + start)
#   ./start-tor.sh start    # start only (no kill)
#   ./start-tor.sh stop     # stop only

set -e

TOR_BIN="/home/z/my-project/tor/bin/tor"
TORRC="/home/z/my-project/tor/config/torrc"
DATA_DIR="/home/z/my-project/tor/data"
LOG_DIR="/home/z/my-project/tor/log"
PID_FILE="/home/z/my-project/tor/tor.pid"
STDOUT_LOG="/home/z/my-project/tor/tor-stdout.log"

mkdir -p "$DATA_DIR" "$LOG_DIR"
chmod 700 "$DATA_DIR"

# Stop any existing tor process
stop_tor() {
  if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      echo "Stopping existing tor (PID $OLD_PID)..."
      kill -TERM "$OLD_PID" 2>/dev/null || true
      sleep 1
      kill -9 "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
  pkill -f "$TOR_BIN" 2>/dev/null || true
  sleep 1
}

# Start a fresh tor
start_tor() {
  if [ ! -x "$TOR_BIN" ]; then
    echo "ERROR: tor binary not found at $TOR_BIN" >&2
    exit 1
  fi

  # Make sure LD_LIBRARY_PATH picks up the bundled libs
  export LD_LIBRARY_PATH="$(dirname "$TOR_BIN"):${LD_LIBRARY_PATH:-}"

  echo "Starting tor..."
  # Fully detach: setsid + nohup + redirect stdio + disown
  setsid bash -c "exec '$TOR_BIN' -f '$TORRC'" > "$STDOUT_LOG" 2>&1 < /dev/null &
  NEW_PID=$!
  echo "$NEW_PID" > "$PID_FILE"
  disown "$NEW_PID" 2>/dev/null || true

  echo "Tor started with PID $NEW_PID"
  echo "Logs: $STDOUT_LOG and $LOG_DIR/notice.log"
  echo "PID file: $PID_FILE"
}

case "${1:-restart}" in
  start)
    # only start if not already running
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
      echo "Tor already running (PID $(cat "$PID_FILE"))"
      exit 0
    fi
    start_tor
    ;;
  stop)
    stop_tor
    ;;
  restart|"")
    stop_tor
    start_tor
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
      echo "Tor is running (PID $(cat "$PID_FILE"))"
      exit 0
    else
      echo "Tor is not running"
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
