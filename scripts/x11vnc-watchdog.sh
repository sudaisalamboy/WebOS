#!/bin/bash
# Watchdog: keeps x11vnc alive, restarts if it dies
export LD_LIBRARY_PATH=/home/z/my-project/tools/x11vnc/lib:${LD_LIBRARY_PATH:-}
X11VNC=/home/z/my-project/tools/x11vnc/bin/x11vnc
LOG=/home/z/my-project/.vnc-logs/x11vnc.log
PID_FILE=/home/z/my-project/.vnc-pids/x11vnc.pid

while true; do
  # Check if x11vnc is alive
  ALIVE=0
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      ALIVE=1
    fi
  fi
  
  if [ "$ALIVE" = "0" ]; then
    echo "[$(date)] Starting x11vnc..." >> "$LOG"
    $X11VNC -display :99 -localhost -rfbport 5900 -rfbauth /home/z/.vnc/passwd \
      -forever -shared -noxdamage -noscr -nowf -nowcr -cursor arrow >> "$LOG" 2>&1 &
    PID=$!
    echo "$PID" > "$PID_FILE"
    sleep 2
    if ! kill -0 "$PID" 2>/dev/null; then
      echo "[$(date)] x11vnc failed to start, retrying in 3s..." >> "$LOG"
      sleep 3
    else
      echo "[$(date)] x11vnc started PID=$PID" >> "$LOG"
    fi
  fi
  
  sleep 2
done
