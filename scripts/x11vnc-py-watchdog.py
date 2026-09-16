import subprocess, os, time

env = os.environ.copy()
env['LD_LIBRARY_PATH'] = '/home/z/my-project/tools/x11vnc/lib:' + env.get('LD_LIBRARY_PATH', '')

x11vnc = '/home/z/my-project/tools/x11vnc/bin/x11vnc'
log = open('/home/z/my-project/.vnc-logs/x11vnc.log', 'a')
pid_file = '/home/z/my-project/.vnc-pids/x11vnc.pid'

def is_alive(pid):
    try:
        with open(f'/proc/{pid}/stat') as f:
            stat = f.read().split()
            return stat[2] != 'Z'
    except:
        return False

while True:
    alive = False
    try:
        with open(pid_file) as f:
            pid = int(f.read().strip())
        if is_alive(pid):
            alive = True
        else:
            try: os.waitpid(pid, 0)
            except: pass
    except:
        pass
    
    if not alive:
        log.write(f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] Starting x11vnc (NO AUTH)...\n')
        log.flush()
        # NO -rfbauth, NO -passwd = security type "None" (no password needed)
        proc = subprocess.Popen([
            x11vnc, '-display', ':99', '-localhost', '-rfbport', '5900',
            '-forever', '-shared', '-noxdamage', '-noscr', '-nowf', '-nowcr',
            '-cursor', 'arrow', '-nopw'
        ], env=env, stdout=log, stderr=subprocess.STDOUT)
        with open(pid_file, 'w') as f:
            f.write(str(proc.pid))
        log.write(f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] x11vnc started PID={proc.pid}\n')
        log.flush()
    
    time.sleep(2)
