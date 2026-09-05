#!/usr/bin/env bash
LOGFILE="/home/z/my-project/download/leads/send_phase_log.txt"
PIDFILE="/tmp/sender.pid"

# Kill existing
[ -f "$PIDFILE" ] && kill -9 $(cat "$PIDFILE") 2>/dev/null
pkill -9 -f "send_phase" 2>/dev/null
sleep 1

cd /home/z/my-project/scripts/leads
# Run the sender script with full detachment
nohup setsid /home/z/.venv/bin/python3 -u /home/z/my-project/scripts/leads/run_send_phase.py >> "$LOGFILE" 2>&1 < /dev/null &
PID=$!
echo $PID > "$PIDFILE"
echo "Started sender daemon PID: $PID"
disown $PID 2>/dev/null || true
exit 0
