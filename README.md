<img src="docs/icon.svg" width="64" height="64" alt="">

# Anonimiza

**https://anonimiza.aminox.dev** · [English](https://anonimiza.aminox.dev/en/)

Anonimizador de documentos que funciona entero en el navegador. Pegas un texto o sueltas un PDF o DOCX, la herramienta detecta datos personales, los sustituye por marcadores estables (`[PERSONA_1]`, `[IBAN_1]`…), te deja revisar cada detección y añadir lo que falte, y después restaura los datos originales en la respuesta que te devuelva una IA. El texto no sale de tu equipo y la tabla de sustituciones vive solo en la memoria de la pestaña.

> **No garantiza una anonimización completa.** La detección automática falla a veces y no tiene en cuenta lo que identifica por contexto (un cargo, una fecha, un lugar). Revisa siempre el resultado.

## Cómo funciona

| Paso | Dónde | Detalle |
|---|---|---|
| Leer el archivo | `src/docs/extract.ts` | PDF con pdf.js, DOCX descomprimiendo `word/document.xml` (fflate + DOMParser). Solo texto: sin OCR, sin formato. |
| Datos estructurados | `src/engine/rules.ts` | Expresiones regulares con dígito de control: DNI/NIE (letra), CIF, NSS (módulo 97), IBAN (longitud por país + módulo 97), tarjetas (Luhn), teléfonos españoles en sus agrupaciones habituales y extranjeros con prefijo, correos, IPv4/IPv6. |
| Nombres, organizaciones, direcciones | `src/engine/gliner.ts` + `worker.ts` | [GLiNER multi PII v1](https://huggingface.co/urchade/gliner_multi_pii-v1) (Apache-2.0) con ONNX Runtime Web en un worker: WebGPU si el navegador ofrece `shader-f16`, si no WebAssembly multihilo (la página está aislada con COOP/COEP). Pre y posproceso de GLiNER portados a TypeScript; textos largos en ventanas de 256 palabras con 48 de solape. |
| Marcadores | `src/engine/anonymize.ts` | Cada valor recibe un marcador estable; se buscan también sus repeticiones y las formas cortas de los nombres («Javier Molina Ortega» → «Javier Molina», «Sr. Molina»). |
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

`tests/data/documentos.json`: 29 documentos ficticios en español (contratos, nóminas, informes médicos, correos, chats, sentencias, facturas…) con 230 datos personales anotados a mano, incluidos dos documentos sin datos personales y uno con números que lo parecen. `tools/evaluate.ts` ejecuta el mismo código que la web (reglas + modelo + repeticiones) con onnxruntime-node:

```
node tools/evaluate.ts <carpeta-modelos> gliner-pii-int8w.onnx 0.3 --json docs/evaluacion-int8w.json
```

Resultado con la variante WebAssembly (`docs/evaluacion-int8w.json`); «con solape» cuenta como acierto que lo marcado se solape con un dato del mismo tipo, «exacta» exige los mismos límites:

| Tipo | Anotados | Marcados | Cobertura con solape | Cobertura exacta | Precisión con solape | Precisión exacta |
|---|---:|---:|---:|---:|---:|---:|
| Personas | 84 | 85 | 100,0 % | 89,3 % | 98,8 % | 88,2 % |
| Organizaciones | 29 | 32 | 100,0 % | 100,0 % | 90,6 % | 90,6 % |
| Direcciones | 24 | 25 | 95,8 % | 95,8 % | 92,0 % | 92,0 % |
| DNI | 14 | 14 | 100,0 % | 100,0 % | 100,0 % | 100,0 % |
| NIE | 4 | 4 | 100,0 % | 100,0 % | 100,0 % | 100,0 % |
| CIF | 8 | 8 | 100,0 % | 100,0 % | 100,0 % | 100,0 % |
| NSS | 3 | 3 | 100,0 % | 100,0 % | 100,0 % | 100,0 % |
| IBAN | 9 | 9 | 100,0 % | 100,0 % | 100,0 % | 100,0 % |
| Tarjetas | 3 | 3 | 100,0 % | 100,0 % | 100,0 % | 100,0 % |
| Teléfonos | 30 | 30 | 100,0 % | 100,0 % | 100,0 % | 100,0 % |
| Correos | 18 | 19 | 100,0 % | 100,0 % | 94,7 % | 94,7 % |
| IP | 4 | 4 | 100,0 % | 100,0 % | 100,0 % | 100,0 % |
| **Total (WebAssembly, int8w)** | 230 | 236 | **99,6 %** | 95,7 % | **97,0 %** | 93,2 % |
| **Total (WebGPU, fp16)** | 230 | 236 | 99,6 % | 95,2 % | 97,0 % | 92,8 % |

Caracteres sensibles tapados: 99,0 %; de los caracteres tapados, 96,1 % eran sensibles.

**Estas cifras son optimistas.** Los documentos los escribió el autor y son limpios, y varias decisiones (etiquetas, umbral, agrupaciones de teléfono, búsqueda de formas cortas de los nombres) se tomaron viendo los fallos en este mismo conjunto. El modelo solo, sin las búsquedas de repeticiones, encontraba el 94 % de los nombres. En documentos reales habrá más fallos.

## Tests

```
npm test                                   # reglas, marcadores, restauración, ventanas, i18n
ANONIMIZA_MODELS=<carpeta> npm test        # además: tokens y entidades frente a GLiNER en Python
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

Herramientas: `tools/reference.py` (referencia Python), `tools/quantize.py` (variante int8w), `tools/make_manifest.py` (tamaños y SHA-256 → `src/engine/models.json`), `tools/upload_r2.py` (subida al bucket), `tools/evaluate.ts` y `tools/make_figures.ts` (cifras de la web). Publicación en el servidor: `deploy.sh`.

## Licencia

Código: MIT © 2026 Amin Tahtah Toumi (amintahtahtoumi@gmail.com). Modelo GLiNER y su exportación ONNX: Apache-2.0. mDeBERTa-v3: MIT. Ver [licencias](https://anonimiza.aminox.dev/licencias/).
