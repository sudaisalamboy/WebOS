#!/usr/bin/env python3
"""
PTY helper — forks a child process in a pseudo-terminal running /bin/bash.

Communication with the Node.js parent:
  - stdin  ← receives keyboard input (raw bytes) from xterm.js via Node
  - stdout → sends terminal output (raw bytes from bash/vim/etc.) to Node
  - stderr → sends control messages:
      "PID:<pid>"        — the shell's PID
      "ERR:<message>"   — an error occurred
      "RESIZED:<W>x<H>" — resize ack

The child shell starts in /home/z/my-project/user-files (the WebOS sandbox).

Resize control: Node sends a special marker "\x00RESIZE:<W>x<H>\x00" on the
helper's stdin. We detect it and call TIOCSWINSZ on the PTY master fd.
"""
import os
import pty
import sys
import select
import struct
import fcntl
import termios
import signal
import errno

SANDBOX_ROOT = "/home/z/my-project/user-files"

def main():
    # Make sure the sandbox dir exists
    try:
        os.makedirs(SANDBOX_ROOT, exist_ok=True)
    except OSError:
        pass

    # Fork a child in a PTY
    try:
        pid, master_fd = pty.fork()
    except OSError as e:
        sys.stderr.write(f"ERR:pty.fork failed: {e}\n")
        sys.stderr.flush()
        sys.exit(1)

    if pid == 0:
        # --- CHILD ---
        # Set the working directory to the sandbox root
        try:
            os.chdir(SANDBOX_ROOT)
        except OSError:
            pass
        # Set a sane terminal size
        try:
            fcntl.ioctl(sys.stdin.fileno(), termios.TIOCSWINSZ,
                        struct.pack("HHHH", 24, 80, 0, 0))
        except OSError:
            pass
        # Exec bash
        env = os.environ.copy()
        env["HOME"] = env.get("HOME", "/home/z")
        env["TERM"] = env.get("TERM", "xterm-256color")
        env["SHELL"] = "/bin/bash"
        env["PS1"] = env.get("PS1", "\\[\\033[01;32m\\]webos-user@webos\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ ")
        os.execvpe("/bin/bash", ["/bin/bash", "--login"], env)
        # If exec fails:
        sys.stderr.write("ERR:execvpe failed\n")
        sys.stderr.flush()
        os._exit(1)

    # --- PARENT ---
    sys.stderr.write(f"PID:{pid}\n")
    sys.stderr.flush()

    # Set the master fd to non-blocking so we can interleave reads + stdin forwarding
    os.set_blocking(master_fd, False)
    # stdin (from Node) stays blocking — Node writes to it
    # But we need non-blocking read on our own stdin to avoid hanging when
    # the shell has output but no input is coming.
    stdin_fd = sys.stdin.fileno()
    os.set_blocking(stdin_fd, False)
    stdout_fd = sys.stdout.fileno()
    stderr_fd = sys.stderr.fileno()

    # Make stdout/stderr unbuffered for binary pass-through
    sys.stdout = os.fdopen(stdout_fd, 'wb', buffering=0)
    sys.stderr = os.fdopen(stderr_fd, 'wb', buffering=0)

    RESIZE_MARKER = b"\x00RESIZE:"
    RESIZE_END = b"\x00"
    resize_buffer = b""

    def handle_resize(width, height):
        try:
            fcntl.ioctl(master_fd, termios.TIOCSWINSZ,
                        struct.pack("HHHH", height, width, 0, 0))
            # Also send SIGWINCH to the child so vim etc. pick it up
            os.kill(pid, signal.SIGWINCH)
        except OSError as e:
            sys.stderr.write(f"ERR:resize failed: {e}\n".encode())
            sys.stderr.flush()

    def extract_resize_markers(data):
        """Pull out any \x00RESIZE:WxH\x00 markers from a data chunk.
        Returns (clean_data, list_of_(width, height) tuples)."""
        nonlocal resize_buffer
        resizes = []
        clean = b""
        buf = resize_buffer + data
        resize_buffer = b""
        i = 0
        while i < len(buf):
            if buf[i:i+1] == b"\x00" and buf[i:i+len(RESIZE_MARKER)] == RESIZE_MARKER:
                # Find the end marker
                end = buf.find(RESIZE_END, i + len(RESIZE_MARKER))
                if end == -1:
                    # Incomplete — save the remainder for next time
                    resize_buffer = buf[i:]
                    break
                payload = buf[i + len(RESIZE_MARKER):end].decode("ascii", errors="replace")
                try:
                    w_str, h_str = payload.split("x")
                    resizes.append((int(w_str), int(h_str)))
                except (ValueError, AttributeError):
                    pass
                i = end + 1
            else:
                # Copy byte by byte until next potential marker
                next_marker = buf.find(b"\x00RESIZE:", i)
                if next_marker == -1:
                    clean += buf[i:]
                    break
                else:
                    clean += buf[i:next_marker]
                    i = next_marker
        return clean, resizes

    while True:
        try:
            rlist, _, _ = select.select([master_fd, stdin_fd], [], [], 0.1)
        except (OSError, select.error) as e:
            if e.args[0] == errno.EINTR:
                continue
            break

        # Output from shell → forward to Node (→ xterm.js)
        if master_fd in rlist:
            try:
                data = os.read(master_fd, 65536)
                if not data:
                    # EOF — shell exited
                    break
                os.write(stdout_fd, data)
            except OSError as e:
                if e.errno == errno.EIO:
                    # PTY closed — child exited
                    break
                sys.stderr.write(f"ERR:read master: {e}\n".encode())
                break

        # Input from Node (xterm.js keyboard) → forward to shell
        if stdin_fd in rlist:
            try:
                data = os.read(stdin_fd, 65536)
                if not data:
                    # Node closed stdin — terminate the shell
                    try: os.kill(pid, signal.SIGHUP)
                    except OSError: pass
                    break
                clean, resizes = extract_resize_markers(data)
                for w, h in resizes:
                    handle_resize(w, h)
                if clean:
                    try:
                        os.write(master_fd, clean)
                    except OSError as e:
                        sys.stderr.write(f"ERR:write master: {e}\n".encode())
                        break
            except OSError as e:
                sys.stderr.write(f"ERR:read stdin: {e}\n".encode())
                break

        # Check if child exited
        try:
            wpid, _ = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                break
        except OSError:
            break

    # Cleanup
    try: os.close(master_fd)
    except OSError: pass
    try: os.kill(pid, signal.SIGKILL)
    except OSError: pass
    try: os.waitpid(pid, 0)
    except OSError: pass


if __name__ == "__main__":
    main()
