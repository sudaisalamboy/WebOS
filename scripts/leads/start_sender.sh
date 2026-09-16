#!/usr/bin/env bash
# Daemon wrapper that fully detaches the email sender from the controlling shell.
# Uses nohup + disown + setsid for triple-layered detachment.

LOGFILE="/home/z/my-project/download/leads/send_log.txt"
PIDFILE="/tmp/email_sender.pid"

# Kill any existing sender
if [ -f "$PIDFILE" ]; then
    OLDPID=$(cat "$PIDFILE")
    kill -9 "$OLDPID" 2>/dev/null
    pkill -9 -f "send_emails.py" 2>/dev/null
    sleep 2
fi

pkill -9 -f "send_emails.py" 2>/dev/null
sleep 1

# Start the sender with nohup (immune to SIGHUP) + setsid (new session)
cd /home/z/my-project/scripts/leads
nohup setsid /home/z/.venv/bin/python3 -u send_emails.py > "$LOGFILE" 2>&1 < /dev/null &
PID=$!
echo $PID > "$PIDFILE"
echo "Started sender PID: $PID"

# Wait a moment to confirm it's alive
sleep 3
if kill -0 $PID 2>/dev/null; then
    echo "✓ Process alive"
else
    echo "✗ Process died immediately"
    cat "$LOGFILE"
    exit 1
fi

# Disown so bash doesn't send SIGHUP on exit
disown $PID 2>/dev/null || true
exit 0
