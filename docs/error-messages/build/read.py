#!/usr/bin/env python3
"""One reader: a Haiku session with no tools at all (no files, no compiler, no shell, no MCP),
given the three parts as messages in one conversation, in its own order, and asked what each
error message means.

  python3 read.py <reader 1|2|3> <batch 1|2|3>     (batches in order: 2 and 3 continue 1's session)

Reader 1 reads parts 1, 2, 3; reader 2 reads 2, 3, 1; reader 3 reads 3, 1, 2. Writes, under
../feedback/: reader-<k>-turn-<n>-part-<p>.txt (the raw reply), reader-<k>-part-<p>.jsonl (the
reply's items, one per line, when it parses) and reader-<k>.session (the session id).
"""
import json, os, re, subprocess, sys, uuid

ORDERS = {1: [1, 2, 3], 2: [2, 3, 1], 3: [3, 1, 2]}
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
out = os.path.join(root, 'feedback')
# an empty room with nothing in it to find
box = os.path.expanduser(f'~/.claude/jobs/98cf3dff/tmp/readerbox-{sys.argv[1]}')
os.makedirs(out, exist_ok=True)
os.makedirs(box, exist_ok=True)

k, only = int(sys.argv[1]), int(sys.argv[2])
sfile = os.path.join(out, f'reader-{k}.session')
if only == 1:
    open(sfile, 'w').write(str(uuid.uuid4()) + '\n')
sid = open(sfile).read().strip()

INTRO = """You are a developer who has never seen the MKP (Markdown Markup) language and has no documentation for it. You will be shown compiler error messages, each with the block of source that produced it, in three batches across this conversation. You have no tools: work only from the message and the block.

For every item, say:
- "understood": "yes", "partly" or "no": could you tell what is wrong?
- "meaning": what you think the message means and what is wrong in the block
- "fix": the corrected line or lines, or "cannot infer" if you cannot tell what to change
- "confusing": anything in the message that confused you (empty if nothing)

Reply with only a JSON array, one object per item, in the batch's order:
[{"id": "...", "understood": "...", "meaning": "...", "fix": "...", "confusing": "..."}, ...]
Cover every item; do not skip any. You may use what you learned from earlier batches."""

def ask(text, first):
    cmd = ['claude', '-p', '--model', 'haiku', '--effort', 'medium', '--tools', '', '--strict-mcp-config',
           '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--setting-sources', '',
           '--output-format', 'json'] + (['--session-id', sid] if first else ['--resume', sid])
    r = subprocess.run(cmd, input=text, capture_output=True, text=True, cwd=box, timeout=570)
    try:
        return json.loads(r.stdout).get('result') or ''
    except json.JSONDecodeError:
        return r.stdout + r.stderr

for n, p in enumerate(ORDERS[k], 1):
    if n != only:
        continue
    items = json.load(open(os.path.join(root, 'parts', f'part-{p}.json')))
    batch = '\n\n'.join(f"### {it['id']}\nmessage: {it['message']}\nblock:\n```\n{it['block']}\n```" for it in items)
    head = (INTRO + '\n\n') if n == 1 else ''
    reply = ask(f'{head}Batch {n} of 3 ({len(items)} items):\n\n{batch}', n == 1)
    open(os.path.join(out, f'reader-{k}-turn-{n}-part-{p}.txt'), 'w').write(reply)
    m = re.search(r'\[.*\]', reply, re.S)
    got = 0
    if m:
        try:
            rows = json.loads(m.group(0))
            with open(os.path.join(out, f'reader-{k}-part-{p}.jsonl'), 'w') as f:
                for r in rows:
                    f.write(json.dumps({**r, 'reader': k, 'position': n, 'part': p}) + '\n')
            got = len(rows)
        except json.JSONDecodeError:
            pass
    print(f'reader {k}, batch {n}: part {p}, {len(items)} items, {got} answers parsed')
