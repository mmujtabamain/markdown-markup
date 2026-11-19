"""Runs a command as a terminal would and keeps exactly what it printed.

run(cmd, cwd) -> {"segments": [["out", text] | ["in", text]], "exit": code}

Without answers the command gets no terminal: stdin is /dev/null and stdout and stderr share one
pipe, so their lines interleave as they would on screen. With answers it runs on a pseudo-terminal
(so xtmd sees a terminal and asks), and each answer is written when its prompt has been printed.
"""
import os, pty, re, select, subprocess, termios, time, fcntl, struct

# The folder holding the xtmd being filmed: capture.py points it at its own copy of the binary.
BIN = ""


def env():
    e = dict(os.environ)
    e["PATH"] = (BIN + os.pathsep if BIN else "") + e.get("PATH", "")
    e["COLUMNS"] = "200"
    e.pop("XTMD_MIGRATE_02", None)
    return e


def run(cmd, cwd, answers=None, timeout=600):
    if not answers:
        p = subprocess.run(["bash", "-c", cmd], cwd=cwd, env=env(), stdin=subprocess.DEVNULL,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        return {"segments": [["out", p.stdout.decode("utf-8", "replace")]], "exit": p.returncode}
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 200, 0, 0))
    attrs = termios.tcgetattr(slave)
    attrs[3] &= ~termios.ECHO          # the answer is kept as its own segment, not echoed twice
    attrs[1] &= ~termios.ONLCR         # \n stays \n
    termios.tcsetattr(slave, termios.TCSANOW, attrs)
    p = subprocess.Popen(["bash", "-c", cmd], cwd=cwd, env=env(), stdin=slave, stdout=slave,
                         stderr=slave, close_fds=True, start_new_session=True)
    os.close(slave)
    segments, buf, pending = [], b"", list(answers)
    deadline = time.time() + timeout
    while True:
        r, _, _ = select.select([master], [], [], 0.2)
        if r:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                chunk = b""
            if not chunk:
                break
            buf += chunk
        if pending:
            pat, answer = pending[0]
            text = buf.decode("utf-8", "replace")
            if re.search(pat, text):
                time.sleep(0.3)
                segments.append(["out", text])
                buf = b""
                os.write(master, answer.encode())
                segments.append(["in", answer])
                pending.pop(0)
        if p.poll() is not None and not r:
            # drain
            try:
                while True:
                    r2, _, _ = select.select([master], [], [], 0.2)
                    if not r2: break
                    chunk = os.read(master, 65536)
                    if not chunk: break
                    buf += chunk
            except OSError:
                pass
            break
        if time.time() > deadline:
            p.kill(); raise RuntimeError("timed out: %s" % cmd)
    os.close(master)
    code = p.wait()
    segments.append(["out", buf.decode("utf-8", "replace")])
    if pending:
        raise RuntimeError("%s: never asked %r" % (cmd, pending[0][0]))
    return {"segments": [s for s in segments if s[1] or s[0] == "in"], "exit": code}

