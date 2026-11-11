# Comparación de modelos

Código de la comparación entre `urchade/gliner_multi_pii-v1` (el modelo de la web) y
`fastino/gliner2-privacy-filter-PII-multi`. Resultados y conclusiones: [docs/comparacion-gliner2.md](../../docs/comparacion-gliner2.md).

| Archivo | Qué hace |
|---|---|
| `gold.py` | Pasa los conjuntos (antiguo, nuevo, MEDDOCAN en BRAT) a un formato común con posiciones en UTF-16 y tipos comunes. |
| `predict.py` | Ejecuta un modelo en Python (PyTorch, o el ONNX de GLiNER2 con `gliner2-onnx`) con las mismas ventanas para los dos y guarda todo lo que propone por encima de 0,1. |
| `predict_prod.ts` | Lo mismo con el código de la web (ONNX en TypeScript), para medir exactamente lo que está publicado. |
| `score.ts` | Puntúa: el modelo solo, o el modelo con las reglas y las repeticiones de la web (`buildDetections`). Barrido de umbrales, tablas por tipo y lista de errores. |
| `bootstrap.py` | Intervalo de confianza de la diferencia entre dos configuraciones (remuestreo de documentos). |
| `agree.py` | Cuántas entidades comparten dos ejecuciones (exportación ONNX frente a PyTorch, variantes cuantizadas). |
| `fp16.py` | Copia fp16 de un grafo ONNX. La int8 se hace con `tools/quantize.py`. |
| `ortweb.ts` | Carga los grafos en ONNX Runtime Web (WebAssembly, en Node) y mide tiempo y memoria. |
| `seleccion.json` | Umbral y etiquetas elegidos en el conjunto antiguo antes de medir los otros dos. |

Entorno: `pip install torch gliner gliner2 gliner2-onnx onnx onnxruntime onnx_ir` (CPU).
MEDDOCAN: https://zenodo.org/records/4279323 (`meddocan.zip`, carpeta `test/brat`).
