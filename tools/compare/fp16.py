"""fp16 copy of an ONNX graph (weights and compute in fp16, inputs and outputs kept as they were).
Usage: python tools/compare/fp16.py in.onnx out.onnx"""
import sys, os, onnx
from onnxruntime.transformers.float16 import convert_float_to_float16
m = onnx.load(sys.argv[1])
m16 = convert_float_to_float16(m, keep_io_types=True, disable_shape_infer=False)
onnx.save(m16, sys.argv[2])
print(sys.argv[2], os.path.getsize(sys.argv[2]))
