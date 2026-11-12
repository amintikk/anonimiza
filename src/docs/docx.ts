// DOCX in, DOCX out. Reading keeps which <w:t> each character of the text comes from; writing changes those
// texts in place, so the document keeps its formatting, tables and images and stays editable. A DOCX also keeps
// personal data where nobody reads it, and that is cleaned too: the author of the file and of every comment and
// tracked change, deleted text kept by track changes, the thumbnail of the first page, and links or image
// descriptions that repeat a detected value.
import { tidyIndices } from './tidy.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const TEXT_PART = /^word\/(document|footnotes|endnotes|header\d*|footer\d*|comments)\.xml$/;

export interface DocxSource {
  bytes: Uint8Array;
  text: string;
  parts: string[]; // text parts in reading order
  /** Per character: part index, <w:t> index in that part and offset in its (NFC) text; -1 for tabs and breaks. */
  part: Int32Array;
  node: Int32Array;
  offset: Int32Array;
}

export class DocxError extends Error {}

async function unzip(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  const { unzipSync } = await import('fflate');
  try {
    return unzipSync(bytes);
  } catch {
    throw new DocxError('zip');
  }
}

function textParts(files: Record<string, Uint8Array>): string[] {
  const names = Object.keys(files).filter((f) => TEXT_PART.test(f));
  return [
    ...names.filter((f) => /header/.test(f)).sort(),
    ...names.filter((f) => f === 'word/document.xml'),
    ...names.filter((f) => /footnotes|endnotes|footer/.test(f)).sort(),
    ...names.filter((f) => /comments/.test(f)),
  ];
}

type Piece = { s: string; t: Element | null };

/** Paragraphs of a WordprocessingML part as pieces of text: <w:t> elements, tabs and line breaks. */
function paragraphs(doc: Document): Piece[][] {
  const out: Piece[][] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    const pieces: Piece[] = [];
    const walk = (n: Element) => {
      for (const c of Array.from(n.children)) {
        if (c.namespaceURI === W && c.localName === 't') pieces.push({ s: (c.textContent ?? '').normalize('NFC'), t: c });
        else if (c.namespaceURI === W && c.localName === 'tab') pieces.push({ s: '\t', t: null });
        else if (c.namespaceURI === W && (c.localName === 'br' || c.localName === 'cr')) pieces.push({ s: '\n', t: null });
        else if (c.namespaceURI === W && c.localName === 'p') continue; // nested paragraphs (text boxes) are visited on their own
        else if (c.namespaceURI === W && (c.localName === 'delText' || c.localName === 'instrText' || c.localName === 'del' || c.localName === 'moveFrom')) continue;
        else walk(c);
      }
    };
    walk(p);
    out.push(pieces);
  }
  return out;
}

const parse = (xml: Uint8Array) => new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
const textNodes = (doc: Document) => paragraphs(doc).flat().filter((x) => x.t).map((x) => x.t!);

/** Plain text of a WordprocessingML part (paragraphs, tabs and line breaks). */
export function wordXmlText(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return paragraphs(doc).map((p) => p.map((x) => x.s).join('')).join('\n');
}

export async function readDocx(bytes: Uint8Array): Promise<DocxSource> {
  const files = await unzip(bytes);
  if (!files['word/document.xml']) throw new DocxError('no document');
  const parts = textParts(files);
  const chars: string[] = [], partOf: number[] = [], nodeOf: number[] = [], offOf: number[] = [];
  const push = (c: string, p: number, n: number, o: number) => (chars.push(c), partOf.push(p), nodeOf.push(n), offOf.push(o));
  let first = true;
  parts.forEach((name, pi) => {
    const paras = paragraphs(parse(files[name]!));
    if (!paras.some((p) => p.some((x) => x.s))) return; // a part without text adds nothing, not even a separator
    if (!first) (push('\n', -1, -1, -1), push('\n', -1, -1, -1));
    first = false;
    let ti = 0;
    paras.forEach((p, k) => {
      if (k) push('\n', -1, -1, -1);
      for (const x of p) {
        if (!x.t) {
          push(x.s, -1, -1, -1);
          continue;
        }
        for (let i = 0; i < x.s.length; i++) {
          const c = x.s[i]!;
          if (c !== '\r') push(c === '\u0085' ? '\n' : c, pi, ti, i);
        }
        ti++;
      }
    });
  });
  const kept = tidyIndices(chars);
  return {
    bytes,
    text: kept.map((i) => chars[i]!).join(''),
    parts,
    part: Int32Array.from(kept, (i) => partOf[i]!),
    node: Int32Array.from(kept, (i) => nodeOf[i]!),
    offset: Int32Array.from(kept, (i) => offOf[i]!),
  };
}

export interface Cover {
  start: number;
  end: number;
  label: string;
}

interface Edit {
  from: number;
  to: number;
  label: string;
}

