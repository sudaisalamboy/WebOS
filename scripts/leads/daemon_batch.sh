#!/usr/bin/env bash
# Daemon launcher for the next_batch pipeline.
# Uses nohup + setsid + disown for full detachment.
# A watchdog loop restarts the Python process if it dies unexpectedly.

LOGFILE="/home/z/my-project/download/leads/next_batch_log.txt"
PIDFILE="/tmp/next_batch.pid"
SCRIPT="/home/z/my-project/scripts/leads/next_batch_robust.py"

# Kill any existing instance
if [ -f "$PIDFILE" ]; then
    kill -9 $(cat "$PIDFILE") 2>/dev/null
    pkill -9 -f "next_batch_robust.py" 2>/dev/null
    sleep 2
fi

# Start in a fully detached session
cd /home/z/my-project/scripts/leads
nohup setsid /home/z/.venv/bin/python3 -u "$SCRIPT" >> "$LOGFILE" 2>&1 < /dev/null &
PID=$!
echo $PID > "$PIDFILE"
echo "Started batch daemon PID: $PID"

# Disown so bash doesn't send SIGHUP
disown $PID 2>/dev/null || true
exit 0
