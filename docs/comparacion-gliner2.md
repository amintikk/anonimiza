# GLiNER (actual) frente a GLiNER2-PII: comparación

Noviembre de 2026. Solo medida: el modelo de producción no ha cambiado.

- **Actual:** [`urchade/gliner_multi_pii-v1`](https://huggingface.co/urchade/gliner_multi_pii-v1).
- **Candidato:** [`fastino/gliner2-privacy-filter-PII-multi`](https://huggingface.co/fastino/gliner2-privacy-filter-PII-multi), con el ONNX de la comunidad [`DanKau/gliner2-pii-onnx`](https://huggingface.co/DanKau/gliner2-pii-onnx).
- **Código:** [`tools/compare`](../tools/compare/README.md).

## Resumen

**Recomendación: no portarlo.**

- **Con las reglas, que es como trabaja la web:**
  - **Conjunto nuevo y congelado:** GLiNER2 no se distingue de lo que hay en producción. Cobertura +0,6 puntos (IC 95 %: −1,1 a +2,4); precisión −1,0 (IC 95 %: −6,0 a +3,1).
  - **MEDDOCAN, el conjunto público:** GLiNER2 es claramente peor. Cobertura −10,1 puntos (IC 95 %: −12,7 a −7,6). Se le escapa el 15 % de los nombres, casi todos en campos «Apellidos: …».
- **Modelo solo, sin reglas:** GLiNER2 es más preciso (+10 y +17 puntos), pero cubre igual en el conjunto nuevo y 17 puntos menos en MEDDOCAN. Su ventaja real es que encuentra más números de expediente y usuarios. Ninguno de los dos sistemas busca eso hoy, y no compensa lo que pierde.
- **Coste:**
  - Pesa unos 450 MB en int8 frente a 357 MB.
  - Hay que portar otro preproceso: prompt de esquema, cuatro grafos y cabezas propias.
  - Sus tramos llegan como mucho a 8 palabras, así que parte las direcciones en trozos.
  - La velocidad es parecida.

## Método

1. **Conjunto nuevo** ([`tests/data/documentos-nuevo.json`](../tests/data/documentos-nuevo.json)): 47 documentos con 556 datos anotados.
   - Son textos sucios: chats en minúscula y con erratas, texto de PDF con líneas y palabras partidas, voz transcrita.
   - Tienen nombres vascos, catalanes, gallegos, árabes, latinoamericanos y rumanos, y nombres que son palabras comunes.
   - Incluyen organizaciones que parecen personas, 4 DNI/NIE con la letra mal y 7 textos sin datos.
   - Lo escribió y anotó un agente que no vio el código del detector ni el conjunto antiguo.
   - Se congeló con un commit (`9fd05f2`, sha256 `c73e57da…`) antes de ejecutar ningún modelo sobre él, y nada se ha ajustado mirando sus fallos.
2. **MEDDOCAN** (Marimon et al., 2019, [Zenodo 4279323](https://zenodo.org/records/4279323)): historias clínicas en español escritas por otros. Para limitar el tiempo de CPU se usan las 100 primeras de la partición de prueba por orden de archivo.
   - **Equivalencia de tipos** (en `gold.py`):
     - Nombres → personas.
     - Hospital, institución y centro de salud → organizaciones.
     - Calle → dirección.
     - Población y país → opcional.
     - Correo y teléfono → sus tipos.
     - Identificadores → «otros identificadores».
   - **Excluidos** (opcionales o no se cuentan): fechas, edades, sexo y profesión.
3. **Mismo código de medida para los dos:**
   - **Inferencia:** los dos modelos se ejecutan en Python (PyTorch), con las mismas ventanas de 200 palabras y 50 de solape.
   - **Conjunto de etiquetas por modelo:**
     - `base`: persona, organización y dirección.
     - `full`: todos los tipos, en el vocabulario de cada modelo.
     - `native`: solo GLiNER2, con sus etiquetas `street_address`, `city` y `postal_code`.
   - **«Modelo con reglas»:** pasa los nombres, organizaciones y direcciones del modelo por las mismas reglas y la misma búsqueda de repeticiones que la web (`buildDetections`).
   - **Lo que hay en producción:** se mide aparte con el código TypeScript de la web y el modelo int8w (`predict_prod.ts`).
4. **Umbral y etiquetas elegidos en el conjunto antiguo**, con F2 con solape (la cobertura pesa el doble) y, si hay empate, el umbral más bajo. La elección quedó registrada en un commit (`tools/compare/seleccion.json`) antes de medir los otros dos conjuntos:
   - **Actual con reglas:** `full`, umbral 0,6.
   - **GLiNER2 con reglas:** `native`, umbral 0,6.
   - **Modelos solos:** el actual con 0,1 y GLiNER2 con 0,2.
5. **Cómo se puntúa:**
   - **Acierto:** lo marcado se solapa con un dato del mismo tipo. DNI/NIE y otros identificadores se consideran compatibles.
   - **Exacta:** mismos límites.
   - **«Cobertura»:** cuenta lo que la herramienta busca. «Con OTRO_ID» suma expedientes, usuarios y números de historia.
   - **Intervalos de confianza:** remuestreo de documentos emparejado, 10 000 veces (`bootstrap.py`).

## Tabla comparativa

Cobertura y precisión con solape, sin OTRO_ID salvo donde se indica:

| Conjunto | Configuración | Umbral | Cobertura | Cob. exacta | Precisión | Prec. exacta | Cobertura con OTRO_ID | Caracteres sensibles tapados |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Antiguo (ajuste) | **Producción** (web, int8w, base + reglas) | 0,3 | 99,6 | 95,7 | 94,2 | 90,5 | 99,6 | 99,0 |
| Antiguo (ajuste) | Actual, full + reglas | 0,6 | 99,6 | 94,8 | 95,4 | 90,8 | 99,6 | 99,0 |
| Antiguo (ajuste) | **GLiNER2**, native + reglas | 0,6 | 99,1 | 87,4 | 88,8 | 66,3 | 99,1 | 96,2 |
| Antiguo (ajuste) | Actual solo (full) | 0,1 | 87,0 | 78,7 | 88,5 | 80,1 | 87,0 | 88,9 |
| Antiguo (ajuste) | GLiNER2 solo (full) | 0,2 | 92,2 | 90,4 | 88,7 | 87,0 | 92,2 | 86,4 |
| **Nuevo** | **Producción** | 0,3 | 93,3 | 83,7 | 68,2 | 61,2 | 82,4 | 88,1 |
| Nuevo | Actual, full + reglas | 0,6 | 91,9 | 82,1 | 73,7 | 65,5 | 81,1 | 85,6 |
| Nuevo | **GLiNER2**, native + reglas | 0,6 | 93,9 | 83,1 | 67,1 | 54,1 | 82,9 | 90,2 |
| Nuevo | Actual solo (full) | 0,1 | 84,1 | 69,9 | 59,0 | 49,4 | 77,7 | 88,7 |
| Nuevo | GLiNER2 solo (full) | 0,2 | 85,7 | 78,6 | 69,3 | 63,3 | 82,6 | 83,5 |
| **MEDDOCAN** | **Producción** | 0,3 | 94,6 | 76,0 | 67,5 | 53,9 | 66,9 | 77,1 |
| MEDDOCAN | Actual, full + reglas | 0,6 | 92,5 | 75,2 | 68,8 | 55,6 | 65,4 | 75,3 |
| MEDDOCAN | **GLiNER2**, native + reglas | 0,6 | 84,5 | 72,1 | 64,7 | 54,0 | 59,8 | 72,7 |
| MEDDOCAN | Actual solo (full) | 0,1 | 97,4 | 76,8 | 61,9 | 48,6 | 82,4 | 87,8 |
| MEDDOCAN | GLiNER2 solo (full) | 0,2 | 80,2 | 73,5 | 79,2 | 73,4 | 80,2 | 81,1 |

Datos que cuentan (sin OTRO_ID): 230 en el antiguo, 491 en el nuevo y 763 en MEDDOCAN. Tabla con más columnas en [comparacion/tabla.md](comparacion/tabla.md).

Diferencias con intervalo de confianza del 95 % ([comparacion/bootstrap.txt](comparacion/bootstrap.txt)); el signo es GLiNER2 menos la referencia:

| Conjunto | Comparación | Cobertura | Precisión |
|---|---|---|---|
| Nuevo | GLiNER2 + reglas frente a producción | +0,6 (−1,1 a +2,4) | −1,0 (−6,0 a +3,1) |
| Nuevo | GLiNER2 + reglas frente a actual full + reglas | +2,0 (+0,2 a +4,1) | −6,5 (−11,4 a −2,1) |
| Nuevo | Modelos solos | +1,6 (−1,7 a +4,9) | +10,3 (+5,2 a +14,6) |
| MEDDOCAN | GLiNER2 + reglas frente a producción | **−10,1 (−12,7 a −7,6)** | −2,8 (−6,9 a +1,0) |
| MEDDOCAN | GLiNER2 + reglas frente a actual full + reglas | −8,0 (−10,7 a −5,3) | −4,1 (−7,8 a −0,8) |
| MEDDOCAN | Modelos solos | **−17,2 (−19,6 a −14,7)** | **+17,4 (+14,8 a +19,9)** |

### Por tipo (con reglas, umbral elegido)

| Tipo | Nuevo: producción | Nuevo: GLiNER2 | MEDDOCAN: producción | MEDDOCAN: GLiNER2 |
|---|---|---|---|---|
| Personas | 94,7 % / 65,8 % | 93,9 % / 72,2 % | 100 % / 65,5 % | **85,1 %** / 71,1 % |
| Organizaciones | 96,7 % / 29,9 % | 93,3 % / 25,5 % | 88,4 % / 31,7 % | 73,9 % / 30,0 % |
| Direcciones | 73,9 % / 58,6 % | 100 % / 50,0 % (exacta 4 %) | 82,7 % / 97,3 % | 78,6 % / 59,7 % |

Cada celda es cobertura / precisión. El resto de tipos (identificadores, IBAN, teléfonos, correos, fechas de nacimiento y matrículas) los encuentran las reglas y salen iguales con los dos modelos.

## Errores

Listas completas, una línea por dato que se escapa o se marca de más: [docs/comparacion/errores-*.txt](comparacion/).

**Se le escapan a los dos** (conjunto nuevo, con reglas). Son límites de las reglas o de la anotación más que del modelo:
- **Otros identificadores:** 65 de 65. Números de historia, expediente, póliza, socio y pedido, y usuarios de foro. No se buscan.
- **Teléfonos en agrupaciones raras o dictados:** «631 77 8 90 21», «9 5 4 1 2 3 7 8 9», «631 778 9021», «6 4 4 - 0 1 9 - 2 3 7», «seis cuatro nueve doce…».
- **Fechas de nacimiento lejos de su aviso:** «nacida en Medellín (Colombia) el 9 de agosto de 1990»; la de un hijo en un formulario; «2 de febrero de 1988».
- **Nombres que son palabras comunes, escritos en minúscula:** «rosa», «amparo», «soledad». Se buscan con mayúscula a propósito, para no tapar «rosa» el color.
- **Un IBAN con un salto de línea y mucho espacio, y un DNI partido** «39.871.402-\nM».
- **«AMRANI, MOHA-\nMED»:** un nombre partido con guion de corte.

**Solo a producción:**
- **Direcciones gallegas y con abreviaturas largas:** «Rúa do Hórreo 54, 2º esq., …», «C/ Ronda de Toledo 9, esc. dcha., …», «Avda. de la Constitución 45, 1º izq., …».
- **«Rosa Pujol» y «Farmàcia Pujol».**
- **Nombres sueltos:** «Blanca», «Consuelo», «lola».

**Solo a GLiNER2:**
- **Nombres sueltos:** «Amparo», «Dolores», «Blanca Esteve».
- **Nombres en formato de lista oficial:** «MORENO PRIETO, ROCÍO», que marca como dirección.
- **Organizaciones:** «Asesoría Soledad y Asociados S.L.P.», y «Clínica Dental Dr. Ibáñez», que marca como persona.
- **En MEDDOCAN, 60 nombres:** casi todos en el campo «Apellidos: Rico Pedroza.» de la cabecera de cada historia.

**Marcan de más:**
- **Producción** (nuevo):
  - **Personas (129):** «ARRENDADOR» y «ARRENDATARIA» repetidos, alias de foro («dieselero_77», «lolaB_1979»), «mi suegro», «abuela».
  - **Organizaciones (68):** «EUROPA PRESS», «Diputación», «DIRECCIÓN GENERAL DE TRÁFICO».
- **Producción** (MEDDOCAN): «paciente» como persona, 135 veces sin contar «la paciente» y «el paciente».
- **GLiNER2** (nuevo):
  - **Personas (96) y organizaciones (82):** las mismas palabras, más «Mercedes-Benz», «Movistar», «SEAT LEÓN 1.5 TSI» y «luz».
  - **Direcciones (65):** trozos de dirección y poblaciones sueltas.

## Viabilidad en el navegador (sin portar)

| | Actual | GLiNER2 |
|---|---|---|
| Archivos | 1 grafo + tokenizador | 4 grafos (encoder, span_rep, count_embed, classifier) + tokenizador mDeBERTa |
| Tamaño fp32 | 1157 MB | 1111 MB + 113 MB de cabezas |
| Tamaño fp16 | 580 MB | 556 MB + 113 MB (cabezas en fp32; sin probar en fp16) |
| Tamaño int8 (solo pesos, `tools/quantize.py`) | 357 MB | 340 MB + 113 MB ≈ 453 MB |
| Exportación ONNX fp32 frente a PyTorch | 127/127 entidades, dif. < 0,001 | 218/218 mismas entidades; 206/218 a ±0,01, dif. máx. 0,043 |
| fp16 frente a fp32 (±0,05) | 127/127 | 217/218 con umbral 0,3; 207/208 con 0,6 |
| int8 frente a fp32 (±0,05) | 126/127 | 216/218 con umbral 0,3; 207/208 con 0,6 |
| Carga en ONNX Runtime Web (WebAssembly) | Sí (int8w y fp16) | Sí: los 4 grafos en int8w, fp16 y fp32 |
| 250 palabras, WebAssembly, 4 hilos | int8w 9,7 s; fp16 11,0 s (todo el proceso) | int8w 7,7 s; fp16 10,3 s; fp32 7,0 s (solo encoder + span_rep) |
| Memoria máxima del proceso | int8w 2,0 GB; fp16 2,7 GB | int8w 1,9 GB; fp16 2,6 GB; fp32 4,5 GB |
| Tramo máximo | 12 palabras | 8 palabras: parte las direcciones largas |

Notas:
- **Tiempos de ONNX Runtime Web:** se midieron en Node con el paquete `onnxruntime-web` (WebAssembly), en un servidor ARM de 4 núcleos con carga de 5 a 9 de otros procesos. Solo sirven para comparar entre sí.
- **Tiempos de GLiNER2:** no incluyen su pre y posproceso, que no está portado.
- **PyTorch en CPU:** el actual tardó 26–34 ms por palabra y GLiNER2 19–27 ms, con mucho ruido.
- **Fecha de la exportación:** el ONNX de DanKau se hizo desde la revisión `c153999` del modelo. Las 10 revisiones posteriores del repositorio, por sus títulos, solo tocan la ficha, el banner y la «skill», y las entidades coinciden con PyTorch.

## Qué se ha comprobado y qué no

Comprobado:
- **Las cifras de arriba**, con el código de `tools/compare`.
- **Las salidas** de la exportación ONNX de GLiNER2 y de sus variantes cuantizadas frente a PyTorch.
- **La carga y ejecución de sus grafos en ONNX Runtime Web** (WebAssembly en Node).
- **Las pruebas de paridad del modelo actual con Python:** 127 entidades con diferencia < 0,001.
- **El caso de la revisión de principio a fin** con el modelo int8w.

No comprobado:
- **WebGPU,** para ninguno de los dos modelos.
- **Navegadores reales con GLiNER2:** la prueba fue en Node.
- **Su pre y posproceso en TypeScript,** que no está portado.
- **Las cabezas de GLiNER2 en fp16 o int8.**
- **Las 150 historias restantes del test de MEDDOCAN.**
- **Otros idiomas.**

Las cifras del conjunto nuevo y de MEDDOCAN valen mientras nadie ajuste el detector mirando sus fallos. Si se corrigen los errores de arriba, hará falta otro conjunto congelado para volver a medir.
