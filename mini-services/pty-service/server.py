#!/usr/bin/env python3
"""
PTY WebSocket service (pure Python).

Listens on port 3003, accepts WebSocket connections, spawns a real bash
shell in a pseudo-terminal, and pipes I/O between the WebSocket and the PTY.

This is the backend for the WebOS xterm.js terminal — a real terminal
emulator that supports vim, nano, top, ssh, and all control keys.

Path: / (Caddy routes via XTransformPort=3003)
"""
import asyncio
import json
import os
import pty
import select
import struct
import fcntl
import termios
import signal
import errno
import sys
import logging

try:
    import websockets
except ImportError:
    print("ERROR: websockets not installed. Run: pip install websockets", file=sys.stderr)
    sys.exit(1)

# Configure logging to stderr so it doesn't interfere with stdout (which is
# used for piping PTY output when run standalone, though here we use websockets)
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(message)s',
    datefmt='%H:%M:%S',
    stream=sys.stderr,
)
log = logging.getLogger("pty-service")

PORT = 3003
SANDBOX_ROOT = "/home/z/my-project/user-files"
RESIZE_MARKER = b"\x00RESIZE:"
RESIZE_END = b"\x00"


async def handle_connection(websocket):
    """Handle a single WebSocket connection — spawn a PTY and pipe I/O."""
    remote = websocket.remote_address if websocket.remote_address else "?"
    log.info(f"[+] New PTY connection from {remote}")

    # Fork a child in a PTY
    try:
        pid, master_fd = pty.fork()
    except OSError as e:
        log.error(f"pty.fork failed: {e}")
        await websocket.send(f"\r\n\x1b[31m[PTY error: {e}]\x1b[0m\r\n")
        await websocket.close()
        return

    if pid == 0:
        # --- CHILD ---
        try:
            os.chdir(SANDBOX_ROOT)
        except OSError:
            pass
        try:
            fcntl.ioctl(sys.stdin.fileno(), termios.TIOCSWINSZ,
                        struct.pack("HHHH", 24, 80, 0, 0))
        except OSError:
            pass
        env = os.environ.copy()
        env["HOME"] = env.get("HOME", "/home/z")
        env["TERM"] = "xterm-256color"
        env["SHELL"] = "/bin/bash"
        env["PS1"] = "\\[\\033[01;32m\\]webos-user@webos\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ "
        os.execvpe("/bin/bash", ["/bin/bash", "--login"], env)
        sys.stderr.write("ERR:execvpe failed\n")
        os._exit(1)

    # --- PARENT ---
    log.info(f"    Shell PID: {pid}")

    # Set master fd to non-blocking
    os.set_blocking(master_fd, False)

    # We use an asyncio reader to poll the master_fd for output
    loop = asyncio.get_event_loop()
    running = True

    def read_pty():
        """Read output from the PTY (non-blocking)."""
        nonlocal running
        try:
            data = os.read(master_fd, 65536)
            if not data:
                running = False
                return None
            return data
        except OSError as e:
            if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                # No data available right now — return empty (not an error)
                return b""
            if e.errno == errno.EIO:
                running = False
                return None
            log.error(f"read master: {e}")
            running = False
            return None

    async def pipe_output():
        """Continuously read PTY output and send to WebSocket."""
        while running:
            try:
                data = await loop.run_in_executor(None, read_pty)
                if data is None:
                    break
                if data:
                    try:
                        await websocket.send(data)
                    except websockets.exceptions.ConnectionClosed:
                        break
            except Exception as e:
                log.error(f"pipe_output error: {e}")
                break
            await asyncio.sleep(0.01)  # small delay to avoid busy loop

    async def pipe_input():
        """Continuously read WebSocket messages and write to PTY."""
        nonlocal running
        resize_buffer = b""
        try:
            async for message in websocket:
                if isinstance(message, str):
                    message = message.encode("utf-8")

                # Extract resize markers
                buf = resize_buffer + message
                resize_buffer = b""
                clean = b""
                i = 0
                while i < len(buf):
                    if buf[i:i+1] == b"\x00" and buf[i:i+len(RESIZE_MARKER)] == RESIZE_MARKER:
                        end = buf.find(RESIZE_END, i + len(RESIZE_MARKER))
                        if end == -1:
                            resize_buffer = buf[i:]
                            break
                        payload = buf[i + len(RESIZE_MARKER):end].decode("ascii", errors="replace")
                        try:
                            w_str, h_str = payload.split("x")
                            w, h = int(w_str), int(h_str)
                            fcntl.ioctl(master_fd, termios.TIOCSWINSZ,
                                        struct.pack("HHHH", h, w, 0, 0))
                            try:
                                os.kill(pid, signal.SIGWINCH)
                            except OSError:
                                pass
                            log.info(f"    Resized to {w}x{h}")
                        except (ValueError, AttributeError):
                            pass
                        i = end + 1
                    else:
                        next_marker = buf.find(b"\x00RESIZE:", i)
                        if next_marker == -1:
                            clean += buf[i:]
                            break
                        else:
                            clean += buf[i:next_marker]
                            i = next_marker

                # Write clean input to PTY
                if clean:
                    try:
                        os.write(master_fd, clean)
                    except OSError as e:
                        log.error(f"write master: {e}")
                        running = False
                        break
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            log.error(f"pipe_input error: {e}")
        finally:
            running = False

    # Run both pipes concurrently
    try:
        await asyncio.gather(pipe_output(), pipe_input())
    except Exception as e:
        log.error(f"gather error: {e}")

    # Cleanup
    log.info(f"[-] PTY connection closed (shell PID {pid})")
    try:
        os.close(master_fd)
    except OSError:
        pass
    try:
        os.kill(pid, signal.SIGHUP)
    except OSError:
        pass
    try:
        os.waitpid(pid, 0)
    except OSError:
        pass

    # Close the WebSocket
    try:
        await websocket.close()
    except Exception:
        pass


async def main():
    # Ensure sandbox dir exists
    os.makedirs(SANDBOX_ROOT, exist_ok=True)

    log.info(f"PTY WebSocket service starting on port {PORT}")
    log.info(f"Sandbox root: {SANDBOX_ROOT}")

    async with websockets.serve(
        handle_connection,
        "0.0.0.0",
        PORT,
        # Allow large messages (for pasting)
        max_size=2**24,
        # Don't ping too aggressively
        ping_interval=30,
        ping_timeout=120,
        # Allow any origin (WebOS is behind Caddy gateway)
        origins=None,
    ):
        log.info(f"✓ Listening on ws://0.0.0.0:{PORT}/")
        # Keep running forever
        await asyncio.Future()  # never resolves


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Shutting down (SIGINT)")
    except Exception as e:
        log.error(f"Fatal error: {e}")
        sys.exit(1)
