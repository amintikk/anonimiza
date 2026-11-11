"""Comparison table from score.ts --json outputs. Usage: python tools/compare/summary.py out.md score1.json ...
Totals are given with and without OTRO_ID (case numbers, usernames...: no rule covers them, and only the
models' full label sets look for them)."""
import json, sys

def pct(a, b):
    return f'{100 * a / b:.1f}' if b else '—'

rows = []
for p in sys.argv[2:]:
    s = json.load(open(p))
    t = s['total']
    o = s['rows'].get('otherid', {'gold': 0, 'pred': 0, 'tpR': 0, 'tpRx': 0, 'tpP': 0, 'tpPx': 0})
    i = {k: t[k] - o[k] for k in t}
    c = s['chars']
    rows.append((s['gold'].split('/')[-1].replace('.json', ''), s['name'], s['th'],
                 pct(i['tpR'], i['gold']), pct(i['tpRx'], i['gold']), pct(i['tpP'], i['pred']), pct(i['tpPx'], i['pred']),
                 pct(t['tpR'], t['gold']), pct(c['anyCovered'], c['gold']), pct(c['predOk'], c['pred']), i['gold'], i['pred']))
head = '| Conjunto | Configuración | Umbral | Cobertura | Cob. exacta | Precisión | Prec. exacta | Cobertura con OTRO_ID | Caracteres sensibles tapados | Caracteres tapados que eran sensibles | Reales | Marcados |'
out = [head, '|' + '---|' * 3 + '---:|' * 9] + ['| ' + ' | '.join(str(x) for x in r) + ' |' for r in rows]
open(sys.argv[1], 'w').write('\n'.join(out) + '\n')
print('\n'.join(out))
