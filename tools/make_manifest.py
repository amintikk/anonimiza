"""Write src/engine/models.json (file name, size and SHA-256 of every model file the app downloads).

Usage: python tools/make_manifest.py <models dir> [<ocr dir>]
The OCR files (text detection, text recognition, character list) come from <ocr dir>; the entries of the
GLiNER files already in models.json are kept when the models dir does not hold them.
The app requests each file as <file>?v=<sha256 prefix> and checks size and hash after downloading."""
import hashlib, json, os, sys

src = sys.argv[1]
files = {
    'webgpu': 'gliner-pii-fp16.onnx',
    'wasm': 'gliner-pii-int8w.onnx',
    'tokenizer': 'tokenizer.json',
    'tokenizerConfig': 'tokenizer_config.json',
}
ocr_files = {'ocrDet': 'ocr-det.onnx', 'ocrRec': 'ocr-rec.onnx', 'ocrDict': 'ocr-rec-dict.json'}
dst = os.path.join(os.path.dirname(__file__), '..', 'src', 'engine', 'models.json')
out = json.load(open(dst)) if os.path.exists(dst) else {}
def entry(folder, name):
    h = hashlib.sha256()
    with open(os.path.join(folder, name), 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return {'file': name, 'bytes': os.path.getsize(os.path.join(folder, name)), 'sha256': h.hexdigest()}
for key, name in files.items():
    if os.path.exists(os.path.join(src, name)):
        out[key] = entry(src, name)
if len(sys.argv) > 2:
    for key, name in ocr_files.items():
        out[key] = entry(sys.argv[2], name)
json.dump(out, open(dst, 'w'), indent=2)
print(json.dumps(out, indent=2))
