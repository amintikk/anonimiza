// English texts for every t('…') in the app, keyed by the Spanish source text (see src/i18n.ts).
// tests/i18n.test.ts fails if a key is missing or if its placeholders ({n}, {size}…) differ.
export const EN: Record<string, string> = {
  // Kinds of data (main.ts)
  'Personas': 'People',
  'Persona': 'Person',
  'Organizaciones': 'Organisations',
  'Organización': 'Organisation',
  'Direcciones': 'Addresses',
  'Dirección': 'Address',
  'Números de la Seguridad Social': 'Social security numbers',
  'N.º Seguridad Social': 'Social security no.',
  'Tarjetas': 'Cards',
  'Tarjeta': 'Card',
  'Teléfonos': 'Phones',
  'Teléfono': 'Phone',
  'Correos': 'Emails',
  'Correo': 'Email',
  'Direcciones IP': 'IP addresses',
  'Dirección IP': 'IP address',
  'Otros datos': 'Other data',
  'Otro dato': 'Other',

  // Engine and model status (main.ts)
  'WebGPU (tarjeta gráfica)': 'WebGPU (graphics card)',
  'WebAssembly (procesador, {n} hilos)': 'WebAssembly (processor, {n} threads)',
  'Modelo listo': 'Model ready',
  'Preparando…': 'Preparing…',
  'Error del modelo': 'Model error',
  'Solo reglas': 'Rules only',
  'Buscando nombres, direcciones y organizaciones': 'Looking for names, addresses and organisations',
  'Falta el modelo para nombres, direcciones y organizaciones': 'The model is needed for names, addresses and organisations',
  'Ya se han buscado los datos con formato fijo (DNI, IBAN, teléfonos…). Para el resto hace falta descargar una vez el modelo GLiNER ({size}); se guarda en este navegador.':
    'Data with a fixed format (DNI, IBAN, phone numbers…) has already been looked for. For the rest, the GLiNER model ({size}) must be downloaded once; it is stored in this browser.',
  'Descargar modelo': 'Download model',
  'Descargando el modelo': 'Downloading the model',
  'Solo esta vez: después se carga desde el navegador.': 'Only this time: afterwards it loads from the browser.',
  'Preparando el modelo': 'Preparing the model',
  'No se pudo cargar el modelo': 'The model could not be loaded',
  'Reintentar': 'Try again',
  'Cargado': 'Loaded',
  'Descargando': 'Downloading',
  'Preparando': 'Preparing',
  'Error': 'Error',
  'No descargado': 'Not downloaded',

  // Engine popover (main.ts)
  'Sensibilidad': 'Sensitivity',
  'Alta': 'High',
  'Media': 'Medium',
  'Baja': 'Low',
  'Modelo': 'Model',
  'Motor': 'Engine',
  'Variante': 'Variant',
  'int8 (pesos)': 'int8 (weights)',
  'Estado': 'Status',
  'Último análisis': 'Last analysis',
  'Sensibilidad del modelo': 'Model sensitivity',
  'Alta encuentra más nombres y direcciones a cambio de algún falso positivo. Las cifras publicadas se midieron con «Alta».':
    'High finds more names and addresses, at the cost of some false positives. The published figures were measured with “High”.',
  'Tu texto no sale de este navegador. La web solo puede conectarse a sí misma y al dominio de los modelos, y lo impone la política de seguridad de la página.':
    'Your text does not leave this browser. The site can only connect to itself and to the models domain, and the page’s security policy enforces this.',
  'Cargar modelo ({size})': 'Load model ({size})',
  'Modelo borrado de este navegador.': 'Model deleted from this browser.',
  'Borrar modelo descargado': 'Delete downloaded model',

  // Input, review and side list (main.ts)
  '{n} palabras': '{n} words',
  'El archivo no contiene texto.': 'The file contains no text.',
  'Revisión': 'Review',
  'Texto original': 'Original text',
  'clic para no sustituir': 'click to leave it unchanged',
  'clic para sustituir': 'click to replace',
  'Datos detectados': 'Detected data',
  'No se ha detectado nada': 'Nothing detected',
  '{v} valores · {o} de {n} apariciones se sustituirán': '{v} values · {o} of {n} occurrences will be replaced',
  'Aún falta el análisis con el modelo.': 'The analysis with the model is still pending.',
  'Selecciona en el texto lo que quieras sustituir.': 'Select in the text what you want to replace.',
  'Sustituir «{v}»': 'Replace “{v}”',
  'Ver en el texto': 'Show in the text',
  'Sustituir como': 'Replace as',
  'Añadido como {k}. Se sustituye en todas sus apariciones.': 'Added as {k}. It will be replaced in every occurrence.',

  // Output and restore (main.ts; the file-name parts are used in downloads)
  'texto': 'text',
  'anonimizado': 'anonymised',
  'restaurado': 'restored',
  'Copiado. Revísalo antes de compartirlo.': 'Copied. Check it before sharing it.',
  'No se pudo copiar. Usa «Descargar».': 'Could not copy. Use “Download”.',
  'Primero anonimiza un texto en esta misma pestaña. La tabla de sustituciones solo existe en la memoria de esta página: si la recargas o la cierras, desaparece.':
    'First anonymise a text in this same tab. The replacement table exists only in this page’s memory: if you reload or close it, it disappears.',
  'Pega a la izquierda la respuesta de la IA. Los marcadores que conozca esta pestaña ({n}) se cambiarán por los datos originales.':
    'Paste the AI reply on the left. The markers this tab knows ({n}) will be swapped for the original data.',
  '{n} marcadores restaurados': '{n} markers restored',
  'desconocidos: {m}': 'unknown: {m}',
  'no hay ninguna tabla de sustituciones en esta pestaña': 'there is no replacement table in this tab',
  'Copiado.': 'Copied.',
  'El navegador no deja leer el portapapeles: pega con Ctrl+V.': 'The browser does not let the page read the clipboard: paste with Ctrl+V.',

  // Reading files (docs/extract.ts)
  'El archivo pesa más de 50 MB.': 'The file is larger than 50 MB.',
  'Formato no admitido. Guarda el documento como DOCX o PDF, o pega el texto.': 'Unsupported format. Save the document as DOCX or PDF, or paste the text.',
  'El PDF no contiene texto seleccionable (puede ser una imagen escaneada). Esta herramienta no hace OCR.':
    'The PDF contains no selectable text (it may be a scanned image). This tool does not do OCR.',
  'No se pudo abrir el DOCX: el archivo está dañado o no es un documento de Word.': 'The DOCX could not be opened: the file is damaged or is not a Word document.',

  // Engine and model store (engine/client.ts, engine/store.ts, engine/worker.ts)
  'No se pudo iniciar el motor de inferencia': 'The inference engine could not be started',
  'El motor de inferencia se detuvo': 'The inference engine stopped',
  'Motor reiniciado': 'Engine restarted',
  'Motor no iniciado': 'Engine not started',
  'No se pudo descargar {f} ({s})': 'Could not download {f} ({s})',
  'tamaño inesperado': 'unexpected size',
  'descarga incompleta ({a}/{b} bytes)': 'incomplete download ({a}/{b} bytes)',
  'la huella SHA-256 no coincide': 'the SHA-256 fingerprint does not match',
  'Error desconocido': 'Unknown error',

  // Demo on the home page (site/site.ts)
  'Anonimizado': 'Anonymised',
  'Original': 'Original',
  'El navegador no ha dejado guardar el modelo (falta espacio o es una ventana privada): se volverá a descargar la próxima vez.': 'The browser did not let the model be stored (not enough space, or a private window): it will be downloaded again next time.',
  'La tarjeta gráfica ha fallado; se usa el procesador.': 'The graphics card failed; using the processor instead.',
};
