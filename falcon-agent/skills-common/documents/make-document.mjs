#!/usr/bin/env node
// Makes a Word (.docx), Excel (.xlsx) or PowerPoint (.pptx) file from a small JSON description and prints
// one line of JSON. Uses only what comes with Node.js: the files are zips of XML, written here by hand.
//
//   node make-document.mjs --spec "<path to spec.json>" [--open] [--dir "<folder>"]
//
// The file goes into "Falcon Documents" inside the user's Documents folder (or --dir, or FALCON_DOCS_DIR).
// It never overwrites: an existing name gets " (2)", " (3)" and so on.
//   {"ok":true,"path":"...","type":"pptx","slides":6}
//   {"ok":false,"error":"..."}
//
// Spec shapes (unknown fields are ignored):
//   {"type":"docx","title":"...","fileName":"optional","blocks":[{"heading":"..","level":1},{"paragraph":".."},
//     {"bullets":[".."]},{"numbered":[".."]},{"table":[["H1","H2"],["a","b"]]}]}
//   {"type":"xlsx","title":"...","sheets":[{"name":"Sheet","rows":[["Name","Amount"],["A",12.5],["Total","=SUM(B2:B2)"]]}]}
//   {"type":"pptx","title":"...","subtitle":"optional","slides":[{"title":"..","bullets":[".."],"notes":"optional"}]}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : fallback; };
const done = (result) => { process.stdout.write(`${JSON.stringify(result)}\n`); process.exit(result.ok ? 0 : 1); };
const fail = (error) => done({ ok: false, error });

// ---------- Text and XML ----------

// Characters XML 1.0 does not allow at all (control characters, lone surrogate halves) are dropped.
const clean = (value) => String(value ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
const esc = (value) => clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const text = (value) => (value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));
const lang = (value) => (/[Ѐ-ӿ]/.test(value) ? 'ru-RU' : 'en-US');
// "**bold** words" -> [{text:'bold',bold:true},{text:' words'}]
const pieces = (value) => clean(value).split(/\*\*(.+?)\*\*/s).map((t, i) => ({ text: t, bold: i % 2 === 1 })).filter((p) => p.text);

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = {
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  x: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
};
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const CT = 'application/vnd.openxmlformats-officedocument.';
const FONT = 'Arial'; // present on every Mac and Windows PC, with Cyrillic; Pages and Keynote do not warn about it

const rels = (list) => `${XML}<Relationships xmlns="${NS.rel}">${list.map(([id, type, target]) =>
  `<Relationship Id="${id}" Type="${type.startsWith('http') ? type : REL + type}" Target="${target}"/>`).join('')}</Relationships>`;
const contentTypes = (overrides) => `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('')
  + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`
  + `<Override PartName="/docProps/app.xml" ContentType="${CT}extended-properties+xml"/></Types>`;
