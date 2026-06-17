/*
 * Generic pdf-service format-config -> sample DOCX generator.
 *
 * For a given template it:
 *   1. Auto-discovers every Mustache placeholder/section.
 *   2. Builds dummy data where each placeholder value is "<placeholderName>".
 *   3. Renders the template (Mustache) the same way pdf-service does.
 *   4. Converts the resulting pdfmake docDefinition into a Word document.
 *
 * Usage: node template-to-docx.js <template-key> [<template-key> ...]
 */
const fs = require('fs');
const path = require('path');
const Mustache = require('mustache');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, PageBreak, TableLayoutType, HeadingLevel
} = require('docx');

const FORMAT_DIR = path.resolve(__dirname, '../pdf-service/format-config');
const OUT_DIR = path.resolve(__dirname, '../sample_docx');
const FONT = 'Roboto';
// Printable width of a default (Letter, 1" margins) docx page, in twips.
// Tables MUST carry absolute column widths + fixed layout, otherwise Google
// Docs collapses percentage-width columns to one character per line.
const TOTAL_DXA = 9360;

Mustache.escape = (t) => t; // keep < > literal, do not HTML-escape

// ---------- helpers ----------
const COLOR_NAMES = { black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF' };
function cleanColor(c) {
  if (!c) return undefined;
  const v = String(c).replace('#', '').toLowerCase();
  if (COLOR_NAMES[v]) return COLOR_NAMES[v];
  return /^[0-9a-f]{6}$/.test(v) ? v : undefined; // ignore malformed (e.g. "#black")
}
function align(a) {
  switch (a) {
    case 'center': return AlignmentType.CENTER;
    case 'right': return AlignmentType.RIGHT;
    case 'justify': return AlignmentType.JUSTIFIED;
    case 'left': return AlignmentType.LEFT;
    default: return undefined;
  }
}
const pt = (v) => Math.round((v || 0) * 20); // pt -> twips
function spacing(margin) {
  if (!Array.isArray(margin)) return { after: 80 };
  return { before: Math.max(0, pt(margin[1])), after: Math.max(0, pt(margin[3])) };
}
function indent(margin) {
  if (!Array.isArray(margin)) return undefined;
  const left = Math.max(0, pt(margin[0]));
  return left > 0 ? { left } : undefined;
}

// ---------- data auto-generation ----------
function buildDummyData(rawString) {
  const data = {};
  const sectionNames = new Set();

  // Names used as plain value placeholders {{name}} (not #/^// tags). A section
  // sharing such a name is a conditional/value wrapper (e.g. {{#caseNumber}} +
  // {{caseNumber}}), NOT a repeatable list, so it must stay a scalar.
  const valueNames = new Set();
  const valueRe = /\{\{(?![#^/!])\{?\s*([\w.]+)\s*\}?\}\}/g;
  let vm;
  while ((vm = valueRe.exec(rawString)) !== null) valueNames.add(vm[1].trim());

  // 1) Sections {{#name}}...{{/name}}: if the body has inner value placeholders,
  //    represent the section as a one-element array carrying those fields, so the
  //    repeated rows render real "<field>" values (parties, attendees, etc.).
  const sectionRe = /\{\{#\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\s*\1\s*\}\}/g;
  let sm;
  while ((sm = sectionRe.exec(rawString)) !== null) {
    const name = sm[1].trim();
    if (valueNames.has(name)) continue; // conditional/value section -> keep scalar
    const inner = {};
    let dotItem = false;
    const innerRe = /\{\{\{?\s*([\w.]+)\s*\}?\}\}/g;
    let im;
    while ((im = innerRe.exec(sm[2])) !== null) {
      const f = im[1].trim();
      if (f === '.') { dotItem = true; continue; } // {{.}} -> section iterates scalar items
      if (f === 'index') continue; // row counter supplied by the data-config function
      inner[f] = '<' + f + '>'; // include {{name}} self-refs so {{#x}}{{x}}{{/x}} resolves
    }
    if (dotItem) {
      data[name] = ['<' + name + '>']; // one scalar element so {{.}} renders a value
      sectionNames.add(name);
    } else if (Object.keys(inner).length) {
      if (Array.isArray(data[name])) Object.assign(data[name][0], inner);
      else data[name] = [Object.assign({ index: 1 }, inner)];
      sectionNames.add(name);
    }
  }

  // 2) Everything else: a truthy "<name>" so plain sections render once and
  //    values show their placeholder name.
  const re = /\{\{[#^/&]?\{?\s*([^{}]+?)\s*\}?\}\}/g;
  let m;
  while ((m = re.exec(rawString)) !== null) {
    let name = m[1].trim();
    if (!name || name.startsWith('/') || name.startsWith('!')) continue;
    name = name.replace(/^[#^&{]+/, '').trim();
    if (!name || sectionNames.has(name)) continue;
    if (!(name in data)) data[name] = '<' + name + '>';
  }
  return data;
}

// ---------- style resolution ----------
let STYLES = {};
function styleByName(name) {
  if (!name) return {};
  const names = Array.isArray(name) ? name : [name];
  const out = {};
  names.forEach((n) => Object.assign(out, STYLES[n] || {}));
  return out;
}
const INLINE_KEYS = ['fontSize', 'bold', 'italics', 'alignment', 'color', 'margin', 'decoration'];
function mergeStyle(node, inherited) {
  const s = Object.assign({}, inherited || {});
  Object.assign(s, styleByName(node && node.style));
  if (node) INLINE_KEYS.forEach((k) => { if (node[k] !== undefined) s[k] = node[k]; });
  return s;
}

function makeRun(text, style) {
  return new TextRun({
    text: String(text == null ? '' : text),
    bold: !!style.bold,
    italics: !!style.italics,
    size: Math.round((style.fontSize || 11) * 2),
    font: FONT,
    color: cleanColor(style.color),
    underline: style.decoration === 'underline' ? {} : undefined
  });
}

// Build TextRun[] from a text value (string | array of string|run)
function buildRuns(textVal, baseStyle) {
  const runs = [];
  if (typeof textVal === 'string') {
    runs.push(makeRun(textVal, baseStyle));
  } else if (Array.isArray(textVal)) {
    textVal.forEach((part) => {
      if (part === '' || part == null) return; // section artifact
      if (typeof part === 'string') { runs.push(makeRun(part, baseStyle)); return; }
      const st = mergeStyle(part, baseStyle);
      if (Array.isArray(part.text)) { buildRuns(part.text, st).forEach((r) => runs.push(r)); }
      else runs.push(makeRun(part.text, st));
    });
  }
  if (!runs.length) runs.push(makeRun('', baseStyle));
  return runs;
}

// ---------- table helpers ----------
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };
const thin = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
function cellBorders(cell) {
  if (cell && Array.isArray(cell.border)) {
    const [l, t, r, b] = cell.border;
    return { left: l ? thin : noBorder, top: t ? thin : noBorder, right: r ? thin : noBorder, bottom: b ? thin : noBorder };
  }
  return { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
}
function widthNum(w, ncols) {
  if (w === '*' || w == null) return 100 / ncols;
  if (typeof w === 'string' && w.endsWith('%')) return parseFloat(w);
  return 100 / ncols;
}

// ---------- node -> docx element[] ----------
function processNode(node, inherited) {
  if (node == null || node === '') return [];
  if (typeof node === 'string') {
    return [new Paragraph({ children: [makeRun(node, inherited || {})] })];
  }
  const style = mergeStyle(node, inherited);
  const lead = (node.pageBreak === 'before')
    ? [new Paragraph({ children: [new PageBreak()] })] : [];
  const trail = (node.pageBreak === 'after')
    ? [new Paragraph({ children: [new PageBreak()] })] : [];

  let out = [];
  if (node.text !== undefined) {
    out = [new Paragraph({ alignment: align(style.alignment), spacing: spacing(style.margin), indent: indent(style.margin), children: buildRuns(node.text, style) })];
  } else if (node.stack !== undefined) {
    if (typeof node.stack === 'string') {
      out = [new Paragraph({ alignment: align(style.alignment), spacing: spacing(style.margin), children: [makeRun(node.stack, style)] })];
    } else {
      node.stack.forEach((c) => { out = out.concat(processNode(c, style)); });
    }
  } else if (node.columns !== undefined) {
    out = [columnsToTable(node.columns, style)];
  } else if (node.ul !== undefined) {
    out = listParagraphs(node.ul, style, false);
  } else if (node.ol !== undefined) {
    out = listParagraphs(node.ol, style, true);
  } else if (node.table !== undefined) {
    const widths = node.table.widths || [];
    const rowsArr = node.table.body.filter((r) => Array.isArray(r));
    const ncols = widths.length || (rowsArr[0] ? rowsArr[0].length : 1);
    if (ncols <= 1) {
      // Single-column tables are pure layout containers -> flatten to block flow.
      rowsArr.forEach((row) => row.forEach((cell) => {
        out = out.concat(processNode(cell, mergeStyle(cell || {}, style)));
      }));
    } else {
      out = [tableToDocx(node, style)];
    }
  } else if (node.image !== undefined) {
    // Logos / emblems / QR codes are runtime images; show a visible placeholder.
    // Guard against a hardcoded base64 blob ever landing here.
    const ref = /^\s*<[\w.]+>\s*$/.test(String(node.image)) ? node.image : 'image';
    out = [new Paragraph({ alignment: align(style.alignment), spacing: spacing(style.margin), children: [makeRun('[image: ' + ref + ']', style)] })];
  }
  return lead.concat(out, trail);
}

function listParagraphs(items, style, ordered) {
  const out = [];
  let n = 1;
  items.forEach((it) => {
    if (it === '' || it == null) return;
    let runs;
    if (typeof it === 'string') runs = [makeRun(it, style)];
    else runs = buildRuns(it.text !== undefined ? it.text : '', mergeStyle(it, style));
    if (ordered) {
      out.push(new Paragraph({ indent: { left: 540 }, spacing: spacing(style.margin), children: [makeRun((n++) + '. ', style)].concat(runs) }));
    } else {
      out.push(new Paragraph({ bullet: { level: 0 }, spacing: spacing(style.margin), children: runs }));
    }
  });
  return out;
}

function columnsToTable(cols, style) {
  const valid = cols.filter((c) => c !== '' && c != null);
  const n = valid.length || 1;
  const colDxa = Array.from({ length: n }, () => Math.round(TOTAL_DXA / n));
  const cells = valid.map((c, i) => {
    const content = processNode(c, style);
    return new TableCell({
      width: { size: colDxa[i], type: WidthType.DXA },
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
      margins: { top: 20, bottom: 20, left: 40, right: 40 },
      children: content.length ? content : [new Paragraph({ children: [makeRun('', style)] })]
    });
  });
  return new Table({
    width: { size: TOTAL_DXA, type: WidthType.DXA },
    columnWidths: colDxa,
    layout: TableLayoutType.FIXED,
    borders: noBorders,
    rows: [new TableRow({ children: cells })]
  });
}

function tableToDocx(node, style) {
  const widths = node.table.widths || [];
  const body = node.table.body.filter((r) => Array.isArray(r));
  const ncols = widths.length || (body[0] ? body[0].length : 1);
  // Resolve each column to an absolute twip width (normalised to the page).
  const colPct = [];
  for (let i = 0; i < ncols; i++) colPct.push(widthNum(widths[i], ncols));
  const sumPct = colPct.reduce((a, b) => a + b, 0) || 100;
  const colDxa = colPct.map((p) => Math.round(TOTAL_DXA * p / sumPct));
  const rows = [];
  body.forEach((row) => {
    const cells = [];
    let skip = 0;
    let ci = 0;
    row.forEach((cell) => {
      if (skip > 0) { skip--; return; }
      const span = (cell && cell.colSpan) || 1;
      if (span > 1) skip = span - 1;
      const cs = mergeStyle(cell || {}, style);
      let w = 0;
      for (let k = 0; k < span; k++) w += colDxa[ci + k] || 0;
      const content = processNode(cell, cs);
      cells.push(new TableCell({
        columnSpan: span > 1 ? span : undefined,
        width: { size: w || colDxa[ci] || Math.round(TOTAL_DXA / ncols), type: WidthType.DXA },
        borders: cellBorders(cell),
        margins: { top: 40, bottom: 40, left: 60, right: 60 },
        children: content.length ? content : [new Paragraph({ children: [makeRun('', cs)] })]
      }));
      ci += span;
    });
    if (cells.length) rows.push(new TableRow({ children: cells }));
  });
  return new Table({
    width: { size: TOTAL_DXA, type: WidthType.DXA },
    columnWidths: colDxa,
    layout: TableLayoutType.FIXED,
    borders: noBorders,
    rows
  });
}

// ---------- main ----------
// Build the docx body elements for a single template key.
function buildChildren(key) {
  const file = path.join(FORMAT_DIR, key + '.json');
  const raw = fs.readFileSync(file, 'utf8');
  const data = buildDummyData(raw);
  const cfg = JSON.parse(raw).config;
  const rendered = Mustache.render(JSON.stringify(cfg), data);
  const doc = JSON.parse(rendered);
  STYLES = doc.styles || {}; // module-level, consumed by processNode for this key

  let children = [];
  (doc.content || []).forEach((node) => { children = children.concat(processNode(node, {})); });
  if (!children.length) children = [new Paragraph({ text: '' })];
  return children;
}

function titleFor(key) {
  return key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function writeDoc(children, outName) {
  const document = new Document({ sections: [{ properties: {}, children }] });
  return Packer.toBuffer(document).then((buf) => {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const out = path.join(OUT_DIR, outName);
    fs.writeFileSync(out, buf);
    console.log('  wrote ' + path.relative(process.cwd(), out));
  });
}

function generate(key) {
  return writeDoc(buildChildren(key), key + '-sample.docx');
}

// Combine many templates into one document. Each template is preceded by a
// full divider page that shows only the template title (centred), then the
// template content begins on the next page.
function generateCombined(outName, keys) {
  let children = [];
  const failed = [];
  keys.forEach((key, i) => {
    // Divider page: title pushed toward the vertical middle of the page.
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1, // also lands in the Docs outline
      pageBreakBefore: i > 0,
      alignment: AlignmentType.CENTER,
      spacing: { before: 3600, after: 160 }, // ~2.5in down the page (twips)
      children: [new TextRun({ text: titleFor(key), bold: true, size: 44, font: FONT })]
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: key, italics: true, size: 22, color: '666666', font: FONT })]
    }));
    // Content starts on a fresh page after the divider.
    children.push(new Paragraph({ children: [new PageBreak()] }));
    try {
      children = children.concat(buildChildren(key));
      console.log('  + ' + key);
    } catch (e) {
      failed.push(key);
      console.log('  ! ' + key + ' -> ' + e.message);
      children.push(new Paragraph({ children: [new TextRun({ text: '[could not render this template: ' + e.message + ']', italics: true, color: 'CC0000', font: FONT })] }));
    }
  });
  if (failed.length) console.log('  (' + failed.length + ' failed: ' + failed.join(', ') + ')');
  return writeDoc(children, outName);
}

(async () => {
  const args = process.argv.slice(2);
  if (args[0] === '--combined') {
    const outName = args[1];
    const keys = args.slice(2);
    if (!outName || !keys.length) { console.error('usage: node template-to-docx.js --combined <out.docx> <key> [<key> ...]'); process.exit(1); }
    console.log('Generating combined ' + outName + ' ...');
    await generateCombined(outName, keys);
    console.log('Done.');
    return;
  }
  if (!args.length) { console.error('usage: node template-to-docx.js <key> [<key> ...]  |  --combined <out.docx> <key> ...'); process.exit(1); }
  for (const k of args) {
    console.log('Generating ' + k + ' ...');
    await generate(k);
  }
  console.log('Done.');
})();
