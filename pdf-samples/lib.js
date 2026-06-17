/*
 * lib.js — shared logic for turning a prod format-config template into a
 * concrete pdfmake document definition, using auto-generated dummy data.
 *
 * Pipeline (mirrors the eGov pdf-service):
 *   stringify(format-config.config) -> Mustache.render(dummyVars) -> JSON.parse
 *   -> strip loop-marker "" artifacts -> pdfmake docDefinition
 *
 * Consumers: docx-generate.js (Word) and generate.js (PDF).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Mustache = require('mustache');

const FORMAT_DIR = path.join(__dirname, '..', 'pdf-service', 'format-config');

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
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 3;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}
const PLACEHOLDER_PNG = makePNG(160, 60, [220, 220, 220]);
const PLACEHOLDER_IMG = 'data:image/png;base64,' + PLACEHOLDER_PNG.toString('base64');

// ---------------------------------------------------------------------------
// Dummy value generation.
// ---------------------------------------------------------------------------
function humanize(name) {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]/g, ' ').replace(/\s+/g, ' ').trim();
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

function assignNested(obj, name, value) {
  const parts = name.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null || Array.isArray(cur[parts[i]])) cur[parts[i]] = {};
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
        assignNested(obj, name, [child]);
      } else {
        setIfAbsent(obj, name, true);
      }
    } else if (type === '^') {
      const child = {};
      buildData(t[4] || [], child, imageVars);
      setIfAbsent(obj, name, false);
      for (const k of Object.keys(child)) setIfAbsent(obj, k, child[k]);
    }
  }
}

function collectImageVars(templateStr) {
  const set = new Set();
  const re = /"(?:image|qr|svg)"\s*:\s*"\{\{[#&]?\s*([^}]+?)\s*\}\}"/g;
  let m;
  while ((m = re.exec(templateStr))) set.add(m[1].trim());
  return set;
}

// Remove bare "" array entries left behind by {{#list}}/{{/list}} markers.
function stripEmpties(node) {
  if (Array.isArray(node)) {
    const cleaned = node.filter((x) => x !== '');
    for (let i = 0; i < cleaned.length; i++) cleaned[i] = stripEmpties(cleaned[i]);
    return cleaned;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) node[k] = stripEmpties(node[k]);
  }
  return node;
}

/** Build a concrete pdfmake docDefinition for a template using dummy data. */
function renderDocDef(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(FORMAT_DIR, name + '.json'), 'utf8'));
  const config = raw.config;
  if (!config) throw new Error('no .config key');
  const templateStr = JSON.stringify(config);
  const imageVars = collectImageVars(templateStr);
  const data = {};
  buildData(Mustache.parse(templateStr), data, imageVars);
  const rendered = Mustache.render(templateStr, data);
  return stripEmpties(JSON.parse(rendered));
}

function listTemplates() {
  return fs
    .readdirSync(FORMAT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((n) => !n.endsWith('-qr')) // skip QR templates per request
    .sort();
}

module.exports = { FORMAT_DIR, PLACEHOLDER_PNG, PLACEHOLDER_IMG, renderDocDef, listTemplates };