const rootRels = (main) => rels([
  ['rId1', 'officeDocument', main],
  ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
  ['rId3', 'extended-properties', 'docProps/app.xml'],
]);
function docProps(title) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return {
    'docProps/core.xml': `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
      + `<dc:title>${esc(title)}</dc:title><dc:creator>Falcon</dc:creator><cp:lastModifiedBy>Falcon</cp:lastModifiedBy>`
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml': `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Falcon</Application></Properties>`,
  };
}

// ---------- Zip ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** files: { "path/in/zip": string | Buffer }, written in the given order ([Content_Types].xml first). */
function zip(files) {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  const count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------- Word ----------

function makeDocx(spec) {
  const blocks = Array.isArray(spec.blocks) ? spec.blocks : [];
  const title = clean(text(spec.title)).trim();
  let skipped = 0;
  let used = 0;
  const nums = []; // one numbering instance per numbered list, so each list starts at 1

  const run = (value, { bold = false, size = 0 } = {}) => pieces(value).map((p) => {
    const rPr = (bold || p.bold ? '<w:b/><w:bCs/>' : '') + (size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : '');
    const parts = p.text.split('\n').map((line) => line.split('\t').map((t) => (t ? `<w:t xml:space="preserve">${esc(t)}</w:t>` : '')).join('<w:tab/>')).join('<w:br/>');
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${parts}</w:r>`;
  }).join('');
  const para = (value, pPr = '', opts) => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${run(value, opts)}</w:p>`;

  const body = [];
  if (title) body.push(para(title, '<w:pStyle w:val="Title"/>'));
  for (const block of blocks) {
    if (!block || typeof block !== 'object') { skipped++; continue; }
    if (block.heading !== undefined) {
      const level = Math.min(3, Math.max(1, Number(block.level) || 1));
      body.push(para(text(block.heading), `<w:pStyle w:val="Heading${level}"/>`));
    } else if (block.paragraph !== undefined || block.text !== undefined) {
      body.push(para(text(block.paragraph ?? block.text)));
    } else if (Array.isArray(block.bullets) || Array.isArray(block.numbered)) {
      const numbered = Array.isArray(block.numbered);
      let numId = 1;
      if (numbered) { numId = nums.length + 2; nums.push(numId); }
      for (const item of numbered ? block.numbered : block.bullets) {
        body.push(para(text(item), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`));
      }
    } else if (Array.isArray(block.table)) {
      const rows = block.table.map((row) => (Array.isArray(row) ? row : [row]));
      const cols = Math.max(1, ...rows.map((row) => row.length));
      const width = Math.floor(9026 / cols);
      const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
      const trs = rows.map((row, r) => {
        const cells = Array.from({ length: cols }, (_, c) => {
          const shade = r === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '';
          return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>${para(text(row[c]), '<w:spacing w:before="40" w:after="40"/>', { bold: r === 0 })}</w:tc>`;
        }).join('');
        return `<w:tr>${r === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
      }).join('');
      body.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>`
        + `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>`
        + `<w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(cols)}</w:tblGrid>${trs || ''}</w:tbl>`);
      if (!rows.length) { body.pop(); skipped++; continue; }
      body.push('<w:p/>'); // Word needs a paragraph between two tables, and after a table at the very end
    } else { skipped++; continue; }
    used++;
  }
  if (!title && !used) return { error: 'The Word document has nothing in it. Give a title and some blocks (heading, paragraph, bullets, numbered or table).' };

  const document = `${XML}<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}"><w:body>${body.join('')}`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';

  const rFonts = `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>`;
  const heading = (n, size, before) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>`
    + `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="1F3864"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  const styles = `${XML}<w:styles xmlns:w="${NS.w}">`
    + `<w:docDefaults><w:rPrDefault><w:rPr>${rFonts}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>`
    + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/>'
    + '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="1F3864"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>'
    + heading(1, 32, 360) + heading(2, 26, 240) + heading(3, 23, 200)
    + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/>'
    + '<w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style></w:styles>';
  const level = (format, label) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${label}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;
  const numbering = `${XML}<w:numbering xmlns:w="${NS.w}">`
    + `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${level('bullet', '•')}</w:abstractNum>`
    + `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${level('decimal', '%1.')}</w:abstractNum>`
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    + nums.map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')
    + '</w:numbering>';

  return {
    files: {
      '[Content_Types].xml': contentTypes([
        ['/word/document.xml', `${CT}wordprocessingml.document.main+xml`],
        ['/word/styles.xml', `${CT}wordprocessingml.styles+xml`],
        ['/word/numbering.xml', `${CT}wordprocessingml.numbering+xml`],
      ]),
      '_rels/.rels': rootRels('word/document.xml'),
      'word/document.xml': document,
      'word/_rels/document.xml.rels': rels([['rId1', 'styles', 'styles.xml'], ['rId2', 'numbering', 'numbering.xml']]),
      'word/styles.xml': styles,
      'word/numbering.xml': numbering,
      ...docProps(title),
    },
    info: { blocks: used, ...(skipped ? { skipped } : {}) },
  };
}

// ---------- Excel ----------

const column = (n) => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

function makeXlsx(spec) {
  const sheets = (Array.isArray(spec.sheets) ? spec.sheets : Array.isArray(spec.rows) ? [{ name: spec.title, rows: spec.rows }] : [])
    .filter((s) => s && typeof s === 'object');
  if (!sheets.length) return { error: 'The spreadsheet has no sheets. Give "sheets": [{"name": "...", "rows": [[...], [...]]}].' };
  const title = clean(text(spec.title)).trim();
  const strings = [];
  const index = new Map();
  const shared = (s) => { if (!index.has(s)) { index.set(s, strings.length); strings.push(s); } return index.get(s); };
  const names = new Set();
  let total = 0;

  const parts = sheets.map((sheet, n) => {
    let name = clean(text(sheet.name)).replace(/[[\]:*?/\\\n\t]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || `Sheet${n + 1}`;
    for (let i = 2; names.has(name.toLowerCase()); i++) name = `${name.slice(0, 31 - ` (${i})`.length)} (${i})`;
    names.add(name.toLowerCase());
    const rows = (Array.isArray(sheet.rows) ? sheet.rows : []).map((row) => (Array.isArray(row) ? row : [row]));
    total += rows.length;
    const widths = [];
    let maxCol = 0;
    const data = rows.map((row, r) => {
      const cells = row.map((value, c) => {
        const ref = `${column(c)}${r + 1}`;
        const style = r === 0 ? ' s="1"' : '';
        let xml = '';
        let shown = '';
        if (typeof value === 'number' && Number.isFinite(value)) { xml = `<c r="${ref}"${style}><v>${value}</v></c>`; shown = String(value); }
        else if (typeof value === 'boolean') { xml = `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`; shown = 'FALSE'; }
        else {
          const s = clean(text(value)).slice(0, 32767);
          if (!s) return '';
          if (s.length > 1 && s.startsWith('=')) { xml = `<c r="${ref}"${style}><f>${esc(s.slice(1))}</f></c>`; shown = '0000000000'; }
          else { xml = `<c r="${ref}"${style} t="s"><v>${shared(s)}</v></c>`; shown = s.split('\n').reduce((a, b) => (b.length > a.length ? b : a), ''); }
        }
        widths[c] = Math.max(widths[c] || 0, shown.length + (r === 0 ? 2 : 0));
        maxCol = Math.max(maxCol, c + 1);
        return xml;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    const cols = widths.map((w, c) => (w ? `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(9, w + 2))}" customWidth="1"/>` : '')).join('');
    const frozen = rows.length > 1 ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : '';
    const xml = `${XML}<worksheet xmlns="${NS.x}" xmlns:r="${NS.r}">`
      + `<dimension ref="${rows.length && maxCol ? `A1:${column(maxCol - 1)}${rows.length}` : 'A1'}"/>`
      + `<sheetViews><sheetView${n === 0 ? ' tabSelected="1"' : ''} workbookViewId="0">${frozen}</sheetView></sheetViews>`
      + `<sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${data}</sheetData>`
      + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
    return { name, xml };
  });

  const files = {
    '[Content_Types].xml': contentTypes([
      ['/xl/workbook.xml', `${CT}spreadsheetml.sheet.main+xml`],
      ['/xl/styles.xml', `${CT}spreadsheetml.styles+xml`],
      ['/xl/sharedStrings.xml', `${CT}spreadsheetml.sharedStrings+xml`],
      ...parts.map((_, i) => [`/xl/worksheets/sheet${i + 1}.xml`, `${CT}spreadsheetml.worksheet+xml`]),
    ]),
    '_rels/.rels': rootRels('xl/workbook.xml'),
    'xl/workbook.xml': `${XML}<workbook xmlns="${NS.x}" xmlns:r="${NS.r}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>`
      + parts.map((p, i) => `<sheet name="${esc(p.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>',
    'xl/_rels/workbook.xml.rels': rels([
      ...parts.map((_, i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`]),
      [`rId${parts.length + 1}`, 'styles', 'styles.xml'],
      [`rId${parts.length + 2}`, 'sharedStrings', 'sharedStrings.xml'],
    ]),
    'xl/styles.xml': `${XML}<styleSheet xmlns="${NS.x}">`
      + `<fonts count="2"><font><sz val="11"/><name val="${FONT}"/><family val="2"/></font><font><b/><sz val="11"/><name val="${FONT}"/><family val="2"/></font></fonts>`
      + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
      + '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/sharedStrings.xml': `${XML}<sst xmlns="${NS.x}" count="${strings.length}" uniqueCount="${strings.length}">`
      + strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('') + '</sst>',
    ...docProps(title),
  };
  parts.forEach((p, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = p.xml; });
  return { files, info: { sheets: parts.length, rows: total } };
}

// ---------- PowerPoint ----------

const W = 12192000; // 16:9, 13.333 x 7.5 inches
const H = 6858000;
const pns = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;
const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const xfrm = (x, y, cx, cy) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
const fontRefs = (kind) => `<a:latin typeface="+${kind}-lt"/><a:ea typeface="+${kind}-ea"/><a:cs typeface="+${kind}-cs"/>`;
const emptyBody = '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>';
// A placeholder shape. spPr empty = take the position from the layout / master.
const placeholder = (id, name, ph, spPr = '', body = emptyBody) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${spPr}</p:spPr>${body}</p:sp>`;
const bar = (id, x, y, cx, cy) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Accent ${id}"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr>${xfrm(x, y, cx, cy)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
const clrMap = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const runs = (value, rPr = '') => pieces(value).map((p) => `<a:r><a:rPr lang="${lang(p.text)}"${p.bold ? ' b="1"' : ''}${rPr} dirty="0"/><a:t>${esc(p.text.replace(/\n/g, ' '))}</a:t></a:r>`).join('');
const paragraphs = (lines, pPr = '', rPr = '') => lines.map((line) => `<a:p>${pPr}${runs(line, rPr)}<a:endParaRPr lang="${lang(line)}"${rPr} dirty="0"/></a:p>`).join('');
const textBody = (paras) => `<p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody>`;

function theme(name) {
  const colours = { dk1: '1F2937', lt1: 'FFFFFF', dk2: '111827', lt2: 'F3F4F6', accent1: '2563EB', accent2: '0EA5E9', accent3: '10B981', accent4: 'F59E0B', accent5: 'EF4444', accent6: '8B5CF6', hlink: '2563EB', folHlink: '7C3AED' };
  const font = `<a:latin typeface="${FONT}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  return `${XML}<a:theme xmlns:a="${NS.a}" name="${name}"><a:themeElements><a:clrScheme name="Falcon">`
    + Object.entries(colours).map(([k, v]) => `<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join('')
    + `</a:clrScheme><a:fontScheme name="Falcon"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="Falcon"><a:fillStyleLst>${fill.repeat(3)}</a:fillStyleLst><a:lnStyleLst>`
    + [6350, 12700, 19050].map((w) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${fill}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`).join('')
    + `</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill.repeat(3)}</a:bgFillStyleLst></a:fmtScheme>`
    + '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
}

function makePptx(spec) {
  const title = clean(text(spec.title)).trim();
  const subtitle = clean(text(spec.subtitle)).trim();
  const list = (Array.isArray(spec.slides) ? spec.slides : []).filter((s) => s && typeof s === 'object');
  if (!title && !list.length) return { error: 'The presentation has nothing in it. Give a title and "slides": [{"title": "...", "bullets": ["..."]}].' };
  const lines = (value) => (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value])
    .map((v) => clean(text(v)).trim()).filter(Boolean);

  // Slide 1 is the title slide; the rest are title + bullets.
  const slides = [{ kind: 'title', title: title || clean(text(list[0]?.title)).trim(), subtitle, notes: lines(spec.notes) }];
  for (const s of list) slides.push({ kind: 'content', title: clean(text(s.title)).trim(), bullets: lines(s.bullets), text: lines(s.text ?? s.paragraph), notes: lines(s.notes) });
  const withNotes = slides.some((s) => s.notes.length);

  const titleXml = (s, id) => placeholder(id, 'Title', `<p:ph type="${s.kind === 'title' ? 'ctrTitle' : 'title'}"/>`, '', textBody(paragraphs([s.title || ' '])));
  const slideXml = slides.map((s) => {
    const shapes = [titleXml(s, 2)];
    if (s.kind === 'title' && s.subtitle) shapes.push(placeholder(3, 'Subtitle', '<p:ph type="subTitle" idx="1"/>', '', textBody(paragraphs(s.subtitle.split('\n')))));
    if (s.kind === 'content' && (s.bullets.length || s.text.length)) {
      // Smaller type for fuller slides, so the text stays on the slide.
      const all = [...s.bullets, ...s.text];
      const chars = all.join('').length;
      const size = all.length <= 4 && chars <= 240 ? 2800 : all.length <= 6 && chars <= 420 ? 2400 : all.length <= 8 && chars <= 640 ? 2000 : 1600;
      const plain = '<a:pPr marL="0" indent="0"><a:buNone/></a:pPr>';
      shapes.push(placeholder(3, 'Content', '<p:ph idx="1"/>', '', textBody(paragraphs(s.bullets, '', ` sz="${size}"`) + paragraphs(s.text, plain, ` sz="${size}"`))));
    }
    return `${XML}<p:sld ${pns}><p:cSld><p:spTree>${group}${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  });

  const titleStyle = `<p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/>`
    + `<a:defRPr sz="3600" b="1" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>${fontRefs('mj')}</a:defRPr></a:lvl1pPr></p:titleStyle>`;
  const bodyLevel = (n, marL, indent, size) => `<a:lvl${n}pPr marL="${marL}" indent="${indent}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">`
    + '<a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buClr><a:schemeClr val="accent1"/></a:buClr>'
    + `<a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="•"/><a:defRPr sz="${size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>${fontRefs('mn')}</a:defRPr></a:lvl${n}pPr>`;
  const otherStyle = `<p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>${fontRefs('mn')}</a:defRPr></a:lvl1pPr></p:otherStyle>`;
  const margin = 685800;
  const master = `${XML}<p:sldMaster ${pns}><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${group}`
    + placeholder(2, 'Title Placeholder 1', '<p:ph type="title"/>', `${xfrm(margin, 380000, W - 2 * margin, 1100000)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`,
      `<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="b"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Title</a:t></a:r></a:p></p:txBody>`)
    + placeholder(3, 'Text Placeholder 2', '<p:ph type="body" idx="1"/>', `${xfrm(margin, 1750000, W - 2 * margin, H - 1750000 - 500000)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`,
      `<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Text</a:t></a:r></a:p></p:txBody>`)
    + bar(4, margin + 91440, 1560000, 1100000, 54864)
    + `</p:spTree></p:cSld>${clrMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst>`
    + `<p:txStyles>${titleStyle}<p:bodyStyle>${bodyLevel(1, 342900, -342900, 2800)}${bodyLevel(2, 742950, -285750, 2400)}</p:bodyStyle>${otherStyle}</p:txStyles></p:sldMaster>`;
  const layoutTitle = `${XML}<p:sldLayout ${pns} type="title" preserve="1" showMasterSp="0"><p:cSld name="Title Slide"><p:spTree>${group}`
    + placeholder(2, 'Title 1', '<p:ph type="ctrTitle"/>', xfrm(914400, 1900000, W - 2 * 914400, 1500000),
      `<p:txBody><a:bodyPr anchor="b"><a:normAutofit/></a:bodyPr><a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="4800"/></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="en-US"/><a:t>Title</a:t></a:r></a:p></p:txBody>`)
    + bar(3, 914400 + 91440, 3560000, 1400000, 64008)
    + placeholder(4, 'Subtitle 2', '<p:ph type="subTitle" idx="1"/>', xfrm(914400, 3780000, W - 2 * 914400, 1300000),
      `<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle><a:lvl1pPr marL="0" indent="0" algn="l"><a:buNone/><a:defRPr sz="2400"><a:solidFill><a:srgbClr val="6B7280"/></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="en-US"/><a:t>Subtitle</a:t></a:r></a:p></p:txBody>`)
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
  const layoutContent = `${XML}<p:sldLayout ${pns} type="obj" preserve="1"><p:cSld name="Title and Content"><p:spTree>${group}`
    + placeholder(2, 'Title 1', '<p:ph type="title"/>') + placeholder(3, 'Content Placeholder 2', '<p:ph idx="1"/>')
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

  const n = slides.length;
  const files = {};
  const overrides = [
    ['/ppt/presentation.xml', `${CT}presentationml.presentation.main+xml`],
    ['/ppt/slideMasters/slideMaster1.xml', `${CT}presentationml.slideMaster+xml`],
    ['/ppt/slideLayouts/slideLayout1.xml', `${CT}presentationml.slideLayout+xml`],
    ['/ppt/slideLayouts/slideLayout2.xml', `${CT}presentationml.slideLayout+xml`],
    ['/ppt/theme/theme1.xml', `${CT}theme+xml`],
    ['/ppt/presProps.xml', `${CT}presentationml.presProps+xml`],
    ['/ppt/viewProps.xml', `${CT}presentationml.viewProps+xml`],
    ['/ppt/tableStyles.xml', `${CT}presentationml.tableStyles+xml`],
    ...slides.map((_, i) => [`/ppt/slides/slide${i + 1}.xml`, `${CT}presentationml.slide+xml`]),
  ];
  if (withNotes) {
    overrides.push(['/ppt/notesMasters/notesMaster1.xml', `${CT}presentationml.notesMaster+xml`], ['/ppt/theme/theme2.xml', `${CT}theme+xml`]);
    slides.forEach((s, i) => { if (s.notes.length) overrides.push([`/ppt/notesSlides/notesSlide${i + 1}.xml`, `${CT}presentationml.notesSlide+xml`]); });
  }
  files['[Content_Types].xml'] = contentTypes(overrides);
  files['_rels/.rels'] = rootRels('ppt/presentation.xml');

  const presRels = [['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ...slides.map((_, i) => [`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`]),
    [`rId${n + 2}`, 'theme', 'theme/theme1.xml'], [`rId${n + 3}`, 'presProps', 'presProps.xml'], [`rId${n + 4}`, 'viewProps', 'viewProps.xml'], [`rId${n + 5}`, 'tableStyles', 'tableStyles.xml']];
  if (withNotes) presRels.push([`rId${n + 6}`, 'notesMaster', 'notesMasters/notesMaster1.xml']);
  files['ppt/presentation.xml'] = `${XML}<p:presentation ${pns} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
    + (withNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="rId${n + 6}"/></p:notesMasterIdLst>` : '')
    + `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  files['ppt/_rels/presentation.xml.rels'] = rels(presRels);
  files['ppt/presProps.xml'] = `${XML}<p:presentationPr ${pns}/>`;
  files['ppt/viewProps.xml'] = `${XML}<p:viewPr ${pns}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`;
  files['ppt/tableStyles.xml'] = `${XML}<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
  files['ppt/theme/theme1.xml'] = theme('Falcon');
  files['ppt/slideMasters/slideMaster1.xml'] = master;
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'slideLayout', '../slideLayouts/slideLayout2.xml'], ['rId3', 'theme', '../theme/theme1.xml']]);
  files['ppt/slideLayouts/slideLayout1.xml'] = layoutTitle;
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]);
  files['ppt/slideLayouts/slideLayout2.xml'] = layoutContent;
  files['ppt/slideLayouts/_rels/slideLayout2.xml.rels'] = rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]);
  slides.forEach((s, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = slideXml[i];
    const slideRels = [['rId1', 'slideLayout', `../slideLayouts/slideLayout${s.kind === 'title' ? 1 : 2}.xml`]];
    if (s.notes.length) slideRels.push(['rId2', 'notesSlide', `../notesSlides/notesSlide${i + 1}.xml`]);
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = rels(slideRels);
  });
  if (withNotes) {
    files['ppt/theme/theme2.xml'] = theme('Falcon Notes');
    files['ppt/notesMasters/notesMaster1.xml'] = `${XML}<p:notesMaster ${pns}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${group}`
      + `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr>`
      + `<p:spPr>${xfrm(685800, 1143000, 5486400, 3086100)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>`
      + placeholder(3, 'Notes Placeholder 2', '<p:ph type="body" sz="quarter" idx="3"/>', `${xfrm(685800, 4400550, 5486400, 3600450)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`,
        '<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Notes</a:t></a:r></a:p></p:txBody>')
      + `</p:spTree></p:cSld>${clrMap}<p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>${fontRefs('mn')}</a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;
    files['ppt/notesMasters/_rels/notesMaster1.xml.rels'] = rels([['rId1', 'theme', '../theme/theme2.xml']]);
    slides.forEach((s, i) => {
      if (!s.notes.length) return;
      files[`ppt/notesSlides/notesSlide${i + 1}.xml`] = `${XML}<p:notes ${pns}><p:cSld><p:spTree>${group}`
        + `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>`
        + placeholder(3, 'Notes Placeholder 2', '<p:ph type="body" idx="1"/>', '', textBody(paragraphs(s.notes.join('\n').split('\n'))))
        + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
      files[`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`] = rels([['rId1', 'notesMaster', '../notesMasters/notesMaster1.xml'], ['rId2', 'slide', `../slides/slide${i + 1}.xml`]]);
    });
  }
  Object.assign(files, docProps(title));
  return { files, info: { slides: n, ...(withNotes ? { notes: slides.filter((s) => s.notes.length).length } : {}) } };
}

// ---------- Where the file goes ----------

function documentsFolder() {
  if (process.platform === 'win32') {
    // Documents is often moved into OneDrive; ask Windows where it really is.
    try {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('MyDocuments')"], { encoding: 'utf8', timeout: 15000, windowsHide: true }).trim();
      if (out && fs.existsSync(out)) return out;
    } catch { /* fall back to the usual place */ }
  }
  return path.join(os.homedir(), 'Documents');
}

function safeName(value) {
  let name = clean(text(value)).replace(/\.(docx|xlsx|pptx)$/i, '').replace(/[<>:"/\\|?*%\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80).trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name = `${name} document`;
  return name;
}

/** Writes without ever replacing an existing file: "Name.docx", then "Name (2).docx", ... */
function writeNew(folder, base, ext, data) {
  for (let i = 1; i < 1000; i++) {
    const file = path.join(folder, `${base}${i > 1 ? ` (${i})` : ''}.${ext}`);
    try {
      fs.writeFileSync(file, data, { flag: 'wx' });
      return file;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error('There are too many files with this name already.');
}

function openFile(file) {
  const opts = { detached: true, stdio: 'ignore' };
  if (process.platform === 'darwin') spawn('open', [file], opts).unref();
  else if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${file}"`], { ...opts, windowsHide: true, windowsVerbatimArguments: true }).unref();
  else spawn('xdg-open', [file], opts).unref();
}

