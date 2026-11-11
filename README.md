<img src="docs/icon.svg" width="64" height="64" alt="">

# Anonimiza

**https://anonimiza.aminox.dev** · [English](https://anonimiza.aminox.dev/en/)

Anonimizador de documentos que funciona entero en el navegador. Pegas un texto o sueltas un PDF o DOCX, la herramienta detecta datos personales, los sustituye por marcadores estables (`[PERSONA_1]`, `[IBAN_1]`…), te deja revisar cada detección y añadir lo que falte, y después restaura los datos originales en la respuesta que te devuelva una IA. El texto no sale de tu equipo y la tabla de sustituciones vive solo en la memoria de la pestaña.

> **No garantiza una anonimización completa.** La detección automática falla a veces y no tiene en cuenta lo que identifica por contexto (un cargo, una fecha, un lugar). Revisa siempre el resultado.

## Cómo funciona

| Paso | Dónde | Detalle |
|---|---|---|
| Leer el archivo | `src/docs/extract.ts` | PDF con pdf.js, DOCX descomprimiendo `word/document.xml` (fflate + DOMParser). Solo texto: sin OCR, sin formato. |
| Datos estructurados | `src/engine/rules.ts` | Expresiones regulares con dígito de control: DNI/NIE (letra), CIF, NSS (módulo 97), IBAN (longitud por país + módulo 97), tarjetas (Luhn), teléfonos españoles en sus agrupaciones habituales y extranjeros con prefijo, correos, IPv4/IPv6, matrículas españolas, y fechas de nacimiento (una fecha justo después de «nacido/a», «fecha de nacimiento», «F. nac.»…). Un DNI/NIE con la letra mal, un IBAN con el control mal o una tarjeta en cuatro grupos que no pasa Luhn se marcan igualmente, como **dudosos**. |
| Nombres, organizaciones, direcciones | `src/engine/gliner.ts` + `worker.ts` | [GLiNER multi PII v1](https://huggingface.co/urchade/gliner_multi_pii-v1) (Apache-2.0) con ONNX Runtime Web en un worker: WebGPU si el navegador ofrece `shader-f16`, si no WebAssembly multihilo (la página está aislada con COOP/COEP). Pre y posproceso de GLiNER portados a TypeScript; textos largos en ventanas de 256 palabras con 48 de solape. |
| Marcadores | `src/engine/anonymize.ts` | Cada valor recibe un marcador estable; se buscan también sus repeticiones y las formas cortas de los nombres, sin distinguir mayúsculas («Javier Molina Ortega» → «Javier Molina», «Sr. Molina», «javier»). Las partes que son palabras comunes (Rosa, Pilar, Dolores…) solo se buscan con su mayúscula. |
| Restaurar | `restore()` | Tolera los cambios típicos de un asistente: mayúsculas, espacio en vez de guion bajo, corchetes perdidos. Señala marcadores desconocidos. |

Etiquetas del modelo: `person`, `organization`, `address`; umbral 0,3 por defecto (sensibilidad «Alta»; 0,45 «Media», 0,6 «Baja»).

## Variantes del modelo

Las exportaciones ONNX de [onnx-community/gliner_multi_pii-v1](https://huggingface.co/onnx-community/gliner_multi_pii-v1) se compararon con GLiNER original en Python (PyTorch) sobre 127 entidades de 28 documentos (umbral 0,3): entidades con los mismos límites y tipo, y mayor diferencia de puntuación.

| Archivo | Tamaño | Entidades iguales | Dif. máx. | Uso |
|---|---:|---:|---:|---|
| `model.onnx` (fp32) | 1157 MB | 127 / 127 | < 0,0001 | — |
| `model_fp16.onnx` | 580 MB | 127 / 127 | 0,061 | **WebGPU** |
| `model_q4f16.onnx` | 472 MB | 117 / 128 | 0,61 | descartada |
| `model_int8.onnx` | 349 MB | 12 / 127 | 0,68 | descartada |
| `model_uint8.onnx` | 349 MB | 23 / 127 | 0,70 | descartada |
| `gliner-pii-int8w.onnx` (propia) | 357 MB | 126 / 127 | 0,047 | **WebAssembly** |

El int8 publicado cuantiza dinámicamente las activaciones de todas las MatMul; probando por grupos, lo que lo rompe es la proyección de salida de las capas feed-forward (31/127 al cuantizar solo esa). La variante para WebAssembly se genera con `tools/quantize.py`: pesos en 8 bits por bloques de 128 (`MatMulNBits`) con activaciones en fp32, y la tabla de embeddings en int8.

Velocidad orientativa: un documento de 187 palabras tarda unos 5–6 s con WebAssembly y 4 hilos en un servidor ARM de 4 núcleos compartidos. La velocidad con WebGPU no se ha medido (ese servidor no tiene GPU).

## Cifras medidas

Con el mismo código que la web (modelo int8w, umbral 0,3), sobre conjuntos que no se usaron para ajustarla. «Cobertura» cuenta como acierto que lo marcado se solape con el dato; las cifras sin «otros identificadores» se refieren a lo que la herramienta busca.

| Conjunto | Datos | Cobertura | Cobertura exacta | Precisión | Caracteres sensibles tapados |
|---|---:|---:|---:|---:|---:|
| `tests/data/documentos-nuevo.json`: 47 documentos sucios, congelados antes de medir | 491 (+65 otros identificadores) | **93,3 %** (82,4 % con otros identificadores) | 83,7 % | **68,2 %** | 88,1 % |
| MEDDOCAN (público, historias clínicas; 100 primeras del test) | 763 (+316 otros identificadores) | **94,6 %** (66,9 % con otros identificadores) | 76,0 % | **67,5 %** | 77,1 % |
| `tests/data/documentos.json`: 29 documentos limpios con los que se desarrolló | 230 | 99,6 % | 95,7 % | 94,2 % | 99,0 % |

Las cifras del conjunto antiguo son optimistas: las decisiones (etiquetas, umbral, formatos de teléfono, formas cortas de los nombres) se tomaron viendo sus fallos. Los «otros identificadores» (números de expediente, de historia clínica, de póliza, usuarios) no se buscan y quedan a la vista. Tablas por tipo en la web y en `docs/evaluacion/`; cada error, uno por uno, en `docs/comparacion/errores-*.txt`.

Comparación con GLiNER2-PII (`fastino/gliner2-privacy-filter-PII-multi`), con método, intervalos de confianza y viabilidad en el navegador: [docs/comparacion-gliner2.md](docs/comparacion-gliner2.md). Resumen: con las reglas no mejora en el conjunto nuevo y cubre 10 puntos menos en MEDDOCAN.

Para repetir las medidas:

```
python tools/compare/gold.py new tests/data/documentos-nuevo.json nuevo.json
node tools/compare/predict_prod.ts <carpeta-modelos> gliner-pii-int8w.onnx nuevo.json pred.json
node tools/compare/score.ts nuevo.json pred.json --mode rules --th 0.3 --errors --json docs/evaluacion/nuevo.json
node tools/make_figures.ts
```

## Tests

```
npm test                                   # reglas, marcadores, restauración, ventanas, i18n
ANONIMIZA_MODELS=<carpeta> npm test        # además: tokens y entidades frente a GLiNER en Python, y el caso
                                           # tests/data/caso-revision.txt de principio a fin con el modelo int8w
```

`tests/gliner.test.ts` compara con `tests/fixtures/reference.json`, generado por `tools/reference.py` con el GLiNER original. Con `model.onnx` (fp32) coinciden la división en palabras, los ids de tokens, la máscara de palabras y las 127 entidades con diferencia de puntuación < 0,001. Para otra variante: `ANONIMIZA_MODEL=gliner-pii-int8w.onnx ANONIMIZA_TOLERANCE=0.05 ANONIMIZA_MIN_AGREE=0.95`.

Nota: la referencia usa el `tokenizer.json` de la exportación ONNX, que conserva el normalizador de SentencePiece con el que se entrenó el modelo; las versiones recientes de `transformers` reconstruyen el tokenizador de mDeBERTa sin él (por ejemplo, convierten «º» en `[UNK]`).

## Privacidad comprobable

La web se sirve con esta política (ver `deploy/nginx.conf`):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' https://anonimiza-models.aminox.dev; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; …
```

El navegador bloquea cualquier conexión a otro origen, no hay scripts en línea ni de terceros, y no hay analítica ni cookies. Los modelos se descargan del bucket R2 con su SHA-256 comprobado y quedan en Cache Storage.

## Desarrollo

```
npm install
ANONIMIZA_MODELS=<carpeta con los .onnx y tokenizer*.json> npm run dev   # sirve /models/ desde esa carpeta
npm run build
```

Herramientas: `tools/reference.py` (referencia Python), `tools/quantize.py` (variante int8w), `tools/make_manifest.py` (tamaños y SHA-256 → `src/engine/models.json`), `tools/upload_r2.py` (subida al bucket), `tools/compare/` (medidas y comparación de modelos) y `tools/make_figures.ts` (cifras de la web). Publicación en el servidor: `deploy.sh`.

## Licencia

Código: MIT © 2026 Amin Tahtah Toumi (amintahtahtoumi@gmail.com). Modelo GLiNER y su exportación ONNX: Apache-2.0. mDeBERTa-v3: MIT. Ver [licencias](https://anonimiza.aminox.dev/licencias/).
