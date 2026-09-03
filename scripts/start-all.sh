#!/bin/bash
PID_DIR="/home/z/my-project/.vnc-pids"
LOG_DIR="/home/z/my-project/.vnc-logs"
mkdir -p "$PID_DIR" "$LOG_DIR"

DESKTOP_ROOT="/home/z/my-project/tools/desktop-root/rootfs"
MODULES_DIR="$DESKTOP_ROOT/usr/lib/pulse-17.0+dfsg1/modules"
DESKTOP_LD_PATH="$DESKTOP_ROOT/usr/lib/x86_64-linux-gnu:$DESKTOP_ROOT/usr/lib/x86_64-linux-gnu/pulseaudio:$MODULES_DIR:$DESKTOP_ROOT/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu"

# 1. Tor
if ! pgrep -f "tor -f" > /dev/null; then
  echo "Starting Tor..."
  /home/z/my-project/scripts/start-tor.sh start 2>&1 | tail -1
  sleep 15
fi

# 2. Xvfb
if ! pgrep -f "Xvfb :99" > /dev/null; then
  echo "Starting Xvfb..."
  python3 -c "
import subprocess
p = subprocess.Popen(['/usr/bin/Xvfb',':99','-screen','0','1280x800x24','-ac','-nolisten','tcp'],
    stdout=open('$LOG_DIR/xvfb.log','a'),stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,start_new_session=True)
open('$PID_DIR/xvfb.pid','w').write(str(p.pid))
"
  sleep 2
fi

# 3. x11vnc watchdog
if ! pgrep -f "x11vnc-watchdog" > /dev/null; then
  echo "Starting x11vnc watchdog..."
  python3 -c "
import subprocess
p = subprocess.Popen(['python3','/home/z/my-project/scripts/x11vnc-watchdog.py'],
    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,stdin=subprocess.DEVNULL,start_new_session=True)
open('$PID_DIR/watchdog.pid','w').write(str(p.pid))
"
  sleep 4
fi

# 4. websockify (auto-install if missing)
if ! ss -tln 2>/dev/null | grep -q ":6080 "; then
  if [ ! -x /home/z/.venv/bin/websockify ]; then
    echo "Installing websockify..."
    pip3 install websockify 2>&1 | tail -1
  fi
  echo "Starting websockify..."
  python3 -c "
import subprocess
p = subprocess.Popen(['/home/z/.venv/bin/websockify','--web','/home/z/my-project/tools/novnc','6080','127.0.0.1:5900'],
    stdout=open('$LOG_DIR/websockify.log','a'),stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,start_new_session=True)
open('$PID_DIR/websockify.pid','w').write(str(p.pid))
"
  sleep 3
fi

# 5. Chrome
if ! ss -tln 2>/dev/null | grep -q ":9222 "; then
  echo "Starting Chrome..."
  cat > /tmp/start-chrome.sh << 'CHEOF'
#!/bin/bash
export DISPLAY=:99
export HOME=/home/z
export XDG_RUNTIME_DIR=/tmp/runtime-z
export PULSE_SERVER=unix:/tmp/runtime-z/pulse/native
export LD_LIBRARY_PATH="LD_PATH_PLACEHOLDER"
exec '/home/z/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' \
  --no-sandbox --disable-dev-shm-usage --no-first-run --no-default-browser-check \
  --disable-sync --disable-translate --disable-session-crashed-bubble \
  --ignore-certificate-errors --disable-blink-features=AutomationControlled \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream --use-fake-device-for-media-stream \
  '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' \
  --remote-debugging-port=9222 '--remote-allow-origins=*' \
  --window-size=1366,768 --window-position=0,0 \
  --load-extension=/home/z/my-project/tools/camera-extension \
  --disable-features=IsolateOrigins,site-per-process \
  --password-store=basic --use-mock-keychain \
  'https://duckduckgo.com'
CHEOF
  sed -i "s|LD_PATH_PLACEHOLDER|$DESKTOP_LD_PATH|g" /tmp/start-chrome.sh
  setsid bash /tmp/start-chrome.sh > "$LOG_DIR/chrome.log" 2>&1 < /dev/null &
  echo $! > "$PID_DIR/chrome.pid"
  sleep 10
fi

# 6. Next.js
if ! ss -tln 2>/dev/null | grep -q ":3000 "; then
  echo "Starting Next.js..."
  cd /home/z/my-project
  setsid bash -c "exec npm run dev" > dev.log 2>&1 < /dev/null &
  sleep 20
fi

echo ""
echo "=== All services ==="
echo "Tor: $(pgrep -f 'tor -f' | wc -l)"
echo "Xvfb: $(pgrep -f 'Xvfb :99' | wc -l)"
echo "x11vnc: $(ss -tln 2>/dev/null | grep :5900 | wc -l)"
echo "websockify: $(ss -tln 2>/dev/null | grep :6080 | wc -l)"
echo "Chrome: $(ss -tln 2>/dev/null | grep :9222 | wc -l)"
echo "Next.js: $(ss -tln 2>/dev/null | grep :3000 | wc -l)"
