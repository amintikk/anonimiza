| Conjunto | Configuración | Umbral | Cobertura | Cob. exacta | Precisión | Prec. exacta | Cobertura con OTRO_ID | Caracteres sensibles tapados | Caracteres tapados que eran sensibles | Reales | Marcados |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| old | web:gliner-pii-int8w.onnx/base · rules | 0.3 | 99.6 | 95.7 | 94.2 | 90.5 | 99.6 | 99.0 | 94.3 | 230 | 243 |
| old | gliner/full · rules | 0.6 | 99.6 | 94.8 | 95.4 | 90.8 | 99.6 | 99.0 | 95.1 | 230 | 240 |
| old | gliner2/native · rules | 0.6 | 99.1 | 87.4 | 88.8 | 66.3 | 99.1 | 96.2 | 91.7 | 230 | 303 |
| old | gliner/full · model | 0.1 | 87.0 | 78.7 | 88.5 | 80.1 | 87.0 | 88.9 | 89.8 | 230 | 226 |
| old | gliner2/full · model | 0.2 | 92.2 | 90.4 | 88.7 | 87.0 | 92.2 | 86.4 | 89.5 | 230 | 238 |
| new | web:gliner-pii-int8w.onnx/base · rules | 0.3 | 93.3 | 83.7 | 68.2 | 61.2 | 82.4 | 88.1 | 75.6 | 491 | 672 |
| new | gliner/base · rules | 0.3 | 93.3 | 83.5 | 66.0 | 59.0 | 82.4 | 88.4 | 74.0 | 491 | 695 |
| new | gliner/full · rules | 0.6 | 91.9 | 82.1 | 73.7 | 65.5 | 81.1 | 85.6 | 80.3 | 491 | 615 |
| new | gliner2/native · rules | 0.6 | 93.9 | 83.1 | 67.1 | 54.1 | 82.9 | 90.2 | 76.9 | 491 | 754 |
| new | gliner/full · model | 0.1 | 84.1 | 69.9 | 59.0 | 49.4 | 77.7 | 88.7 | 68.3 | 491 | 693 |
| new | gliner2/full · model | 0.2 | 85.7 | 78.6 | 69.3 | 63.3 | 82.6 | 83.5 | 74.9 | 491 | 622 |
| meddocan100 | web:gliner-pii-int8w.onnx/base · rules | 0.3 | 94.6 | 76.0 | 67.5 | 53.9 | 66.9 | 77.1 | 73.3 | 763 | 1077 |
| meddocan100 | gliner/full · rules | 0.6 | 92.5 | 75.2 | 68.8 | 55.6 | 65.4 | 75.3 | 75.6 | 763 | 1032 |
| meddocan100 | gliner2/native · rules | 0.6 | 84.5 | 72.1 | 64.7 | 54.0 | 59.8 | 72.7 | 79.0 | 763 | 1019 |
| meddocan100 | gliner/full · model | 0.1 | 97.4 | 76.8 | 61.9 | 48.6 | 82.4 | 87.8 | 69.8 | 763 | 1254 |
| meddocan100 | gliner2/full · model | 0.2 | 80.2 | 73.5 | 79.2 | 73.4 | 80.2 | 81.1 | 82.9 | 763 | 1084 |
