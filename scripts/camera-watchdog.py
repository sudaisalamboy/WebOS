#!/usr/bin/env python3
"""
Camera Watchdog
---------------
Monitors the camera injection status and re-injects if it gets lost.
Runs every 15 seconds.

This fixes the issue where camera stops working after:
- CDP connections disconnect (test scripts)
- Page navigations that clear scripts
- Chrome tab focus changes

When camera is enabled (.camera-enabled file exists), this watchdog:
1. Checks if camera is still active on Chrome tabs
2. If not, re-injects the camera script
3. Re-grants permissions
"""

import subprocess
import time
import json
import os
import http.client
import socket

ENABLED_FILE = '/home/z/my-project/.camera-enabled'
CONFIG_FILE = '/home/z/my-project/.camera-config.json'
LOG_FILE = '/home/z/my-project/.vnc-logs/camera-watchdog.log'
CDP_PORT = 9222
NEXTJS_PORT = 3000
CHECK_INTERVAL = 15  # seconds

def log(msg):
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(line + '\n')
    except:
        pass

def is_port_open(port, host='127.0.0.1'):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1)
        result = s.connect_ex((host, port))
        s.close()
        return result == 0
    except:
        return False

def get_chrome_tabs():
    """Get list of Chrome page tabs."""
    try:
        conn = http.client.HTTPConnection('127.0.0.1', CDP_PORT, timeout=3)
        conn.request('GET', '/json')
        resp = conn.getresponse()
        body = resp.read().decode()
        conn.close()
        tabs = json.loads(body)
        return [t for t in tabs if t.get('type') == 'page']
    except:
        return []

def check_camera_active():
    """Check if camera override is still active on any Chrome tab."""
    tabs = get_chrome_tabs()
    if not tabs:
        return False, 0

    # Use CDP HTTP API to check (simpler than WebSocket)
    # We'll check via the Next.js API instead
    try:
        conn = http.client.HTTPConnection('127.0.0.1', NEXTJS_PORT, timeout=5)
        conn.request('GET', '/api/camera-inject')
        resp = conn.getresponse()
        body = resp.read().decode()
        conn.close()
        data = json.loads(body)
        vnc_status = data.get('status', {}).get('vnc', {})
        return vnc_status.get('cameraActive', False), vnc_status.get('tabs', 0)
    except:
        return False, 0

def re_inject_camera():
    """Re-inject camera via the Next.js API."""
    try:
        conn = http.client.HTTPConnection('127.0.0.1', NEXTJS_PORT, timeout=30)
        # Read the saved config
        config = None
        try:
            with open(CONFIG_FILE, 'r') as f:
                config = json.load(f)
        except:
            config = {'sourceType': 'test-pattern'}

        payload = json.dumps({
            'action': 'inject',
            'targets': ['vnc'],
            'config': config,
        })

        conn.request('POST', '/api/camera-inject',
                     body=payload,
                     headers={'Content-Type': 'application/json'})
        resp = conn.getresponse()
        body = resp.read().decode()
        conn.close()
        data = json.loads(body)
        return data.get('ok', False), data.get('results', {}).get('vnc', {}).get('tabsInjected', 0)
    except Exception as e:
        log(f'Re-inject error: {e}')
        return False, 0

def main():
    log('=== Camera Watchdog started ===')

    while True:
        try:
            # Check if camera is enabled
            if not os.path.exists(ENABLED_FILE):
                time.sleep(CHECK_INTERVAL)
                continue

            # Check if Chrome is running
            if not is_port_open(CDP_PORT):
                time.sleep(CHECK_INTERVAL)
                continue

            # Check if Next.js is running
            if not is_port_open(NEXTJS_PORT):
                time.sleep(CHECK_INTERVAL)
                continue

            # Check camera status
            active, tabs = check_camera_active()

            if not active and tabs > 0:
                log(f'Camera lost (tabs={tabs}) — re-injecting...')
                ok, injected = re_inject_camera()
                if ok:
                    log(f'Camera re-injected successfully ({injected} tabs)')
                else:
                    log(f'Camera re-inject FAILED')
            else:
                # Log every 2 minutes if OK
                if int(time.time()) % 120 < CHECK_INTERVAL:
                    log(f'Camera OK (active={active}, tabs={tabs})')

        except Exception as e:
            log(f'Watchdog error: {e}')

        time.sleep(CHECK_INTERVAL)

if __name__ == '__main__':
    main()
