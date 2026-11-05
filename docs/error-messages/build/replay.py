#!/usr/bin/env python3
"""Replay dataset blocks against the compiler as it is now (built fresh from source) and show the
message each prints next to the one recorded.

  python3 replay.py [--cli path] [--build] [ids or codes or site-substrings…]

--build bundles packages/cli/src/bin.ts to the --cli path first (default: a private file in the
job's tmp folder, so the shared dist/ is left alone). With no filters, replays every row.
"""
import json, os, re, subprocess, sys, tempfile, shutil

here = os.path.dirname(os.path.abspath(__file__))
repo = os.path.abspath(os.path.join(here, '..', '..', '..'))
args = sys.argv[1:]
cli = os.path.expanduser('~/.claude/jobs/98cf3dff/tmp/mkp-replay.cjs')
if '--cli' in args:
    i = args.index('--cli'); cli = args[i + 1]; del args[i:i + 2]
node = os.path.expanduser('~/.local/node24/bin/node')
if '--build' in args:
    args.remove('--build')
    esb = os.path.join(repo, 'node_modules', '.bin', 'esbuild')
    subprocess.run([esb, os.path.join(repo, 'packages/cli/src/bin.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=node20',
                    f'--outfile={cli}', f'--alias:@mkp/core={repo}/packages/core/src/index.ts', '--log-level=warning'], check=True, timeout=120)

rows = [json.loads(l) for l in open(os.path.join(here, '..', 'dataset.jsonl'))]
if args:
    rows = [r for r in rows if any(a == r['id'] or a == r['code'] or a in r['site'] for a in args)]

SEC = re.compile(r'^--- (.+?) ---$', re.M)
def lay(block, d):
    parts = SEC.split(block)
    docs, pack = [], None
    if len(parts) == 1:
        p = os.path.join(d, 'doc.mkp.md'); open(p, 'w').write(block); return [p], None
    for name, text in zip(parts[1::2], parts[2::2]):
        name = name.strip().split(' ')[0]
        text = text.lstrip('\n')
        if name.endswith('.mkp.md') or name.endswith('.md'):
            p = os.path.join(d, os.path.basename(name)); docs.append(p)
        else:
            sub = name.split('/', 1)[1] if '/' in name else name
            p = os.path.join(d, 'pack', sub); pack = os.path.join(d, 'pack')
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'w').write(text)
    return docs, pack

for r in rows:
    d = tempfile.mkdtemp(prefix='replay-')
    try:
        docs, pack = lay(r['block'], d)
        cmd = [node, cli, 'check', *docs] + (['--pack', pack] if pack else []) + ['--format', 'json']
        out = subprocess.run(cmd, capture_output=True, text=True, cwd=d, timeout=60)
        out = out.stdout + out.stderr
        got = []
        for l in out.splitlines():
            try:
                j = json.loads(l)
            except json.JSONDecodeError:
                continue
            if j.get('code') == r['code']:
                got.append(j['message'])
        same = r['message'] in got
        print(json.dumps({'id': r['id'], 'code': r['code'], 'site': r['site'], 'same': same, 'was': r['message'], 'now': got}))
    finally:
        shutil.rmtree(d, ignore_errors=True)
