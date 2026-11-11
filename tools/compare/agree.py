"""How many entities two prediction files share (same start, end and label, score within TOL), at a threshold,
after the same greedy flattening score.ts applies. Same count as tests/gliner.test.ts.
Usage: python tools/compare/agree.py ref.json other.json [threshold] [tol]"""
import json, sys

def flat(spans, th):
    out = []
    for s in sorted((s for s in spans if s['score'] >= th), key=lambda s: -s['score']):
        if not any(o['start'] < s['end'] and s['start'] < o['end'] for o in out):
            out.append(s)
    return out

a, b = (json.load(open(p))['docs'] for p in sys.argv[1:3])
th = float(sys.argv[3]) if len(sys.argv) > 3 else 0.3
tol = float(sys.argv[4]) if len(sys.argv) > 4 else 0.05
B = {d['id']: d['spans'] for d in b}
same = total = 0
maxdiff = 0.0
for d in a:
    x, y = flat(d['spans'], th), flat(B[d['id']], th)
    Y = {(s['start'], s['end'], s['label']): s['score'] for s in y}
    for s in x:
        k = (s['start'], s['end'], s['label'])
        if k in Y:
            diff = abs(Y[k] - s['score'])
            maxdiff = max(maxdiff, diff)
            same += diff <= tol
    total += max(len(x), len(y))
print(f'{sys.argv[2].split("/")[-1]} vs {sys.argv[1].split("/")[-1]} @ {th}: {same}/{total} iguales (±{tol}), dif. máx. entre comunes {maxdiff:.3f}')
