<img src="docs/icon.svg" width="64" height="64" alt="">

# Anonimiza

**https://anonimiza.aminox.dev** · [English](https://anonimiza.aminox.dev/en/)

Anonimizador de documentos que funciona entero en el navegador. Pegas un texto o sueltas un PDF o DOCX, la herramienta detecta datos personales, los sustituye por marcadores estables (`[PERSONA_1]`, `[IBAN_1]`…), te deja revisar cada detección y añadir lo que falte, y después restaura los datos originales en la respuesta que te devuelva una IA. El texto no sale de tu equipo y la tabla de sustituciones vive solo en la memoria de la pestaña.

> **No garantiza una anonimización completa.** La detección automática falla a veces y no tiene en cuenta lo que identifica por contexto (un cargo, una fecha, un lugar). Revisa siempre el resultado.

## Cómo funciona

| Paso | Dónde | Detalle |
|---|---|---|
| Leer el archivo | `src/docs/extract.ts`, `pdf.ts`, `docx.ts` | PDF con pdf.js, DOCX descomprimiendo `word/document.xml` (fflate + DOMParser). Solo texto. Si un PDF no tiene texto copiable, se lee con OCR (ver abajo) y la app lo avisa. |
| OCR (solo PDF sin texto) | `src/ocr/` | PP-OCRv6 small (PaddleOCR, Apache 2.0): detección DB y reconocimiento CTC, en onnxruntime-web, con hasta tres workers que leen páginas a la vez (las líneas salen en orden de página). Modelos y diccionario en el bucket de modelos (31 MB, se descargan la primera vez). |
| Datos estructurados | `src/engine/rules.ts` | Expresiones regulares con dígito de control: DNI/NIE (letra), CIF, NSS (módulo 97), IBAN (longitud por país + módulo 97), tarjetas (Luhn), teléfonos españoles en sus agrupaciones habituales y extranjeros con prefijo, correos, IPv4/IPv6, matrículas españolas, fechas de nacimiento (una fecha justo después de «nacido/a», «fecha de nacimiento», «F. nac.»…) y otros identificadores (un código con cifras justo después de «NHC», «expediente», «póliza», «colegiado», «pasaporte», «user=»…, alias con @ y nombres de usuario al principio de línea). Los teléfonos móviles se aceptan en cualquier agrupación; los fijos en agrupaciones raras, solo tras «tel.», «teléfono»… Direcciones escritas completas con código postal («Calle de Alcalá, 120, 4.ª planta, 28009 Madrid»); las demás las busca el modelo. Un DNI/NIE con la letra mal, un CIF con el control mal tras la palabra «CIF», un IBAN con el control mal o una tarjeta en cuatro grupos que no pasa Luhn se marcan igualmente, como **dudosos**. |
| Nombres, organizaciones, direcciones | `src/engine/gliner.ts` + `worker.ts` | [GLiNER multi PII v1](https://huggingface.co/urchade/gliner_multi_pii-v1) (Apache-2.0) con ONNX Runtime Web en un worker: WebGPU si el navegador ofrece `shader-f16`, si no WebAssembly multihilo (la página está aislada con COOP/COEP). Pre y posproceso de GLiNER portados a TypeScript; textos largos en ventanas de 256 palabras con 48 de solape. |
| Marcadores | `src/engine/anonymize.ts` | Cada valor recibe un marcador estable; se buscan también sus repeticiones y las formas cortas de los nombres, sin distinguir mayúsculas («Javier Molina Ortega» → «Javier Molina», «Sr. Molina», «javier»). Las partes que son palabras comunes (Rosa, Pilar, Dolores…) solo se buscan con su mayúscula. Se descartan las propuestas del modelo que son solo un papel o un servicio («la paciente», «el ARRENDADOR», «ambas partes», «EL PROVEEDOR», «Servicio de Urología»). |
| PDF anonimizado | `src/docs/pdf.ts` | Al leer el PDF se guarda de qué fragmento de texto y posición sale cada carácter. Al descargar, cada página se dibuja con pdf.js, cada detección se tapa con un recuadro con su marcador y con esas imágenes (JPEG, 144 ppp) se escribe un PDF nuevo sin metadatos del original. Las páginas son imágenes a propósito: un recuadro sobre el texto del PDF original lo dejaría debajo, seleccionable. Las imágenes del documento (firmas, fotos) no se revisan. |
| DOCX anonimizado | `src/docs/docx.ts` | Al leer se guarda de qué `<w:t>` sale cada carácter (cuerpo, cabeceras, pies, notas y comentarios). Al descargar, el marcador se escribe donde empieza el dato y el resto del dato se borra de los `<w:t>` siguientes, así que se conserva el formato. Se aceptan los cambios pendientes (el texto borrado desaparece) y se vacían los autores de comentarios y cambios, el autor y la empresa del archivo y la miniatura; los enlaces, códigos de campo y textos alternativos que repiten un dato se cambian por su marcador. |
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

## Variantes

Cada tipo de dato se puede escribir de muchas maneras. `tests/variantes.ts` genera más de 1100: separadores (espacio, guion, punto, barra, ninguno), mayúsculas y minúsculas, espacios duros de Word/PDF, un salto de línea dentro del dato, etiquetas en castellano, catalán, gallego, euskera e inglés, distintos contextos (frase, tabla, paréntesis, final de línea) y datos mal copiados con su etiqueta delante. Todas tienen que detectarse, y una lista de trampas (importes, horas, fechas normales, códigos de producto, leyes, ISBN) no debe marcarse; lo comprueba `tests/variantes.test.ts`.

Criterio: **ante la duda, sustituir y avisar**. Con la palabra que lo anuncia («DNI», «CIF», «IBAN», «tarjeta», «NSS»…), un valor con la forma correcta se sustituye aunque falle su dígito de control, y se marca como dudoso para que lo compruebes.

Lo que depende del modelo (nombres y direcciones) se prueba con `node tools/variantes_modelo.ts <carpeta-modelos>`: 10 nombres de distintos orígenes en 9 formas («APELLIDOS, Nombre», inicial, tratamiento, minúsculas, sin tildes…) y 6 contextos, y 14 direcciones en 3 contextos. Resultado actual: 581 de 582 sin fugas; la que queda es un nombre completo en minúsculas como etiqueta de chat («nahia etxeberria uriarte:»), donde el modelo no ve el segundo apellido.

## Cifras medidas

Con el mismo código que la web (modelo int8w, umbral 0,3). «Cobertura» cuenta como acierto que lo marcado se solape con el dato del mismo tipo; «exacta» exige los mismos límites. Las cifras incluyen los «otros identificadores» (expediente, historia clínica, póliza, usuario…).

| Conjunto | Datos | Cobertura | Cobertura exacta | Precisión | Caracteres sensibles tapados |
|---|---:|---:|---:|---:|---:|
| `tests/data/documentos-tercero.json`: 60 documentos sucios, congelados antes de medir y **no usados para ajustar** | 508 | **89,8 %** | 74,2 % | **80,7 %** | 92,2 % |
| MEDDOCAN (público, historias clínicas): 150 historias del test no miradas al escribir las reglas | 1576 | 96,7 % | 83,9 % | 91,5 % | 96,3 % |
| `tests/data/documentos-nuevo.json`: 47 documentos sucios, usados para ajustar | 556 | 92,4 % | 83,6 % | 81,8 % | 95,1 % |
| `tests/data/documentos.json`: 29 documentos limpios con los que se desarrolló | 230 | 100,0 % | 95,7 % | 92,7 % | 99,3 % |

La cifra honesta es la del tercer conjunto. Las reglas de otros identificadores, teléfonos en agrupaciones raras y papeles («la paciente», «Servicio de Urología») se escribieron viendo los fallos del conjunto nuevo y de otras 100 historias de MEDDOCAN; las 150 de la tabla comparten plantilla con esas («NHC:», «NºCol:»), así que su fila de otros identificadores (97,9 %) es optimista: en el tercer conjunto es del 53,3 %. Frente a la versión anterior, en el tercer conjunto la cobertura pasó del 82,1 % al 89,8 % y la precisión del 74,8 % al 80,7 % (con la primera tanda de cambios, 88,8 % y 80,5 %; diferencia de precisión, IC 95 % +2,6 a +9,9 puntos por remuestreo de documentos). Los cambios posteriores salieron de variantes generadas y de casos reales (un contrato, y el expediente en PDF de `tools/expediente_prueba.py`), no de los fallos de este conjunto. Lo que más se escapa ahora: alias de chat y foro sin palabra delante, identificadores sin etiqueta y nombres que son palabras comunes en minúscula. Tablas por tipo en la web y en `docs/evaluacion/`; los errores del tercer conjunto, uno por uno, en `docs/evaluacion/errores-tercero.txt`.

Comparación con GLiNER2-PII (`fastino/gliner2-privacy-filter-PII-multi`), con método, intervalos de confianza y viabilidad en el navegador: [docs/comparacion-gliner2.md](docs/comparacion-gliner2.md). Resumen: con las reglas no mejora en el conjunto nuevo y cubre 10 puntos menos en MEDDOCAN.

Para repetir las medidas:

```
python tools/compare/gold.py new tests/data/documentos-tercero.json third.json
node tools/compare/predict_prod.ts <carpeta-modelos> gliner-pii-int8w.onnx third.json pred.json
node tools/compare/score.ts third.json pred.json --mode rules --th 0.3 --errors --json docs/evaluacion/tercero.json
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