// ---------- Main ----------

const KINDS = { docx: 'docx', word: 'docx', doc: 'docx', xlsx: 'xlsx', excel: 'xlsx', xls: 'xlsx', spreadsheet: 'xlsx', pptx: 'pptx', powerpoint: 'pptx', ppt: 'pptx', presentation: 'pptx', slides: 'pptx' };
const NAMES = { docx: 'Document', xlsx: 'Spreadsheet', pptx: 'Presentation' };

try {
  const specPath = option('--spec');
  if (!specPath) fail('Write the document description to a JSON file first and give its path with --spec.');
  if (!fs.existsSync(specPath)) fail(`There is no file at ${specPath}.`);
  let spec;
  try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8').replace(/^﻿/, '')); } catch (err) { fail(`The description file is not valid JSON: ${err.message}`); }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) fail('The description must be one JSON object with a "type" of docx, xlsx or pptx.');
  const type = KINDS[String(spec.type || '').toLowerCase().replace(/^\./, '')];
  if (!type) fail('Say what to make with "type": "docx" (Word), "xlsx" (Excel) or "pptx" (PowerPoint).');

  const made = type === 'docx' ? makeDocx(spec) : type === 'xlsx' ? makeXlsx(spec) : makePptx(spec);
  if (made.error) fail(made.error);

  const folder = option('--dir') || process.env.FALCON_DOCS_DIR || path.join(documentsFolder(), 'Falcon Documents');
  fs.mkdirSync(folder, { recursive: true });
  const base = safeName(spec.fileName) || safeName(spec.title) || NAMES[type];
  const file = writeNew(folder, base, type, zip(made.files));
  const opened = args.includes('--open');
  if (opened) openFile(file);
  done({ ok: true, path: file, type, ...made.info, ...(opened ? { opened: true } : {}) });
} catch (err) {
  fail(`The document could not be made: ${err?.message || err}`);
}
