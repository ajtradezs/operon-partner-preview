/* Import clients: the Phase 1 client fields as a template to fill in (an Excel workbook and a CSV), answering the partners'
   30 Oct note ("Create a downloadable excel template the client can populate"). A pasted or uploaded CSV is checked field by
   field; nothing is created until the Administrator confirms, and then each client is added through ENGINE.newClient.
   Files are read in the browser only. Nothing is sent anywhere. */
(() => {
  const MAX_BYTES = 1024 * 1024; const MAX_ROWS = 500;
  const IMP = { paste: '', source: '', res: null, created: [], err: '' };
  const FIELDS = ADM.FIELDS;
  const BY = {}; FIELDS.forEach((f) => { BY[f.key] = f; });
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const HEAD = {}; FIELDS.forEach((f) => { HEAD[norm(f.label)] = f.key; HEAD[norm(f.key)] = f.key; });
  const isAdmin = () => S.role === 'Administrator';
  const LOCK_WHY = 'Administrators only: the Administrator owns the client master (G01)';
  // ENGINE.newClient keeps the whole row: the core fields on the client, the other Phase 1 fields in client.master.
  const KEPT = 'Every column is kept in the client master.';

  /* ---------- Templates ---------- */
  const fmtOf = (f) => ({ date: 'Date, YYYY-MM-DD', id: '13 digits', taxref: '10 digits', email: 'Email address', phone: 'Phone number', yesno: 'Yes or No',
    postcode: '4 digits', branch: '6 digits', account: 'Digits', choice: 'One of: ' + (f.choices || []).join(', ') }[f.kind] || 'Text');
  const reqOf = (f) => (f.req || f.key === 'id_number' || f.key === 'tax_ref' ? 'Required' : (f.key === 'provisional' ? 'Recommended (blank counts as No)' : 'Optional'));
  const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvTemplate = () => '﻿' + FIELDS.map((f) => csvCell(f.label)).join(',') + '\r\n';

  // A real .xlsx (Office Open XML): a stored (uncompressed) zip of the workbook parts. Every column is formatted as text, so ID
  // numbers, tax references and account numbers keep their leading zeros and never turn into scientific notation.
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
    files.forEach(({ name, text }) => {
      const nb = enc.encode(name); const data = enc.encode(text); const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0, true); h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0, true); c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true);
      c.setUint32(42, off, true);
      parts.push(new Uint8Array(h.buffer), nb, data); central.push(new Uint8Array(c.buffer), nb);
      off += 30 + nb.length + data.length;
    });
    const cdSize = central.reduce((n, b) => n + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const x = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
  const colName = (i) => { let s = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const cell = (ref, v, style) => `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  const row = (r, vals, style) => `<row r="${r}">${vals.map((v, i) => cell(colName(i) + r, v, style)).join('')}</row>`;
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  function xlsxTemplate() {
    const cols = FIELDS.map((f, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(40, Math.max(14, f.label.length + 4))}" style="2" customWidth="1"/>`).join('');
    const dv = FIELDS.map((f, i) => {
      const list = f.kind === 'yesno' ? ['Yes', 'No'] : (f.kind === 'choice' ? f.choices : null);
      if (!list) return '';
      const L = colName(i);
      return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${L}2:${L}${MAX_ROWS + 1}"><formula1>${x('"' + list.join(',') + '"')}</formula1></dataValidation>`;
    }).filter(Boolean);
    const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${row(1, FIELDS.map((f) => f.label), 1)}</sheetData>${dv.length ? `<dataValidations count="${dv.length}">${dv.join('')}</dataValidations>` : ''}</worksheet>`;
    const info = [['Client import template', ''], ['Firm', FIRM], ['How to use it', 'Fill in one row per client on the Clients sheet. Keep the header row as it is. Save the file as CSV UTF-8 (File > Save As) and upload it on the Import clients page, which checks every field before anything is created.'],
      ['Privacy', 'This sheet holds personal information. Send it only through the PaperSync portal, never by ordinary email.'], ['', '']];
    const head = ['Column', 'Group (master workflow document, Phase 1)', 'Required', 'Format', 'Notes'];
    const lines = FIELDS.map((f) => [f.label, ADM.GROUP_LABEL(f.grp), reqOf(f), fmtOf(f), f.hint || '']);
    const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ${NS}><cols><col min="1" max="1" width="40" customWidth="1"/><col min="2" max="2" width="40" customWidth="1"/><col min="3" max="3" width="28" customWidth="1"/><col min="4" max="4" width="40" customWidth="1"/><col min="5" max="5" width="60" customWidth="1"/></cols><sheetData>${info.map((r, i) => row(i + 1, r, i === 0 ? 1 : 0)).join('')}${row(info.length + 1, head, 1)}${lines.map((r, i) => row(info.length + 2 + i, r, 0)).join('')}</sheetData></worksheet>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    return zip([
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook ${NS}><sheets><sheet name="Clients" sheetId="1" r:id="rId1"/><sheet name="Instructions" sheetId="2" r:id="rId2"/></sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${R}/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/worksheets/sheet1.xml', text: sheet1 },
      { name: 'xl/worksheets/sheet2.xml', text: sheet2 },
      { name: 'xl/styles.xml', text: styles },
    ]);
  }

  /* ---------- Reading a CSV ---------- */
  // RFC 4180 with the delimiter Excel used (comma, or semicolon where the decimal separator is a comma, or tab); a UTF-8 BOM is dropped.
  function parseCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const n = (ch) => first.split(ch).length - 1;
    const delim = [',', ';', '\t'].reduce((best, ch) => (n(ch) > n(best) ? ch : best), ',');
    const rows = []; let r = []; let c = ''; let q = false; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch;
      } else if (ch === '"' && c === '' && !quoted) { q = true; quoted = true; }
      else if (ch === delim) { r.push(c); c = ''; quoted = false; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; r.push(c); rows.push(r); r = []; c = ''; quoted = false; }
      else c += ch;
    }
    if (q) return { error: 'A quoted value is not closed. Check the file was saved as CSV.' };
    if (c !== '' || r.length) { r.push(c); rows.push(r); }
    return { delim, rows: rows.filter((x) => x.some((v) => String(v).trim() !== '')) };
  }
  const digits = (v) => String(v || '').replace(/[\s-]/g, '');
  function luhnOk(id) {
    let sum = 0;
    for (let i = 0; i < id.length; i++) { let d = +id[id.length - 1 - i]; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    return sum % 10 === 0;
  }
  // YYYY-MM-DD, YYYY/MM/DD (Excel's South African format) or DD/MM/YYYY, to an ISO day.
  function isoDate(v) {
    const s = String(v || '').trim(); let m;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) return DATES.dt(m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0')) ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : null;
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) return DATES.dt(m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0')) ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : null;
    return null;
  }
  const YES = { yes: 'Yes', y: 'Yes', true: 'Yes', 1: 'Yes', ja: 'Yes', no: 'No', n: 'No', false: 'No', 0: 'No', nee: 'No' };

  function checkRow(raw, line, seen) {
    const v = {}; const errors = []; const warnings = [];
    FIELDS.forEach((f) => { v[f.key] = String(raw[f.key] == null ? '' : raw[f.key]).trim(); });
    FIELDS.forEach((f) => {
      const s = v[f.key]; const L = f.label;
      if (!s) { if (f.req) errors.push(L + ' is required.'); return; }
      if (s.length > 200) { errors.push(L + ' is longer than 200 characters.'); return; }
      if (/^[=@]/.test(s)) warnings.push(L + ' starts like a spreadsheet formula; it is kept as plain text.');
      switch (f.kind) {
        case 'date': { const d = isoDate(s); if (!d) errors.push(L + ': use YYYY-MM-DD.'); else v[f.key] = d; break; }
        case 'id': {
          const d = digits(s);
          if (!/^\d{13}$/.test(d)) { errors.push(L + ' must be 13 digits.'); break; }
          v[f.key] = d;
          if (!ADM.dobFromId(d)) errors.push(L + ': the first six digits are not a date of birth.');
          else if (!luhnOk(d)) warnings.push(L + ': the check digit does not match. Confirm it against the ID document (KYC-03 at onboarding).');
          break;
        }
        case 'taxref': { const d = digits(s); if (!/^\d{10}$/.test(d)) errors.push(L + ' must be 10 digits.'); else v[f.key] = d; break; }
        case 'email': if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) errors.push(L + ' is not an email address.'); break;
        case 'phone': { const d = s.replace(/[\s()-]/g, ''); if (!/^(\+27\d{9}|0\d{9}|\+\d{8,15})$/.test(d)) warnings.push(L + ' does not look like a phone number.'); break; }
        case 'choice': { const hit = f.choices.find((c) => c.toLowerCase() === s.toLowerCase()); if (hit) v[f.key] = hit; else warnings.push(L + ' is not one of: ' + f.choices.join(', ') + '.'); break; }
        case 'yesno': { const y = YES[s.toLowerCase()]; if (!y) errors.push(L + ': write Yes or No.'); else v[f.key] = y; break; }
        case 'postcode': if (!/^\d{4}$/.test(s)) warnings.push(L + ' is usually 4 digits.'); break;
        case 'branch': if (!/^\d{6}$/.test(digits(s))) warnings.push(L + ' is usually 6 digits.'); break;
        case 'account': if (!/^\d{5,16}$/.test(digits(s))) warnings.push(L + ' should be 5 to 16 digits.'); else v[f.key] = digits(s); break;
        default: break;
      }
    });
    if (!v.id_number && !v.passport_number) errors.push('RSA ID number is required.');
    else if (!v.id_number) errors.push('The preview’s client record needs an RSA ID number; passport-only clients are not supported yet.');
    if (!v.tax_ref) errors.push('Income tax reference number is required.');
    if (!v.provisional) warnings.push('Provisional taxpayer is blank: treated as No, which uses the earlier filing deadline.');
    if (v.id_number && v.date_of_birth && ADM.dobFromId(v.id_number) && ADM.dobFromId(v.id_number) !== v.date_of_birth) errors.push('Date of birth does not match the ID number.');
    if (!v.email && !v.mobile) warnings.push('No email address or cell number: the PaperSync portal needs one to reach the client.');
    if (!v.street && !v.city) warnings.push('No residential address yet: it is needed before G01 (KYC-01).');
    if (!v.bank && !v.account_number) warnings.push('No banking details yet: they are needed before G01 (KYC-01).');
    // Duplicates: against the client master, then within the file.
    const dupe = S.clients.find((c) => (v.id_number && c.idNo === v.id_number) || (v.tax_ref && c.taxRef === v.tax_ref));
    if (dupe) errors.push('Already in the client master as ' + dupe.id + '.');
    ['id_number', 'tax_ref'].forEach((k) => { if (!v[k]) return; const was = seen[k + '|' + v[k]]; if (was) errors.push(BY[k].label + ' is the same as on line ' + was + '.'); else seen[k + '|' + v[k]] = line; });
    return { line, v, errors, warnings, name: [v.first_name, v.surname].filter(Boolean).join(' ') };
  }
  function check(text, source) {
    IMP.err = ''; IMP.res = null; IMP.source = source; IMP.created = [];
    const p = parseCsv(text);
    if (p.error) { IMP.err = p.error; return; }
    if (!p.rows.length) { IMP.err = 'There is nothing to check. Paste the rows with their header line, or choose a CSV file.'; return; }
    const header = p.rows[0].map((h) => HEAD[norm(h)] || null);
    const unknown = p.rows[0].filter((h, i) => !header[i] && String(h).trim());
    const missing = FIELDS.filter((f) => f.req && !header.includes(f.key)).map((f) => f.label);
    if (!header.some(Boolean)) { IMP.err = 'The first line is not the template’s header row. Download the template and keep its header.'; return; }
    if (missing.length) { IMP.err = 'These columns are missing: ' + missing.join(', ') + '.'; return; }
    const body = p.rows.slice(1);
    if (!body.length) { IMP.err = 'The file has a header row but no clients.'; return; }
    if (body.length > MAX_ROWS) { IMP.err = 'Import at most ' + MAX_ROWS + ' clients at a time.'; return; }
    const seen = {};
    const rows = body.map((cells, i) => { const raw = {}; header.forEach((k, j) => { if (k) raw[k] = cells[j]; }); return checkRow(raw, i + 2, seen); });
    IMP.res = { rows, unknown, delim: p.delim, columns: header.filter(Boolean).length };
  }

  /* ---------- Screen ---------- */
  function templateBlock() {
    const rows = FIELDS.map((f) => [esc(f.label), esc(ADM.GROUP_LABEL(f.grp)), f.req || reqOf(f).startsWith('Required') ? `<strong>${esc(reqOf(f))}</strong>` : esc(reqOf(f)), `<span class="small">${esc(fmtOf(f))}${f.hint ? '<br><span class="muted">' + esc(f.hint) + '</span>' : ''}</span>`]);
    const btns = `<div class="actions">${btn('Download Excel template (.xlsx)', 'adm.tplXlsx', { cls: 'primary' })}${btn('Download CSV template', 'adm.tplCsv')}</div>
      <p class="small muted">${esc('The Excel template has the ' + FIELDS.length + ' columns on a Clients sheet, formatted as text so ID numbers and account numbers keep every digit, with drop-down lists for Yes/No answers and an Instructions sheet. The CSV opens in Excel with accents intact.')}</p>`;
    return VK.section('adm-import-template', 'Template for the client to fill in', btns + `<details class="adm-more"><summary>${esc('The ' + FIELDS.length + ' columns')}</summary>${VK.table([{ label: 'Column' }, { label: 'Group' }, { label: 'Required' }, { label: 'Format' }], rows, { caption: 'Template columns' })}</details>`, {
      intro: esc('One column per item in the master workflow document’s Phase 1 field groups (taxpayer identification, contact, address, marital, tax residency and banking), plus whether the client is a provisional taxpayer. This answers the partners’ note of 30 Oct.'),
    });
  }
  function uploadBlock() {
    const form = `<div class="adm-upload">
      <label class="f" for="adm-imp-file">Choose a CSV file<input id="adm-imp-file" type="file" accept=".csv,text/csv" data-on="adm.impFile"></label>
      <label class="f" for="adm-imp-text">Or paste the rows, header line first<textarea id="adm-imp-text" class="mono" rows="6" spellcheck="false" placeholder="Surname,First name,…">${esc(IMP.paste)}</textarea></label>
      <div class="actions">${btn('Check pasted rows', 'adm.impCheck', { cls: 'primary' })}${IMP.res || IMP.err ? btn('Clear', 'adm.impClear') : ''}</div>
      ${IMP.err ? `<p class="err" role="alert">${esc(IMP.err)}</p>` : ''}</div>`;
    return VK.section('adm-import-upload', 'Check a filled-in template', form, {
      intro: esc('Save the Excel template as CSV UTF-8 first. The file is read in this browser only; nothing is uploaded or sent anywhere. Every field is checked before anything is created.'),
    });
  }
  function checkBlock() {
    const R = IMP.res; if (!R) return '';
    const ready = R.rows.filter((r) => !r.errors.length); const bad = R.rows.length - ready.length;
    const msg = (r) => `${r.errors.map((t) => `<div class="adm-msg bad">${I.alert}<span>${esc(t)}</span></div>`).join('')}${r.warnings.map((t) => `<div class="adm-msg warn">${I.clock}<span>${esc(t)}</span></div>`).join('')}${!r.errors.length && !r.warnings.length ? '<span class="muted">No problems</span>' : ''}`;
    const rows = R.rows.map((r) => ({ cls: r.errors.length ? 'adm-diff' : '', cells: [esc(r.line), `<strong>${esc(r.name || '(no name)')}</strong>`,
      r.v.id_number ? `${VK.idHtml(r.v.id_number)}<div class="small">${r.v.tax_ref ? VK.taxRefHtml(r.v.tax_ref) : '<span class="muted">No tax reference</span>'}</div>` : '<span class="muted">No ID number</span>',
      r.errors.length ? VK.pill('Will be skipped', 'bad') : (r.warnings.length ? VK.pill('Ready, with warnings', 'warn') : VK.pill('Ready', 'ok')), msg(r)] }));
    const lock = isAdmin() ? null : LOCK_WHY;
    const create = ready.length ? btn('Create ' + plural(ready.length, 'client'), 'adm.impCreate', { cls: 'primary', lock }) : '';
    const summary = `<p class="adm-sum" role="status">${esc(plural(R.rows.length, 'row') + ' checked from ' + IMP.source + ': ' + ready.length + ' ready, ' + bad + ' with errors (skipped).')}${R.unknown.length ? ` <span class="muted">${esc('Columns ignored: ' + R.unknown.join(', ') + '.')}</span>` : ''}</p>`;
    return VK.section('adm-import-check', 'Field-by-field check', summary + VK.table([{ label: 'Line' }, { label: 'Client' }, { label: 'ID and tax reference' }, { label: 'Result' }, { label: 'What to fix' }], rows, { caption: 'Import check, row by row' }) + `<div class="adm-gateline"><span class="small muted">${esc('Clients are added to the permanent client master with every KYC document still to come; G01 waits for those documents. ' + KEPT)}</span>${create}</div>`, {
      count: R.rows.length,
    });
  }
  function createdBlock() {
    if (!IMP.created.length) return '';
    const items = IMP.created.map((id) => ENGINE.clientOf(id)).filter(Boolean).map((cl) => `<div class="vk-row-b"><div class="vk-row-t">${VK.clientLink(cl)} <span class="small muted">${esc(cl.id)}</span></div><div class="vk-meta">${VK.idHtml(cl.idNo)} ${VK.taxRefHtml(cl.taxRef)}<span>KYC: 0 of ${cl.kyc.length} documents</span></div></div>`);
    return VK.section('adm-import-done', 'Added to the client master', VK.list(items), { count: items.length, intro: esc('Each one is in the audit trail. Next: request their KYC documents through the PaperSync portal.'), actions: '<a href="#clients">Clients</a>' });
  }
  VIEWS.import = () => {
    const intro = esc('Bring clients into the permanent client master from a spreadsheet. Download the template, have it filled in, then check it here. All data in the preview is made up; do not use real client details.');
    return VK.page('Import clients', intro, templateBlock() + uploadBlock() + checkBlock() + createdBlock(), { key: 'adm-import' });
  };

  /* ---------- Actions ---------- */
  Object.assign(ACT, {
    'adm.tplXlsx': () => { ADM.download('client-import-template.xlsx', xlsxTemplate()); toast('Excel template downloaded.'); },
    'adm.tplCsv': () => { ADM.download('client-import-template.csv', csvTemplate(), 'text/csv;charset=utf-8'); toast('CSV template downloaded.'); },
    'adm.impCheck': () => {
      const ta = document.getElementById('adm-imp-text'); const text = ta ? ta.value : '';
      if (text.length > MAX_BYTES) { IMP.err = 'That is more than 1 MB of text. Import fewer clients at a time.'; IMP.res = null; render(); return; }
      IMP.paste = text; check(text, 'the pasted rows'); render();
    },
    'adm.impClear': () => { IMP.paste = ''; IMP.res = null; IMP.err = ''; IMP.source = ''; const ta = document.getElementById('adm-imp-text'); if (ta) ta.value = ''; S.noRestore = true; render(); },
    'adm.impCreate': () => {
      if (!IMP.res) return;
      const ready = IMP.res.rows.filter((r) => !r.errors.length);
      if (!isAdmin()) { toast('Not done: ' + LOCK_WHY + '.'); return; }
      modal('Create ' + plural(ready.length, 'client'), `<p>Add these clients to the permanent client master?</p><ul class="adm-items">${ready.slice(0, 30).map((r) => `<li>${esc(r.name)} · ${VK.idHtml(r.v.id_number)}</li>`).join('')}</ul>${ready.length > 30 ? `<p class="small muted">${esc('and ' + (ready.length - 30) + ' more')}</p>` : ''}
        <p class="hint">Rows with errors are skipped. Each client starts with every KYC document outstanding. ${esc(KEPT)} Operon records each new client in the audit trail.</p>`, 'Create ' + plural(ready.length, 'client'), () => {
        if (!isAdmin()) return 'Not done: ' + LOCK_WHY + '.';
        const ids = [];
        ready.forEach((r) => {
          const v = r.v; const master = {}; FIELDS.forEach((f) => { if (v[f.key]) master[f.key] = v[f.key]; });
          const cl = ENGINE.newClient({ name: [v.first_name, v.surname].filter(Boolean).join(' '), idNo: v.id_number, taxRef: v.tax_ref, provisional: v.provisional === 'Yes',
            email: v.email || null, kyc: Object.fromEntries(ENGINE.KYC_ITEMS.map((k) => [k.key, false])), master }, ACTOR.me());  // the engine refuses anyone but an Administrator
          if (cl && cl.id && cl.ok !== false) ids.push(cl.id);
        });
        IMP.created = ids; IMP.res = null; IMP.paste = ''; IMP.source = '';
        return () => { toast('Added ' + plural(ids.length, 'client') + ' to the client master.'); S.noRestore = true; render(); };
      });
    },
  });
  EXT_FIELD['adm.impFile'] = (el) => {
    const f = el.files && el.files[0]; if (!f) return false;
    if (!/\.csv$/i.test(f.name)) { IMP.err = /\.xlsx?$/i.test(f.name) ? 'That is an Excel file. In Excel, use File > Save As > CSV UTF-8, then choose the .csv file.' : 'Choose a .csv file.'; IMP.res = null; return; }
    if (f.size > MAX_BYTES) { IMP.err = 'That file is larger than 1 MB. Import fewer clients at a time.'; IMP.res = null; return; }
    f.text().then((t) => { check(t, f.name); render(); }, () => { IMP.err = 'The file could not be read.'; render(); });
    return false;
  };
})();
