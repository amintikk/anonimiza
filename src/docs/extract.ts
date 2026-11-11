// Text out of the files people drop: PDF (pdf.js), DOCX (unzip + XML) and plain text.
// Everything runs locally; formatting, images and tables are not kept, only the text.
import { t } from '../i18n.ts';

export const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.json,.log,.eml,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*';
const MAX_BYTES = 50 * 2 ** 20;

export async function extractText(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error(t('El archivo pesa más de 50 MB.'));
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return tidy(await pdfText(file));
  if (name.endsWith('.docx')) return tidy(await docxText(file));
  if (name.endsWith('.doc') || name.endsWith('.odt') || name.endsWith('.rtf') || name.endsWith('.pages'))
    throw new Error(t('Formato no admitido. Guarda el documento como DOCX o PDF, o pega el texto.'));
  return tidy(await file.text());
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

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    useSystemFonts: false,
  });
  const doc = await task.promise;
  const pages: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let line = '';
      let out = '';
      let lastY: number | null = null;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5] as number;
        // A jump in the baseline without an explicit end of line still starts a new line.
        if (lastY !== null && Math.abs(y - lastY) > 2 && line && !line.endsWith('\n')) {
          out += line.trimEnd() + '\n';
          line = '';
        }
        line += item.str;
        if (item.hasEOL) {
          out += line.trimEnd() + '\n';
          line = '';
        }
        lastY = y;
      }
      pages.push((out + line).trim());
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  const text = pages.join('\n\n');
  if (!text.replace(/\s/g, '')) throw new Error(t('El PDF no contiene texto seleccionable (puede ser una imagen escaneada). Esta herramienta no hace OCR.'));
  return text;
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