const serialize = (doc: Document) => {
  const s = new XMLSerializer().serializeToString(doc);
  return new TextEncoder().encode(s.startsWith('<?xml') ? s : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${s}`);
};

/** A copy of the DOCX with every cover's text replaced by its label, and the hidden personal data removed. */
export async function writeDocx(src: DocxSource, covers: Cover[]): Promise<Uint8Array<ArrayBuffer>> {
  const { zipSync } = await import('fflate');
  const files = await unzip(src.bytes);

  // Edits per part and <w:t>: the label goes where the value starts, the rest of the value is removed.
  const edits = new Map<number, Map<number, Edit[]>>();
  for (const c of covers) {
    let labelled = false;
    let cur: Edit | null = null;
    let curKey = '';
    for (let i = c.start; i < c.end; i++) {
      const p = src.part[i]!, n = src.node[i]!, o = src.offset[i]!;
      if (p < 0) continue;
      const key = `${p}:${n}`;
      if (cur && key === curKey && o === cur.to) {
        cur.to = o + 1;
        continue;
      }
      cur = { from: o, to: o + 1, label: labelled ? '' : c.label };
      curKey = key;
      labelled = true;
      if (!edits.has(p)) edits.set(p, new Map());
      const byNode = edits.get(p)!;
      if (!byNode.has(n)) byNode.set(n, []);
      byNode.get(n)!.push(cur);
    }
  }

  // Detected values, longest first, to clean them where the text is not shown (links, field codes, alt text).
  const values = [...new Map(covers.map((c) => [src.text.slice(c.start, c.end), c.label] as const)).entries()]
    .filter(([v]) => v.replace(/\s/g, '').length >= 4)
    .sort((a, b) => b[0].length - a[0].length);
  const scrub = (s: string) => {
    let out = s;
    for (const [v, label] of values) {
      out = out.split(v).join(label);
      const enc = encodeURIComponent(v);
      if (enc !== v) out = out.split(enc).join(encodeURIComponent(label));
      if (/\s/.test(v)) out = out.split(v.replace(/\s+/g, '')).join(label);
    }
    return out;
  };

  for (const name of Object.keys(files)) {
    const isWord = /^word\/[^/]+\.xml$/.test(name);
    const isRels = name.endsWith('.rels');
    const isProps = /^docProps\/(core|app|custom)\.xml$/.test(name);
    if (!isWord && !isRels && !isProps) continue;
    const doc = parse(files[name]!);
    if (doc.getElementsByTagName('parsererror').length) continue;
    let changed = false;

    const pi = src.parts.indexOf(name);
    const byNode = pi >= 0 ? edits.get(pi) : undefined;
    if (byNode) {
      const nodes = textNodes(doc);
      for (const [n, list] of byNode) {
        const t = nodes[n];
        if (!t) continue;
        let s = (t.textContent ?? '').normalize('NFC');
        for (const e of [...list].sort((a, b) => b.from - a.from)) s = s.slice(0, e.from) + e.label + s.slice(e.to);
        t.textContent = s;
        t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
      }
      changed = true;
    }

    if (isWord) {
      const all = Array.from(doc.getElementsByTagName('*'));
      for (const el of all) {
        // Track changes: keep the document as it reads now. Deleted and moved-away text goes; insertions stay.
        if (el.namespaceURI === W && (el.localName === 'del' || el.localName === 'moveFrom') && el.parentNode) {
          el.parentNode.removeChild(el);
          changed = true;
          continue;
        }
        // Who wrote each comment, insertion or deletion.
        for (const a of Array.from(el.attributes)) {
          if (/^(author|initials|userId|providerId)$/.test(a.localName) && a.value) {
            a.value = '';
            changed = true;
          }
        }
        // Field codes (HYPERLINK "mailto:…") and image descriptions repeat what the text says.
        if (el.namespaceURI === W && el.localName === 'instrText') {
          const s = scrub(el.textContent ?? '');
          if (s !== el.textContent) (el.textContent = s), (changed = true);
        }
        if (el.localName === 'docPr' || el.localName === 'cNvPr') {
          for (const attr of ['descr', 'title', 'name']) {
            const v = el.getAttribute(attr);
            if (v && scrub(v) !== v) (el.setAttribute(attr, scrub(v)), (changed = true));
          }
        }
      }
    }
    if (isRels) {
      for (const r of Array.from(doc.getElementsByTagName('Relationship'))) {
        // The thumbnail is a picture of the first page, with the data in it.
        if (/\/thumbnail$/.test(r.getAttribute('Type') ?? '')) {
          const target = (r.getAttribute('Target') ?? '').replace(/^\//, '');
          // Targets are relative to the folder of the part the .rels file belongs to ("_rels/.rels" → the root).
          delete files[name.replace(/_rels\/[^/]*\.rels$/, '') + target];
          r.parentNode?.removeChild(r);
          changed = true;
          continue;
        }
        const target = r.getAttribute('Target') ?? '';
        if (r.getAttribute('TargetMode') === 'External' && scrub(target) !== target) (r.setAttribute('Target', scrub(target)), (changed = true));
      }
    }
    if (isProps) {
      for (const el of Array.from(doc.getElementsByTagName('*'))) {
        if (el.children.length) continue;
        // The file's author and company are personal data of their own; titles and keywords may repeat a value.
        if (/^(creator|lastModifiedBy|Company|Manager)$/.test(el.localName)) {
          if (el.textContent) (el.textContent = ''), (changed = true);
        } else if (el.textContent && scrub(el.textContent) !== el.textContent) {
          el.textContent = scrub(el.textContent);
          changed = true;
        }
      }
    }
    if (changed) files[name] = serialize(doc);
  }
  return zipSync(files, { level: 6 }) as Uint8Array<ArrayBuffer>;
}
