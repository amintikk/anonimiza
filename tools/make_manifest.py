"""Write src/engine/models.json (file name, size and SHA-256 of every model file the app downloads).

Usage: python tools/make_manifest.py <models dir>
The app requests each file as <file>?v=<sha256 prefix> and checks size and hash after downloading."""
import hashlib, json, os, sys

src = sys.argv[1]
files = {
    'webgpu': 'gliner-pii-fp16.onnx',
    'wasm': 'gliner-pii-int8w.onnx',
    'tokenizer': 'tokenizer.json',
    'tokenizerConfig': 'tokenizer_config.json',
}
out = {}
for key, name in files.items():
    h = hashlib.sha256()
    with open(os.path.join(src, name), 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    out[key] = {'file': name, 'bytes': os.path.getsize(os.path.join(src, name)), 'sha256': h.hexdigest()}
dst = os.path.join(os.path.dirname(__file__), '..', 'src', 'engine', 'models.json')
json.dump(out, open(dst, 'w'), indent=2)
print(json.dumps(out, indent=2))
