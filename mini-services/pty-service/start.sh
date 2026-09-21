#!/usr/bin/env bash
# Start PTY service with auto-restart watchdog.
# This is the recommended way to start the PTY service — it will
# automatically restart if the service crashes.

LOG="/home/z/my-project/.vnc-logs/pty-service.log"
PIDFILE="/tmp/pty.pid"
PY="/home/z/.venv/bin/python3"
SCRIPT="/home/z/my-project/mini-services/pty-service/server.py"

mkdir -p "$(dirname "$LOG")"

# Kill any existing instance
[ -f "$PIDFILE" ] && kill -9 $(cat "$PIDFILE") 2>/dev/null
pkill -9 -f "server.py.*pty" 2>/dev/null
sleep 1

# Start the watchdog loop (fully detached)
nohup setsid bash -c "
while true; do
    if ! ss -tln 2>/dev/null | grep -q ':3003 '; then
        echo \"[\$(date '+%H:%M:%S')] Starting PTY service…\" >> $LOG
        $PY -u $SCRIPT >> $LOG 2>&1 &
        PTY_PID=\$!
        echo \$PTY_PID > $PIDFILE
        sleep 3
        if ss -tln 2>/dev/null | grep -q ':3003 '; then
            echo \"[\$(date '+%H:%M:%S')] ✓ PTY service started (PID \$PTY_PID)\" >> $LOG
        else
            echo \"[\$(date '+%H:%M:%S')] ✗ Failed — will retry\" >> $LOG
        fi
    fi
    sleep 3
done
" > /dev/null 2>&1 < /dev/null &
WATCHDOG_PID=$!
echo $WATCHDOG_PID > /tmp/pty-watchdog.pid
echo "Watchdog PID: $WATCHDOG_PID"
disown $WATCHDOG_PID 2>/dev/null || true

# Wait for the service to come up
sleep 5
if ss -tln 2>/dev/null | grep -q ':3003 '; then
    echo "✓ PTY service is running on port 3003"
else
    echo "✗ PTY service failed to start"
fi
