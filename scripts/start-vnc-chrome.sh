#!/bin/bash
# ============================================================
# start-vnc-chrome.sh — VNC Chrome session manager (v2)
# ============================================================
# Starts Xvfb + Chrome + x11vnc + websockify for Remote Chrome.
# All components are started via Python subprocess for reliable
# detachment (survives shell exits + container resets).
#
# Usage:
#   ./start-vnc-chrome.sh start    # start session
#   ./start-vnc-chrome.sh stop     # stop session
#   ./start-vnc-chrome.sh restart  # stop + start
#   ./start-vnc-chrome.sh status   # check if running
# ============================================================

PID_DIR="/home/z/my-project/.vnc-pids"
LOG_DIR="/home/z/my-project/.vnc-logs"
NOVNC_DIR="/home/z/my-project/tools/novnc"
CHROME_BIN="/home/z/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome"
XVFB_BIN="/usr/bin/Xvfb"
X11VNC_BIN="/home/z/my-project/tools/x11vnc/bin/x11vnc"
X11VNC_LIB="/home/z/my-project/tools/x11vnc/lib"

DISPLAY_NUM=99
WIDTH=1280
HEIGHT=800
VNC_PORT=5900
WS_PORT=6080
CDP_PORT=9222

mkdir -p "$PID_DIR" "$LOG_DIR"

# ---------- helpers ----------

is_port_open() {
  ss -tln 2>/dev/null | grep -q ":$1 " && return 0 || return 1
}

is_pid_alive() {
  local pid_file="$1"
  [ -f "$pid_file" ] || return 1
  local pid=$(cat "$pid_file" 2>/dev/null)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && return 0 || return 1
}

