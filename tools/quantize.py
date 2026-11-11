"""Make the WebAssembly variant of the model: 8-bit weight-only quantization.

Usage: python tools/quantize.py model.onnx gliner-pii-int8w.onnx
Input: the fp32 export from https://huggingface.co/onnx-community/gliner_multi_pii-v1 (onnx/model.onnx).
Needs: pip install onnxruntime onnx onnx_ir

Why not the int8 file published there: it quantizes the activations of every MatMul dynamically, and the
down-projection of the feed-forward blocks has outliers that this breaks (12 of 127 reference entities
survive). Weight-only 8-bit (MatMulNBits, blocks of 128) keeps activations in fp32: 126 of 127 survive.
The embedding table (Gather) is also stored in int8; it is most of the file and quantizes harmlessly."""
import sys, onnx
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer, DefaultWeightOnlyQuantConfig
from onnxruntime.quantization import quantize_dynamic, QuantType
src, dst = sys.argv[1], sys.argv[2]
bits, block = 8, 128
m = onnx.load(src)
cfg = DefaultWeightOnlyQuantConfig(block_size=block, is_symmetric=True, accuracy_level=None, bits=bits)
q = MatMulNBitsQuantizer(m, algo_config=cfg)
q.process()
tmp = dst + '.tmp.onnx'
q.model.save_model_to_file(tmp, use_external_data_format=False)
# Embedding table (Gather) to int8 as well: it is most of the size and harmless to quantize.
quantize_dynamic(tmp, dst, op_types_to_quantize=['Gather'], weight_type=QuantType.QInt8)
import os; os.remove(tmp)
print(dst, os.path.getsize(dst))
