"""Run one model over a gold file (from gold.py) and store every span it proposes above a low threshold,
so score.ts can try thresholds without running the model again.

Usage: python tools/compare/predict.py <gliner|gliner2|gliner2-onnx:<dir>> <labelset> <gold.json> <out.json>
gliner2-onnx:<dir> runs the community ONNX export (DanKau/gliner2-pii-onnx) with the gliner2-onnx runtime from a
local folder, to check that the export and its quantized variants keep the PyTorch outputs.
Both models get the same windows (WINDOW words with OVERLAP, each word owned by the window where it is
most central) and the same post-processing; only the call to the model differs."""
import json, re, sys, time, warnings

warnings.filterwarnings('ignore')
import torch

torch.set_num_threads(4)

# Labels per model. 'base' is what the web app asks GLiNER for; 'full' adds every type we score, in each model's own vocabulary.
LABELS = {
    'gliner': {
        'base': {'person': 'person', 'organization': 'org', 'address': 'address'},
        'full': {'person': 'person', 'organization': 'org', 'address': 'address', 'phone number': 'phone', 'email': 'email',
                 'iban': 'iban', 'credit card number': 'card', 'identity card number': 'id', 'social security number': 'id',
                 'tax identification number': 'id', 'date of birth': 'birthdate', 'license plate number': 'plate',
                 'ip address': 'ip', 'passport number': 'otherid', 'username': 'otherid', 'medical record number': 'otherid'},
    },
    'gliner2': {
        'base': {'person': 'person', 'organization': 'org', 'address': 'address'},
        'full': {'person': 'person', 'organization': 'org', 'address': 'address', 'phone_number': 'phone', 'email': 'email',
                 'iban': 'iban', 'card_number': 'card', 'national_id_number': 'id', 'tax_id': 'id', 'date_of_birth': 'birthdate',
                 'license_plate': 'plate', 'ip_address': 'ip', 'passport_number': 'otherid', 'username': 'otherid',
                 'account_id': 'otherid'},
        # Its own vocabulary for addresses (spans are limited to 8 words, so a full address comes in pieces).
        'native': {'person': 'person', 'organization': 'org', 'street_address': 'address', 'postal_code': 'address', 'city': 'address'},
    },
}
WINDOW, OVERLAP, FLOOR = 200, 50, 0.1
WORD = re.compile(r'\w+(?:[-_]\w+)*|\S')


def windows(text):
    words = [(m.start(), m.end()) for m in WORD.finditer(text)]
    if not words:
        return []
    step = WINDOW - OVERLAP
    out, i = [], 0
    while True:
        j = min(i + WINDOW, len(words))
        # Owned region: half the overlap on each inner side.
        own_a = words[i][0] if i == 0 else words[i + OVERLAP // 2][0]
        own_b = len(text) if j == len(words) else words[j - OVERLAP // 2][0]
        out.append((words[i][0], words[j - 1][1], own_a, own_b))
        if j == len(words):
            return out
        i += step


def u16(text, cp):
    return len(text[:cp].encode('utf-16-le')) // 2


def main():
    which, labelset, gold_path, out_path = sys.argv[1:5]
    labels = LABELS['gliner2' if which.startswith('gliner2') else which][labelset]
    if which == 'gliner':
        from gliner import GLiNER
        from huggingface_hub import hf_hub_download
        from transformers import PreTrainedTokenizerFast
        model = GLiNER.from_pretrained('urchade/gliner_multi_pii-v1')
        model.eval()
        # Same tokenizer.json the web app uses (see tools/reference.py).
        model.data_processor.transformer_tokenizer = PreTrainedTokenizerFast(
            tokenizer_file=hf_hub_download('onnx-community/gliner_multi_pii-v1', 'tokenizer.json'),
            cls_token='[CLS]', sep_token='[SEP]', pad_token='[PAD]', unk_token='[UNK]', mask_token='[MASK]')

        def run(chunk):
            ents = model.predict_entities(chunk, list(labels), threshold=FLOOR, flat_ner=True)
            return [(e['start'], e['end'], e['label'], float(e['score'])) for e in ents]
    elif which.startswith('gliner2-onnx:'):
        from gliner2_onnx import GLiNER2ONNXRuntime
        model = GLiNER2ONNXRuntime(which.split(':', 1)[1], providers=['CPUExecutionProvider'])

        def run(chunk):
            return [(e.start, e.end, e.label, float(e.score)) for e in model.extract_entities(chunk, list(labels), threshold=FLOOR)]
    else:
        from gliner2 import GLiNER2
        model = GLiNER2.from_pretrained('fastino/gliner2-privacy-filter-PII-multi')

        def run(chunk):
            r = model.extract_entities(chunk, list(labels), threshold=FLOOR, include_confidence=True, include_spans=True)
            return [(e['start'], e['end'], lab, float(e['confidence'])) for lab, es in r['entities'].items() for e in es]

    docs = json.load(open(gold_path, encoding='utf-8'))['docs']
    out, t_total, n_words = [], 0.0, 0
    for k, d in enumerate(docs):
        text = d['text']
        n_words += len(WORD.findall(text))
        spans = []
        t0 = time.perf_counter()
        with torch.no_grad():
            for a, b, own_a, own_b in windows(text):
                for s, e, lab, score in run(text[a:b]):
                    s, e = s + a, e + a
                    if own_a <= s < own_b:
                        spans.append({'start': u16(text, s), 'end': u16(text, e), 'label': lab, 'kind': labels[lab], 'score': round(score, 5)})
        t_total += time.perf_counter() - t0
        out.append({'id': d['id'], 'spans': spans})
        print(f'{k + 1}/{len(docs)} {d["id"]} {len(spans)}', file=sys.stderr, flush=True)
    json.dump({'model': which, 'labelset': labelset, 'labels': labels, 'floor': FLOOR, 'seconds': round(t_total, 1), 'words': n_words, 'docs': out},
              open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'{out_path}: {len(docs)} docs, {n_words} words, {t_total:.1f} s ({1000 * t_total / max(n_words, 1):.1f} ms/word)')


if __name__ == '__main__':
    main()
