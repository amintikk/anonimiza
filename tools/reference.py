"""Reference outputs of the original GLiNER (PyTorch) for the parity tests.

Usage: python tools/reference.py tests/data/documentos.json tests/fixtures/reference.json
Needs: pip install gliner torch (CPU is enough). Downloads urchade/gliner_multi_pii-v1 from Hugging Face.

For every test document short enough to fit in one window it stores the word split, the token ids
and word mask that GLiNER feeds the model, and the entities GLiNER predicts. tests/parity.test.ts
runs the same documents through the TypeScript pipeline and compares."""
import json, sys, warnings

warnings.filterwarnings('ignore')
from gliner import GLiNER
from huggingface_hub import hf_hub_download
from transformers import PreTrainedTokenizerFast

LABELS = ['person', 'organization', 'address']  # must match src/engine/gliner.ts
THRESHOLD = 0.3
MAX_WORDS = 300  # the TypeScript pipeline splits longer texts into windows; parity covers one window

model = GLiNER.from_pretrained('urchade/gliner_multi_pii-v1')
model.eval()
proc = model.data_processor
# Use the tokenizer.json shipped with the ONNX export (the same file the web app loads). It keeps the
# SentencePiece normalizer the model was trained with; recent transformers versions rebuild the
# mDeBERTa tokenizer without it (e.g. they turn "º" into [UNK] instead of "o").
proc.transformer_tokenizer = PreTrainedTokenizerFast(
    tokenizer_file=hf_hub_download('onnx-community/gliner_multi_pii-v1', 'tokenizer.json'),
    cls_token='[CLS]', sep_token='[SEP]', pad_token='[PAD]', unk_token='[UNK]', mask_token='[MASK]')
docs = json.load(open(sys.argv[1], encoding='utf-8'))['docs']
out = []
for d in docs:
    words = list(proc.words_splitter(d['text']))
    if len(words) > MAX_WORDS:
        continue
    tok = proc.tokenize_inputs([[w for w, _, _ in words]], LABELS)
    ents = model.predict_entities(d['text'], LABELS, threshold=THRESHOLD, flat_ner=True)
    out.append({
        'id': d['id'],
        'words': [[w, s, e] for w, s, e in words],
        'input_ids': tok['input_ids'][0].tolist(),
        'words_mask': tok['words_mask'][0].tolist(),
        'entities': [{'start': e['start'], 'end': e['end'], 'label': e['label'], 'score': round(float(e['score']), 5)} for e in ents],
    })
    print(d['id'], len(words), 'words', len(ents), 'entities', flush=True)
json.dump({'labels': LABELS, 'threshold': THRESHOLD, 'docs': out}, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
