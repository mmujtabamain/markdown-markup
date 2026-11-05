#!/usr/bin/env python3
"""Merge the builders' trials into the dataset and split it into the three parts the readers get.

  python3 merge.py        (run from docs/error-messages/build)

Writes ../dataset.jsonl (every triggered message, with its site and block), ../untriggered.jsonl,
../parts/part-{1,2,3}.json (id, message, block only: what a reader sees) and ../ERRORS.md.
"""
import glob, json, os

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
rows = []
for p in sorted(glob.glob(os.path.join(here, 'out-*.jsonl'))):
    for line in open(p):
        line = line.strip()
        if line:
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            r['slice'] = os.path.basename(p)[4:-6]
            rows.append(r)

seen, data, untriggered = set(), [], []
for r in rows:
    if r.get('status') != 'triggered' or not r.get('message') or not r.get('block'):
        untriggered.append(r)
        continue
    key = (r.get('code'), r['message'])
    if key in seen:
        continue
    seen.add(key)
    data.append(r)

for i, r in enumerate(data):
    r['id'] = f'E{i + 1:03d}'
os.makedirs(os.path.join(root, 'parts'), exist_ok=True)
with open(os.path.join(root, 'dataset.jsonl'), 'w') as f:
    for r in data:
        f.write(json.dumps(r) + '\n')
with open(os.path.join(root, 'untriggered.jsonl'), 'w') as f:
    for r in untriggered:
        f.write(json.dumps(r) + '\n')
# every third item to each part, so each part mixes every slice
for k in range(3):
    part = [{'id': r['id'], 'message': r['message'], 'block': r['block']} for r in data[k::3]]
    json.dump(part, open(os.path.join(root, 'parts', f'part-{k + 1}.json'), 'w'), indent=1)

with open(os.path.join(root, 'ERRORS.md'), 'w') as f:
    f.write(f'# MKP error messages\n\n{len(data)} distinct messages triggered from {len({r.get("site") for r in data})} sites; '
            f'{len(untriggered)} sites not triggered from a document or pack (listed last).\n\n')
    f.write('| id | code | severity | message | site |\n|---|---|---|---|---|\n')
    for r in data:
        msg = r['message'].replace('|', '\\|').replace('\n', ' ')
        f.write(f"| {r['id']} | `{r.get('code', '')}` | {r.get('severity', '')} | {msg} | `{r.get('site', '')}` |\n")
    f.write('\n## Not triggered\n\n| site | code | why |\n|---|---|---|\n')
    for r in untriggered:
        f.write(f"| `{r.get('site', '')}` | `{r.get('code', '')}` | {str(r.get('note', '')).replace('|', '/')} |\n")
print(f'{len(data)} messages, {len(untriggered)} not triggered; parts of {[len(data[k::3]) for k in range(3)]}')
