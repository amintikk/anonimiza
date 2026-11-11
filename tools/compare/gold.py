"""Turn the test sets into one gold format for tools/compare (offsets in UTF-16 units, as JavaScript counts).

Usage: python tools/compare/gold.py <old|new|meddocan> <input> <out.json> [max_docs]
  old/new: tests/data/documentos*.json  (entries [text, TYPE, (occurrence indices)], every whole-word occurrence)
  meddocan: folder with the BRAT .txt/.ann files of the MEDDOCAN test split

Output: {"docs": [{"id", "text", "gold": [{"start", "end", "kind", "type", "required"}]}]}
kind is the coarse type both detectors are scored on; required=false marks spans that are neither a miss
when left nor an error when marked (a town on its own, a date that is not a date of birth...)."""
import json, os, re, sys

KIND = {'PERSONA': 'person', 'ORGANIZACION': 'org', 'DIRECCION': 'address', 'DNI': 'id', 'NIE': 'id', 'CIF': 'id', 'NSS': 'id',
        'IBAN': 'iban', 'TARJETA': 'card', 'TELEFONO': 'phone', 'EMAIL': 'email', 'IP': 'ip', 'FECHA_NACIMIENTO': 'birthdate',
        'MATRICULA': 'plate', 'OTRO_ID': 'otherid'}
# MEDDOCAN (Marimon et al. 2019) types → our kinds; None = out of scope for both detectors (not scored either way).
MEDDOCAN = {'NOMBRE_SUJETO_ASISTENCIA': ('person', True), 'NOMBRE_PERSONAL_SANITARIO': ('person', True),
            'FAMILIARES_SUJETO_ASISTENCIA': ('person', False), 'HOSPITAL': ('org', True), 'INSTITUCION': ('org', True),
            'CENTRO_SALUD': ('org', True), 'CALLE': ('address', True), 'TERRITORIO': ('address', False), 'PAIS': ('address', False),
            'CORREO_ELECTRONICO': ('email', True), 'NUMERO_TELEFONO': ('phone', True), 'NUMERO_FAX': ('phone', True),
            'ID_SUJETO_ASISTENCIA': ('otherid', True), 'ID_ASEGURAMIENTO': ('otherid', True), 'ID_CONTACTO_ASISTENCIAL': ('otherid', True),
            'ID_TITULACION_PERSONAL_SANITARIO': ('otherid', True), 'ID_EMPLEO_PERSONAL_SANITARIO': ('otherid', True),
            'FECHAS': ('birthdate', False), 'EDAD_SUJETO_ASISTENCIA': (None, False), 'SEXO_SUJETO_ASISTENCIA': (None, False),
            'PROFESION': (None, False), 'OTROS_SUJETO_ASISTENCIA': (None, False)}


def u16(text, cp):
    return len(text[:cp].encode('utf-16-le')) // 2


def whole_word(text, s):
    """Start offsets of s as a whole word (no letter/digit right before or after), left to right, non-overlapping."""
    out, i = [], text.find(s)
    while i != -1:
        before = text[i - 1] if i else ''
        after = text[i + len(s)] if i + len(s) < len(text) else ''
        if not (before.isalnum() or before == '_') and not (after.isalnum() or after == '_'):
            out.append(i)
            i = text.find(s, i + len(s))
        else:
            i = text.find(s, i + 1)
    return out


def from_strings(path):
    docs = json.load(open(path, encoding='utf-8'))['docs']
    out = []
    for d in docs:
        text = d['text']
        taken = [False] * len(text)
        gold = []
        entries = [(e, True) for e in d['pii']] + [(e, False) for e in d.get('optional', [])]
        for (e, req) in sorted(entries, key=lambda x: -len(x[0][0])):
            s, typ = e[0], e[1]
            free = [i for i in whole_word(text, s) if not any(taken[i:i + len(s)])]
            if len(e) > 2:
                free = [free[k] for k in e[2] if k < len(free)]
            for i in free:
                for j in range(i, i + len(s)):
                    taken[j] = True
                gold.append({'start': u16(text, i), 'end': u16(text, i + len(s)), 'kind': KIND[typ], 'type': typ, 'required': req})
        out.append({'id': d['id'], 'text': text, 'gold': sorted(gold, key=lambda g: g['start'])})
    return out


def from_brat(folder, max_docs=None):
    names = sorted(f[:-4] for f in os.listdir(folder) if f.endswith('.txt'))
    if max_docs:
        names = names[:max_docs]
    out = []
    for n in names:
        text = open(os.path.join(folder, n + '.txt'), encoding='utf-8').read()
        gold = []
        for line in open(os.path.join(folder, n + '.ann'), encoding='utf-8'):
            if not line.startswith('T'):
                continue
            _, info, _ = line.rstrip('\n').split('\t')
            typ, a, b = info.split(' ')[0], int(info.split(' ')[1]), int(info.split(' ')[-1])
            kind, req = MEDDOCAN[typ]
            if kind is None:
                continue
            gold.append({'start': u16(text, a), 'end': u16(text, b), 'kind': kind, 'type': typ, 'required': req})
        out.append({'id': n, 'text': text, 'gold': sorted(gold, key=lambda g: g['start'])})
    return out


if __name__ == '__main__':
    src, inp, outp = sys.argv[1:4]
    docs = from_brat(inp, int(sys.argv[4]) if len(sys.argv) > 4 else None) if src == 'meddocan' else from_strings(inp)
    json.dump({'source': src, 'docs': docs}, open(outp, 'w', encoding='utf-8'), ensure_ascii=False)
    n = sum(1 for d in docs for g in d['gold'] if g['required'])
    print(f'{outp}: {len(docs)} docs, {n} required spans, {sum(len(d["gold"]) for d in docs) - n} optional')
