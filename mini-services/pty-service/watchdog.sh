#!/usr/bin/env bash
# Watchdog — restarts the PTY service if it dies.
cd /home/z/my-project/mini-services/pty-service
while true; do
    if ! ss -tln 2>/dev/null | grep -q ':3003 '; then
        echo "[$(date)] PTY service not running — starting…"
        setsid bun run index.ts >> /home/z/my-project/.vnc-logs/pty-service.log 2>&1 < /dev/null &
        disown
        sleep 3
        if ss -tln 2>/dev/null | grep -q ':3003 '; then
            echo "[$(date)] PTY service started ✓"
        else
            echo "[$(date)] PTY service failed to start — will retry in 5s"
        fi
    fi
    sleep 5
done
