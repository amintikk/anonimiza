"""Paired bootstrap over documents: is configuration B's recall/precision different from A's beyond noise?
Usage: python tools/compare/bootstrap.py a.json b.json   (score.ts --json outputs on the same gold file)
Prints the difference B - A with a 95 % interval (10 000 resamples of the documents, seed 1)."""
import json, random, sys
A, B = (json.load(open(p)) for p in sys.argv[1:3])
a = {d['id']: d for d in A['perDoc']}
docs = [(a[d['id']], d) for d in B['perDoc']]
rnd = random.Random(1)

def metric(sample, k_tp, k_n, side):
    tp = sum(x[side][k_tp] for x in sample); n = sum(x[side][k_n] for x in sample)
    return 100 * tp / n if n else 0.0

for name, tp, n in (('cobertura', 'tpR', 'gold'), ('precisión', 'tpP', 'pred')):
    diffs = []
    for _ in range(10000):
        s = [docs[rnd.randrange(len(docs))] for _ in docs]
        diffs.append(metric(s, tp, n, 1) - metric(s, tp, n, 0))
    diffs.sort()
    point = metric(docs, tp, n, 1) - metric(docs, tp, n, 0)
    print(f'{name}: {B["name"]} − {A["name"]} = {point:+.1f} puntos (IC 95 % {diffs[250]:+.1f} a {diffs[9750]:+.1f})')