stop_proc() {
  local name="$1"
  local pid_file="$PID_DIR/${name}.pid"
  if [ -f "$pid_file" ]; then
    local pid=$(cat "$pid_file" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "  Stopping $name (PID $pid)..."
      kill -TERM "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
}

# ---------- ensure websockify is installed ----------
ensure_websockify() {
  local WS_BIN="/home/z/.venv/bin/websockify"
  if [ ! -x "$WS_BIN" ]; then
    echo "  websockify not found — installing..."
    pip3 install websockify 2>&1 | tail -3
  fi
  if [ ! -x "$WS_BIN" ]; then
    echo "ERROR: websockify install failed"
    return 1
  fi
  return 0
}

# ---------- start ----------

start_session() {
  # Check if already running
  if is_port_open $VNC_PORT && is_port_open $WS_PORT; then
    echo "VNC session already running."
    exit 0
  fi

  echo "Starting VNC Chrome session..."

  # 1. Xvfb
  if ! pgrep -f "Xvfb :${DISPLAY_NUM}" > /dev/null; then
    echo "  Starting Xvfb :${DISPLAY_NUM} (${WIDTH}x${HEIGHT})..."
    python3 -c "
import subprocess
p = subprocess.Popen(
    ['$XVFB_BIN', ':${DISPLAY_NUM}', '-screen', '0', '${WIDTH}x${HEIGHT}x24', '-ac', '-nolisten', 'tcp'],
    stdout=open('$LOG_DIR/xvfb.log','a'), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
    start_new_session=True
)
open('$PID_DIR/xvfb.pid','w').write(str(p.pid))
"
    sleep 2
  fi

  # 2. Chrome (with CDP + --remote-allow-origins + audio)
  if ! is_port_open $CDP_PORT; then
    echo "  Starting Chrome (CDP :${CDP_PORT})..."
    DESKTOP_ROOT="/home/z/my-project/tools/desktop-root/rootfs"
    MODULES_DIR="$DESKTOP_ROOT/usr/lib/pulse-17.0+dfsg1/modules"
    DESKTOP_LD_PATH="$DESKTOP_ROOT/usr/lib/x86_64-linux-gnu:$DESKTOP_ROOT/usr/lib/x86_64-linux-gnu/pulseaudio:$MODULES_DIR:$DESKTOP_ROOT/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu"
    python3 -c "
import subprocess, os
env = os.environ.copy()
env['DISPLAY'] = ':${DISPLAY_NUM}'
env['HOME'] = '/home/z'
env['XDG_RUNTIME_DIR'] = '/tmp/runtime-z'
env['PULSE_SERVER'] = 'unix:/tmp/runtime-z/pulse/native'
env['LD_LIBRARY_PATH'] = '$DESKTOP_LD_PATH'
p = subprocess.Popen([
    '$CHROME_BIN',
    '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--disable-sync', '--disable-translate', '--disable-session-crashed-bubble',
    '--ignore-certificate-errors', '--disable-blink-features=AutomationControlled',
    '--autoplay-policy=no-user-gesture-required',
    '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    '--remote-debugging-port=${CDP_PORT}',
    '--remote-allow-origins=*',
    '--window-size=900,600', '--window-position=200,100',
    'https://duckduckgo.com'
], env=env, stdout=open('$LOG_DIR/chrome.log','a'), stderr=subprocess.STDOUT,
   stdin=subprocess.DEVNULL, start_new_session=True)
open('$PID_DIR/chrome.pid','w').write(str(p.pid))
"
    sleep 8
  fi

  # 3. x11vnc (start watchdog if not running)
  if ! is_port_open $VNC_PORT; then
    echo "  Starting x11vnc watchdog (port ${VNC_PORT})..."
    # Kill any old x11vnc
    pkill -f "x11vnc" 2>/dev/null
    sleep 1
    # Start the Python watchdog
    python3 -c "
import subprocess
p = subprocess.Popen(
    ['python3', '/home/z/my-project/scripts/x11vnc-watchdog.py'],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
    start_new_session=True
)
open('$PID_DIR/watchdog.pid','w').write(str(p.pid))
"
    sleep 4
  fi

  # 4. websockify (start via Python subprocess for reliable detachment)
  if ! is_port_open $WS_PORT; then
    ensure_websockify || exit 1
    echo "  Starting websockify (port ${WS_PORT} → 127.0.0.1:${VNC_PORT})..."
    pkill -f "websockify" 2>/dev/null
    sleep 1
    python3 -c "
import subprocess
p = subprocess.Popen(
    ['/home/z/.venv/bin/websockify', '--web', '$NOVNC_DIR', '${WS_PORT}', '127.0.0.1:${VNC_PORT}'],
    stdout=open('$LOG_DIR/websockify.log','a'), stderr=subprocess.STDOUT,
    stdin=subprocess.DEVNULL, start_new_session=True
)
open('$PID_DIR/websockify.pid','w').write(str(p.pid))
"
    sleep 3
  fi

  # Summary
  echo ""
  echo "✓ VNC Chrome session started!"
  echo ""
  echo "  Xvfb:       $(is_port_open 99 2>/dev/null && echo '✓' || echo '—') :${DISPLAY_NUM}"
  echo "  Chrome CDP: $(is_port_open $CDP_PORT && echo '✓' || echo '—') :${CDP_PORT}"
  echo "  x11vnc:     $(is_port_open $VNC_PORT && echo '✓' || echo '—') :${VNC_PORT}"
  echo "  websockify: $(is_port_open $WS_PORT && echo '✓' || echo '—') :${WS_PORT}"
  echo ""
  echo "  noVNC URL: http://localhost:${WS_PORT}/vnc.html"
}

# ---------- stop ----------

stop_session() {
  echo "Stopping VNC Chrome session..."
  stop_proc websockify
  stop_proc watchdog
  pkill -f "x11vnc" 2>/dev/null || true
  stop_proc chrome
  pkill -f "chrome.*remote-debugging" 2>/dev/null || true
  stop_proc xvfb
  pkill -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true
  echo "Done."
}

# ---------- status ----------

status_session() {
  echo "VNC Chrome session status:"
  echo "  Xvfb:       $(pgrep -f 'Xvfb :99' > /dev/null && echo '✓ running' || echo '✗ stopped')"
  echo "  Chrome:     $(is_port_open $CDP_PORT && echo '✓ running' || echo '✗ stopped')"
  echo "  x11vnc:     $(is_port_open $VNC_PORT && echo '✓ running' || echo '✗ stopped')"
  echo "  websockify: $(is_port_open $WS_PORT && echo '✓ running' || echo '✗ stopped')"
}

# ---------- main ----------

case "${1:-restart}" in
  start)   start_session ;;
  stop)    stop_session ;;
  restart) stop_session; sleep 1; start_session ;;
  status)  status_session ;;
  *) echo "Usage: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
