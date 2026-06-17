/*
 * docx-generate.js
 * ----------------
 * Renders a sample Word (.docx) for every prod PDF template, translating the
 * pdfmake document definition (with dummy data) into Word content, then emits
 * a single combined templates.docx for the developer hand-off document
 * (imports cleanly into Google Docs).
 *
 * Usage:
 *   node docx-generate.js              # combined templates.docx + per-template files
 *   node docx-generate.js --only=order-generic
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, PageBreak,
  Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType,
  HeadingLevel, ShadingType, UnderlineType,
} = require('docx');
const { renderDocDef, listTemplates, PLACEHOLDER_PNG } = require('./lib');

const OUT_DIR = path.join(__dirname, 'output-docx');
const COMBINED = path.join(__dirname, 'templates.docx');

const CONTENT_WIDTH = 9026; // A4 content width in twips (210mm - 2x25.4mm margins)
const DEFAULT_FONT_SIZE = 12;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const NAMED_COLORS = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF',
  gray: '808080', grey: '808080', yellow: 'FFFF00', orange: 'FFA500',
};
function color(c) {
  if (!c || typeof c !== 'string') return undefined;
  if (c[0] === '#') return c.slice(1).toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(c)) return c.toUpperCase();
  return NAMED_COLORS[c.toLowerCase()];
}
function normMargin(m) {
  if (m == null) return null;
  if (typeof m === 'number') return [m, m, m, m];
  if (Array.isArray(m)) {
    if (m.length === 2) return [m[0], m[1], m[0], m[1]];
    if (m.length === 4) return m;
  }
  return null;
}
const pt = (v) => Math.round((v || 0) * 20); // pt -> twips
function align(a) {
  switch (a) {
    case 'center': return AlignmentType.CENTER;
    case 'right': return AlignmentType.RIGHT;
    case 'justify': return AlignmentType.JUSTIFIED;
    case 'left': return AlignmentType.LEFT;
    default: return undefined;
  }
}

// Merge named styles + inline props into a flat style object, inheriting parent.
function resolve(node, styles, inherited) {
  const out = Object.assign({}, inherited);
  if (node && typeof node === 'object') {
    let names = node.style;
    if (typeof names === 'string') names = [names];
    if (Array.isArray(names)) {
      for (const nm of names) if (styles[nm]) applyProps(out, styles[nm]);
    }
    applyProps(out, node); // inline overrides
  }
  return out;
}
function applyProps(out, src) {
  for (const k of ['fontSize', 'bold', 'italics', 'alignment', 'color', 'decoration', 'font']) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  if (src.margin !== undefined) out.margin = src.margin;
}

function makeRun(text, p) {
  const opt = { text: String(text) };
  if (p.bold) opt.bold = true;
  if (p.italics) opt.italics = true;
  opt.size = Math.round((p.fontSize || DEFAULT_FONT_SIZE) * 2); // half-points
  const col = color(p.color);
  if (col) opt.color = col;
  if (p.decoration === 'underline') opt.underline = { type: UnderlineType.SINGLE };
  if (p.decoration === 'lineThrough') opt.strike = true;
  return new TextRun(opt);
}

// inline text value -> TextRun[]
function inlineRuns(value, styles, inh) {
  if (value == null) return [];
  if (typeof value === 'string' || typeof value === 'number') return [makeRun(value, inh)];
  if (Array.isArray(value)) return value.flatMap((v) => inlineRuns(v, styles, inh));
  if (typeof value === 'object') {
    const p = resolve(value, styles, inh);
    if (value.text !== undefined) return inlineRuns(value.text, styles, p);
    return [];
  }
  return [];
}

function paragraph(runs, p, extra) {
  const m = normMargin(p.margin);
  const opt = Object.assign({
    children: runs.length ? runs : [new TextRun('')],
    alignment: align(p.alignment),
  }, extra);
  if (m) {
    opt.spacing = { before: pt(m[1]), after: pt(m[3]) };
    if (m[0]) opt.indent = { left: pt(m[0]) };
  }
  return new Paragraph(opt);
}

function parseImage(value) {
  let buf = PLACEHOLDER_PNG;
  let type = 'png';
  if (typeof value === 'string') {
    const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.*)$/i.exec(value);
    if (m) {
      type = m[1].toLowerCase().startsWith('jp') ? 'jpg' : m[1].toLowerCase();
      try { buf = Buffer.from(m[2], 'base64'); } catch (_) { buf = PLACEHOLDER_PNG; type = 'png'; }
    }
  }
  return { buf, type };
}

function imageEl(node, p) {
  const { buf, type } = parseImage(node.image);
  let w = typeof node.width === 'number' ? node.width : (typeof node.fit === 'object' ? node.fit[0] : 120);
  let h = typeof node.height === 'number' ? node.height : Math.round(w * 0.375);
  w = Math.min(w, 480);
  h = Math.min(h, 480);
  return new Paragraph({
    alignment: align(p.alignment),
    children: [new ImageRun({ data: buf, type, transformation: { width: Math.round(w), height: Math.round(h) } })],
  });
}

// table widths -> column widths in twips
function columnWidths(widths, ncols) {
  const arr = widths && widths.length ? widths : new Array(ncols).fill('*');
  while (arr.length < ncols) arr.push('*');
  const fixed = arr.map((w) => {
    if (typeof w === 'number') return { fixed: pt(w) };
    if (typeof w === 'string' && w.endsWith('%')) return { pct: parseFloat(w) / 100 };
    return { star: true }; // '*' or 'auto'
  });
  let used = 0, stars = 0;
  for (const f of fixed) {
    if (f.fixed) used += f.fixed;
    else if (f.pct) used += f.pct * CONTENT_WIDTH;
    else stars++;
  }
  const starW = stars ? Math.max(600, (CONTENT_WIDTH - used) / stars) : 0;
  return fixed.map((f) => (f.fixed ? f.fixed : f.pct ? Math.round(f.pct * CONTENT_WIDTH) : Math.round(starW)));
}

function noBorder() {
  return { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
}
function thinBorder() {
  return { style: BorderStyle.SINGLE, size: 2, color: '000000' };
}

function buildTable(node, styles, inh) {
  const body = node.table.body || [];
  const ncols = body.reduce((mx, r) => Math.max(mx, Array.isArray(r) ? r.length : 0), 0) || 1;
  const colW = columnWidths(node.table.widths, ncols);
  const bordered = node.layout !== 'noBorders' && node.table.body.length >= 0 ? node.layout !== 'noBorders' : false;
  const border = bordered ? thinBorder() : noBorder();

  const rows = [];
  for (const row of body) {
    if (!Array.isArray(row)) continue;
    const cells = [];
    for (let ci = 0; ci < row.length; ci++) {
      const cell = row[ci];
      const cp = resolve(cell, styles, inh);
      let children = blockEls(cell, styles, cp);
      if (!children.length) children = [new Paragraph({ children: [new TextRun('')] })];
      const opt = {
        children,
        width: { size: colW[ci] || colW[0], type: WidthType.DXA },
        margins: { top: 40, bottom: 40, left: 60, right: 60 },
      };
      if (cell && typeof cell === 'object') {
        const fc = color(cell.fillColor);
        if (fc) opt.shading = { type: ShadingType.CLEAR, color: 'auto', fill: fc };
        if (cell.colSpan > 1) opt.columnSpan = cell.colSpan;
        if (cell.rowSpan > 1) opt.rowSpan = cell.rowSpan;
      }
      cells.push(new TableCell(opt));
    }
    if (cells.length) rows.push(new TableRow({ children: cells }));
  }
  if (!rows.length) return [];
  return [new Table({
    rows,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: colW,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
  })];
}

function buildColumns(node, styles, inh) {
  const cols = node.columns || [];
  const widths = cols.map((c) => (c && typeof c === 'object' && c.width !== undefined ? c.width : '*'));
  const colW = columnWidths(widths, cols.length);
  const cells = cols.map((c, i) => {
    const cp = resolve(c, styles, inh);
    let children = blockEls(c, styles, cp);
    if (!children.length) children = [new Paragraph({ children: [new TextRun('')] })];
    return new TableCell({
      children,
      width: { size: colW[i], type: WidthType.DXA },
      borders: {
        top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(),
        insideHorizontal: noBorder(), insideVertical: noBorder(),
      },
    });
  });
  return [new Table({
    rows: [new TableRow({ children: cells })],
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: colW,
    borders: {
      top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(),
      insideHorizontal: noBorder(), insideVertical: noBorder(),
    },
  })];
}

function listEls(items, styles, inh, ordered) {
  const out = [];
  let i = 1;
  for (const it of items || []) {
    const p = resolve(typeof it === 'object' ? it : {}, styles, inh);
    const runs = inlineRuns(typeof it === 'object' && it.text !== undefined ? it.text : it, styles, p);
    if (ordered) {
      out.push(new Paragraph({
        children: [makeRun(i++ + '. ', p), ...runs],
        indent: { left: pt(18) },
        spacing: { after: 40 },
      }));
    } else {
      out.push(new Paragraph({ children: runs.length ? runs : [new TextRun('')], bullet: { level: 0 }, spacing: { after: 40 } }));
    }
  }
  return out;
}

// pdfmake block -> docx elements (Paragraph | Table)[]
function blockEls(node, styles, inh) {
  if (node == null) return [];
  if (typeof node === 'string' || typeof node === 'number') {
    if (node === '') return [];
    return [paragraph([makeRun(node, inh)], inh)];
  }
  if (Array.isArray(node)) return node.flatMap((n) => blockEls(n, styles, inh));
  if (typeof node !== 'object') return [];

  const p = resolve(node, styles, inh);
  const els = [];
  const pageBreakBefore = node.pageBreak === 'before';

  if (node.image !== undefined) {
    els.push(imageEl(node, p));
  } else if (node.table) {
    els.push(...buildTable(node, styles, p));
  } else if (node.columns) {
    els.push(...buildColumns(node, styles, p));
  } else if (node.stack) {
    els.push(...blockEls(node.stack, styles, p));
  } else if (node.ul) {
    els.push(...listEls(node.ul, styles, p, false));
  } else if (node.ol) {
    els.push(...listEls(node.ol, styles, p, true));
  } else if (node.text !== undefined) {
    els.push(paragraph(inlineRuns(node.text, styles, p), p));
  } else if (node.pageBreak) {
    els.push(new Paragraph({ children: [new PageBreak()] }));
    return els;
  } else if (node.canvas) {
    // horizontal rule approximation
    els.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' } }, children: [new TextRun('')] }));
  }

  if (pageBreakBefore && els.length && els[0] instanceof Paragraph) {
    els.unshift(new Paragraph({ children: [new PageBreak()] }));
  }
  return els;
}

// ---------------------------------------------------------------------------
// per-template -> docx elements (heading + body)
// ---------------------------------------------------------------------------
function templateElements(name, withHeading) {
  const docDef = renderDocDef(name);
  const styles = docDef.styles || {};
  const baseStyle = Object.assign({ fontSize: DEFAULT_FONT_SIZE }, docDef.defaultStyle || {});
  const els = [];
  if (withHeading) {
    els.push(new Paragraph({ text: name, heading: HeadingLevel.HEADING_1, spacing: { before: 120, after: 60 } }));
    els.push(new Paragraph({
      children: [new TextRun({ text: 'sample data — rendered from prod format-config', italics: true, color: '666666', size: 18 })],
      spacing: { after: 120 },
    }));
  }
  els.push(...blockEls(docDef.content, styles, baseStyle));
  return els;
}

async function writeDoc(filePath, children) {
  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buf);
}

// ---------------------------------------------------------------------------
async function main() {
  const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let names = listTemplates();
  if (onlyArg) names = names.filter((n) => n === onlyArg);

  const results = [];
  const combinedChildren = [
    new Paragraph({ text: 'Kerala Courts — PDF Templates', heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [new TextRun({ text: 'Rendered from prod format-config with sample data. One section per template.', italics: true, color: '666666' })],
      spacing: { after: 240 },
    }),
  ];

  for (const name of names) {
    try {
      const els = templateElements(name, true);
      await writeDoc(path.join(OUT_DIR, name + '.docx'), templateElements(name, false));
      if (results.length) combinedChildren.push(new Paragraph({ children: [new PageBreak()] }));
      combinedChildren.push(...els);
      results.push({ name, ok: true });
      process.stdout.write(`  ok   ${name}\n`);
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
      process.stdout.write(`  FAIL ${name}: ${e.message}\n`);
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok);
  console.log(`\nRendered ${ok}/${results.length} templates.`);
  if (fail.length) console.log('Failed:\n' + fail.map((f) => `  - ${f.name}: ${f.error}`).join('\n'));

  if (ok && !onlyArg) {
    await writeDoc(COMBINED, combinedChildren);
    console.log(`\nCombined Word doc -> ${path.relative(process.cwd(), COMBINED)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
