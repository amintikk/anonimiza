// Text out of the files people drop: PDF (pdf.js), DOCX (unzip + XML) and plain text.
// Everything runs locally. A PDF also keeps where each character is (see pdf.ts), to write it back anonymised.
import { t } from '../i18n.ts';
import { readPdf, type PdfSource } from './pdf.ts';

export const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.json,.log,.eml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*';
const MAX_BYTES = 50 * 2 ** 20;

export interface Extracted {
  text: string;
  /** For a PDF: the file and where each character is, so the same PDF can be written back anonymised. */
  pdf?: PdfSource;
}

export async function extractFile(file: File): Promise<Extracted> {
  if (file.size > MAX_BYTES) throw new Error(t('El archivo pesa más de 50 MB.'));
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const pdf = await readPdf(new Uint8Array(await file.arrayBuffer()));
    if (!pdf.text.replace(/\s/g, '')) throw new Error(t('El PDF no contiene texto seleccionable (puede ser una imagen escaneada). Esta herramienta no hace OCR.'));
    return { text: pdf.text, pdf };
  }
  if (name.endsWith('.docx')) return { text: tidy(await docxText(file)) };
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

async function docxText(file: File): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(f.name) });
  } catch {
    throw new Error(t('No se pudo abrir el DOCX: el archivo está dañado o no es un documento de Word.'));
  }
  const main = files['word/document.xml'];
  if (!main) throw new Error(t('No se pudo abrir el DOCX: el archivo está dañado o no es un documento de Word.'));
  const parts = [
    ...Object.keys(files).filter((f) => /header/.test(f)).sort(),
    'word/document.xml',
    ...Object.keys(files).filter((f) => /footnotes|endnotes|footer/.test(f)).sort(),
  ];
  return parts.map((p) => wordXmlText(strFromU8(files[p]!))).filter(Boolean).join('\n\n');
}

/** Paragraphs, tabs and line breaks of a WordprocessingML part. */
export function wordXmlText(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const out: string[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    let s = '';
    const walk = (n: Element) => {
      for (const c of Array.from(n.children)) {
        if (c.namespaceURI === W && c.localName === 't') s += c.textContent ?? '';
        else if (c.namespaceURI === W && c.localName === 'tab') s += '\t';
        else if (c.namespaceURI === W && (c.localName === 'br' || c.localName === 'cr')) s += '\n';
        else if (c.namespaceURI === W && c.localName === 'p') continue; // nested paragraphs (text boxes) are visited on their own
        else if (c.namespaceURI === W && (c.localName === 'delText' || c.localName === 'instrText')) continue;
        else walk(c);
      }
    };
    walk(p);
    out.push(s);
  }
  return out.join('\n');
}
