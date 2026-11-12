// Text out of the files people drop: PDF (pdf.js), DOCX (unzip + XML) and plain text.
// Everything runs locally. A PDF or DOCX also keeps where each character is (pdf.ts, docx.ts), to write it back anonymised.
import { t } from '../i18n.ts';
import { ocrPdf, readPdf, type OcrEvent, type PdfSource } from './pdf.ts';
import { OcrClient } from '../ocr/client.ts';
import { DocxError, readDocx, type DocxSource } from './docx.ts';
export { wordXmlText } from './docx.ts';

export const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.json,.log,.eml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*';
const MAX_BYTES = 50 * 2 ** 20;

export interface Extracted {
  text: string;
  /** For a PDF or DOCX: the file and where each character is, so the same file can be written back anonymised. */
  pdf?: PdfSource;
  docx?: DocxSource;
  /** The text was read with OCR, because the PDF has no text that can be copied. */
  ocr?: boolean;
}

const ocr = new OcrClient();

export async function extractFile(file: File, onOcr?: (e: OcrEvent) => void): Promise<Extracted> {
  if (file.size > MAX_BYTES) throw new Error(t('El archivo pesa más de 50 MB.'));
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await readPdf(bytes);
    if (pdf.text.replace(/\s/g, '')) return { text: pdf.text, pdf };
    // Scanned or re-printed as images: nothing can be copied, so the pages are read with OCR.
    const read = await ocrPdf(bytes, ocr, onOcr);
    if (!read.text.replace(/\s/g, '')) throw new Error(t('El OCR no encontró texto en este PDF.'));
    return { text: read.text, pdf: read, ocr: true };
  }
  if (name.endsWith('.docx')) {
    try {
      const docx = await readDocx(new Uint8Array(await file.arrayBuffer()));
      return { text: docx.text, docx };
    } catch (e) {
      if (e instanceof DocxError) throw new Error(t('No se pudo abrir el DOCX: el archivo está dañado o no es un documento de Word.'));
      throw e;
    }
  }
  if (name.endsWith('.doc') || name.endsWith('.odt') || name.endsWith('.rtf') || name.endsWith('.pages'))
    throw new Error(t('Formato no admitido. Guarda el documento como DOCX o PDF, o pega el texto.'));
  return { text: tidy(await file.text()) };
}

function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\u0085/g, '\n')
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .normalize('NFC')
    .trim();
}
