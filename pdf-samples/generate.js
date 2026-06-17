/*
 * generate.js
 * -----------
 * Renders a sample PDF (with auto-generated dummy data) for every prod PDF
 * template in ../pdf-service/format-config, then merges them all into a single
 * combined.pdf for the developer hand-off document.
 *
 * Pipeline mirrors the eGov pdf-service:
 *   stringify(format-config.config) -> Mustache.render(vars) -> JSON.parse
 *   -> strip loop-marker artifacts -> pdfmake -> PDF
 *
 * Dummy data is derived from the template itself (Mustache.parse tokens), so we
 * don't need real input payloads. -qr templates are skipped (per request).
 *
 * Usage:  node generate.js [--only=<name>]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Mustache = require('mustache');
const PdfPrinter = require('pdfmake');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const FORMAT_DIR = path.join(__dirname, '..', 'pdf-service', 'format-config');
const OUT_DIR = path.join(__dirname, 'output');
const COMBINED = path.join(__dirname, 'combined.pdf');

// ---------------------------------------------------------------------------
// Fonts. Prod uses Cambay + ManjiriMalyalam (Malayalam) + Roboto. We don't ship
// those ttf files, so alias everything to Roboto. To get an exact font match,
// drop the real .ttf files into ./fonts and extend the map below.
// ---------------------------------------------------------------------------
// pdfmake 0.2.x ships fonts as base64 in vfs_fonts.js; PdfPrinter accepts
// Buffers, so decode Roboto from there (no ttf files on disk).
const _vfsMod = require('pdfmake/build/vfs_fonts.js');
const _vfs = _vfsMod.pdfMake ? _vfsMod.pdfMake.vfs : _vfsMod.vfs || _vfsMod;
const ttf = (k) => Buffer.from(_vfs[k], 'base64');
const roboto = {
  normal: ttf('Roboto-Regular.ttf'),
  bold: ttf('Roboto-Medium.ttf'),
  italics: ttf('Roboto-Italic.ttf'),
  bolditalics: ttf('Roboto-MediumItalic.ttf'),
};
const fonts = { Roboto: roboto, Cambay: roboto, ManjiriMalyalam: roboto };
const printer = new PdfPrinter(fonts);

// ---------------------------------------------------------------------------
// Minimal PNG encoder -> placeholder image for {{logo}}/{{emblem}}/{{qr}} vars.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePNG(w, h, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 3;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}
const PLACEHOLDER_IMG = makePNG(160, 60, [220, 220, 220]);

// ---------------------------------------------------------------------------
// Dummy value generation.
// ---------------------------------------------------------------------------
function humanize(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function dummyValue(name, imageVars) {
  if (imageVars.has(name)) return PLACEHOLDER_IMG;
  const n = name.toLowerCase();
  if (/qr|image|logo|emblem|seal|scissor|photo|signature|stamp/.test(n)) return PLACEHOLDER_IMG;
  if (/url/.test(n)) return 'https://example.com';
  if (/date/.test(n)) return '12-06-2026';
  if (/year/.test(n)) return '2026';
  if (/(amount|fee|price|cost|balance|total|paid|fine|charge)/.test(n)) return '1,000';
  if (/(number|num|count|index|page|qty|quantity|sno|serial|cnr|otp|pin|code)/.test(n)) return '12';
  if (/designation/.test(n)) return 'Judicial Magistrate of First Class';
  if (/court/.test(n)) return '24x7 ON Court, Kollam';
  if (/(address|addr)/.test(n)) return '123, M.G. Road, Kollam, Kerala - 691001';
  if (/email/.test(n)) return 'sample@example.com';
  if (/(phone|mobile|contact)/.test(n)) return '9876543210';
  if (/casename/.test(n)) return 'Sample Complainant vs. Sample Accused';
  if (/case/.test(n)) return 'ST/123/2026';
  if (/(place|city|district|state|location|taluk|village)/.test(n)) return 'Kollam';
  if (/(name|complainant|accused|respondent|petitioner|advocate|witness|judge|party|applicant|surety)/.test(n))
    return 'Sample Name';
  return 'Sample ' + humanize(name);
}

// nested set helpers (support dotted names like address.city)
function assignNested(obj, name, value) {
  const parts = name.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null || Array.isArray(cur[parts[i]]))
      cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function getNested(obj, name) {
  const parts = name.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}
function setIfAbsent(obj, name, value) {
  if (getNested(obj, name) === undefined) assignNested(obj, name, value);
}

// Walk Mustache tokens, building a data object that satisfies the template.
function buildData(tokens, obj, imageVars) {
  for (const t of tokens) {
    const type = t[0];
    const name = t[1];
    if (type === 'name' || type === '&') {
      if (name === '.') { obj.__dot = true; continue; }
      setIfAbsent(obj, name, dummyValue(name, imageVars));
    } else if (type === '#') {
      const child = {};
      buildData(t[4] || [], child, imageVars);
      if (child.__dot) {
        assignNested(obj, name, ['Sample Item 1', 'Sample Item 2']);
      } else if (Object.keys(child).length) {
        assignNested(obj, name, [child]); // one sample row
      } else {
        setIfAbsent(obj, name, true); // boolean conditional -> show block
      }
    } else if (type === '^') {
      // inverted: renders when falsy; expose its children in parent scope
      const child = {};
      buildData(t[4] || [], child, imageVars);
      setIfAbsent(obj, name, false);
      for (const k of Object.keys(child)) setIfAbsent(obj, k, child[k]);
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------
function collectImageVars(templateStr) {
  const set = new Set();
  const re = /"(?:image|qr|svg)"\s*:\s*"\{\{[#&]?\s*([^}]+?)\s*\}\}"/g;
  let m;
  while ((m = re.exec(templateStr))) set.add(m[1].trim());
  return set;
}

// Remove bare "" array entries left behind by the {{#list}}/{{/list}} markers.
function stripEmpties(node) {
  if (Array.isArray(node)) {
    const cleaned = node.filter((x) => x !== '');
    for (const x of cleaned) stripEmpties(x);
    return cleaned;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) node[k] = stripEmpties(node[k]);
  }
  return node;
}

function renderTemplate(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(FORMAT_DIR, name + '.json'), 'utf8'));
  const config = raw.config;
  if (!config) throw new Error('no .config key');

  const templateStr = JSON.stringify(config);
  const imageVars = collectImageVars(templateStr);

  const data = {};
  buildData(Mustache.parse(templateStr), data, imageVars);

  const rendered = Mustache.render(templateStr, data);
  let docDef = JSON.parse(rendered);
  docDef = stripEmpties(docDef);

  docDef.defaultStyle = docDef.defaultStyle || {};
  if (!docDef.defaultStyle.font) docDef.defaultStyle.font = 'Roboto';

  return new Promise((resolve, reject) => {
    const chunks = [];
    const pdf = printer.createPdfKitDocument(docDef);
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.end();
  });
}

// ---------------------------------------------------------------------------
// Combined document (index + title page per template).
// ---------------------------------------------------------------------------
async function buildCombined(results) {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const fontBold = await out.embedFont(StandardFonts.HelveticaBold);
  const ok = results.filter((r) => r.ok);

  // Index page(s)
  let page = out.addPage();
  let { width, height } = page.getSize();
  page.drawText('Kerala Courts — PDF Templates (prod, sample data)', {
    x: 50, y: height - 60, size: 16, font: fontBold,
  });
  let y = height - 95;
  let n = 0;
  for (const r of ok) {
    if (y < 60) { page = out.addPage(); height = page.getSize().height; y = height - 60; }
    page.drawText(`${++n}.  ${r.name}`, { x: 55, y, size: 10, font });
    y -= 16;
  }

  for (const r of ok) {
    // title page
    const tp = out.addPage();
    const sz = tp.getSize();
    tp.drawText(r.name, { x: 50, y: sz.height / 2, size: 20, font: fontBold });
    tp.drawText('sample data — rendered from prod format-config', {
      x: 50, y: sz.height / 2 - 26, size: 11, font, color: rgb(0.4, 0.4, 0.4),
    });
    // template pages
    const src = await PDFDocument.load(r.buffer);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }

  fs.writeFileSync(COMBINED, await out.save());
}

// ---------------------------------------------------------------------------
async function main() {
  const onlyArg = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let names = fs
    .readdirSync(FORMAT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((name) => !name.endsWith('-qr')) // skip QR templates per request
    .sort();
  if (onlyArg) names = names.filter((n) => n === onlyArg);

  const results = [];
  for (const name of names) {
    try {
      const buffer = await renderTemplate(name);
      fs.writeFileSync(path.join(OUT_DIR, name + '.pdf'), buffer);
      results.push({ name, ok: true, buffer });
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
    await buildCombined(results);
    console.log(`\nCombined PDF -> ${path.relative(process.cwd(), COMBINED)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
