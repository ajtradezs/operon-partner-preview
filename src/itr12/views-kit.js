/* Shared helpers for the ITR12 screens (views-*.js). Loaded after engine.js and seed.js, before the screens.
   Views only read state: every change goes through ENGINE with ACTOR.me(), and the shared actions below (ACT 'vk.*') are the
   only place the kit asks ENGINE to change anything. Every dynamic value goes through esc(); links are built only from ids
   that match [A-Za-z0-9], so data never reaches an href.
   Conventions for screens:
     - VK.page(title, intro, body, { key }) gives the page heading (data-rv-key '<key>-head').
     - Every block is VK.section(key, title, body, opts) with an explicit data-rv-key, so review notes and layouts survive rewording.
     - Tables go through VK.table(): at 760px and below each row becomes a labelled card, so the page never scrolls sideways. */
const VK = (() => {
  /* ---------- ids, names and links ---------- */
  const ID_RX = /^[A-Za-z0-9]{1,40}$/;
  const safeId = (v) => (ID_RX.test(String(v == null ? '' : v)) ? String(v) : '');
  const caseOf = (c) => (c && typeof c === 'object' ? c : ENGINE.caseById(c));
  const clientOf = (cl) => (cl && typeof cl === 'object' ? cl : (cl ? ENGINE.clientOf(String(cl)) : null));
  const exOf = (x) => (x && typeof x === 'object' ? x : ENGINE.exById(x));
  const clientName = (cl) => { const k = clientOf(cl); return k ? k.name : String(cl || ''); };
  // A link to #<route>-<id>; plain text when the id is not a safe app id.
  function link(route, id, label, o) {
    const sid = safeId(id); const text = esc(label == null ? id : label);
    if (!sid) return text;
    return `<a href="#${route}-${sid}"${o && o.cls ? ` class="${esc(o.cls)}"` : ''}${o && o.title ? ` title="${esc(o.title)}"` : ''}>${text}</a>`;
  }
  const caseLink = (c, label) => { const k = caseOf(c); const id = k ? k.id : c; return link('case', id, label == null ? id : label); };
  const clientLink = (cl, label) => { const k = clientOf(cl); const id = k ? k.id : cl; return link('client', id, label == null ? (k ? k.name : id) : label); };
  const exLink = (x, label) => { const k = exOf(x); const id = k ? k.id : x; return link('exception', id, label == null ? id : label); };
  // "C10 · Tebogo Sithole", both linked.
  const caseWho = (c) => { const k = caseOf(c); if (!k) return '<span class="muted">No case</span>'; return `${caseLink(k)} <span class="muted" aria-hidden="true">·</span> ${clientLink(k.clientId)}`; };
  // A person, the client (portal) or a simulated actor, as plain text.
  function who(id) {
    if (!id) return '';
    const p = S.people.find((x) => x.id === id) || PEOPLE0.find((x) => x.id === id);
    if (p) return p.name;
    const cl = S.clients.find((x) => x.id === id);
    return cl ? cl.name + ' (PaperSync portal)' : String(id);
  }

  /* ---------- masked identities ---------- */
  // An ID number shows only its first 6 digits (the date of birth); a tax reference only its last 4.
  const maskId = (v) => { const s = String(v == null ? '' : v).replace(/\s/g, ''); return s.length <= 6 ? '•'.repeat(s.length) : s.slice(0, 6) + '•'.repeat(s.length - 6); };
  const maskTaxRef = (v) => { const s = String(v == null ? '' : v).replace(/\s/g, ''); return s.length <= 4 ? '•'.repeat(s.length) : '•'.repeat(s.length - 4) + s.slice(-4); };
  // A client with no RSA ID number (a passport-only client) shows that plainly instead of an empty mask.
  const idHtml = (v) => (String(v == null ? '' : v).trim() ? `<span class="mono vk-masked" title="ID number, masked: only the date of birth shows">${esc(maskId(v))}</span>` : '<span class="muted">No RSA ID number</span>');
  const taxRefHtml = (v) => `<span class="mono vk-masked" title="Tax reference, masked: only the last 4 digits show">${esc(maskTaxRef(v))}</span>`;
  // Free text from the audit trail, notes and file names: any 13-digit run (an ID number) or 10-digit run (a tax reference) is
  // masked, even inside a word or next to an underscore (IRP5_9061007331_2026.pdf), so digit lookarounds are used, not \b.
  // A calendar day written YYYY-MM-DD reads as a date (12 Nov 2026); an invalid one is left as it was received.
  const isoDay = (m) => { const d = DATES.dt(m) ? toDay(m) : null; return d ? fDate(d) : m; };
  const scrub = (t) => String(t == null ? '' : t).replace(/(?<!\d)\d{13}(?!\d)/g, maskId).replace(/(?<!\d)\d{10}(?!\d)/g, maskTaxRef)
    .replace(/(?<![\d-])\d{4}-\d{2}-\d{2}(?![\d-])/g, isoDay);

  /* ---------- money and dates ---------- */
  const money = (n) => (n == null || n === '' || !isFinite(+n) ? '<span class="muted">—</span>' : `<span class="num">${esc(CALC.rand(+n))}</span>`);
  // A Date, or a calendar day 'YYYY-MM-DD' (read as a local day, so no time zone shifts it).
  function toDay(v) {
    if (v instanceof Date) return isNaN(v) ? null : v;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const date = (v) => { const d = toDay(v); return d ? esc(fDate(d)) : '<span class="muted">—</span>'; };
  const dateShort = (v) => { const d = toDay(v); return d ? esc(fShort(d)) : '<span class="muted">—</span>'; };
  const when = (d) => (d instanceof Date && !isNaN(d) ? `<time datetime="${esc(d.toISOString())}">${esc(fWhen(d))}</time>` : '<span class="muted">—</span>');
  const datebox = (v) => { const d = toDay(v); return d ? `<span class="datebox" aria-hidden="true"><b>${d.getDate()}</b>${esc(MON[d.getMonth()])}</span>` : '<span class="datebox" aria-hidden="true">—</span>'; };
  // Business days from today (the demo clock) to a calendar day; negative when it has passed. ch9 skips 16 Dec to 15 Jan.
  const bizLeft = (iso, ch9) => { const d = DATES.dt(String(iso || '')); return d ? DATES.businessDaysBetween(DATES.fromLocal(now()), d, { ch9: !!ch9 }) : null; };
  function leftText(n) {
    if (n == null) return 'No date';
    if (n < 0) return plural(-n, 'business day') + ' overdue';
    if (n === 0) return 'Due today';
    return 'In ' + plural(n, 'business day');
  }
  const leftPill = (n) => pill(leftText(n), n == null ? '' : (n < 0 ? 'bad' : (n <= 2 ? 'warn' : 'info')));

  /* ---------- chips and pills ---------- */
  const pill = (text, tone) => `<span class="pill${tone ? ' ' + esc(tone) : ''}">${esc(text)}</span>`;
  const sevChip = (sev, o) => {
    const s = SEV.includes(sev) ? sev : 'S4';
    return `<span class="vk-sev vk-${s.toLowerCase()}" title="Severity ${esc(SEV_LABEL[s])}">${esc(o && o.short ? s : SEV_LABEL[s])}</span>`;
  };
  // An exception code with its register title as the tooltip; linked to the exception when one is given.
  function codeChip(code, x) {
    const def = CODE[code]; const tip = def ? code + ': ' + def.title : String(code);
    const inner = esc(code);
    const k = x ? exOf(x) : null;
    return k && safeId(k.id) ? `<a class="vk-code" href="#exception-${k.id}" title="${esc(tip + ' (' + k.id + ')')}">${inner}</a>` : `<span class="vk-code" title="${esc(tip)}">${inner}</span>`;
  }
  // Gate states come from ENGINE.gateState. 'in progress' with an exception stopping it reads Blocked.
  const STATE = {
    released: ['Released', 'done'], 'released, awaiting SARS': ['Released, awaiting SARS', 'sars'], ready: ['Ready', 'ready'],
    'in progress': ['In progress', 'prog'], 'not started': ['Not started', 'idle'], invalidated: ['Re-opened', 'reopen'], 'n/a': ['Not needed', 'na'],
  };
  function gateStateWord(st) {
    const s = st && STATE[st.state] ? st.state : 'not started';
    if (s === 'in progress' && st.blockers && st.blockers.length) return ['Blocked', 'blocked'];
    return STATE[s];
  }
  function gateChip(c, g, o) {
    const k = caseOf(c); const st = k ? ENGINE.gateState(k, g) : null; const [word, cls] = gateStateWord(st);
    const tip = g + ': ' + (GATE[g] ? GATE[g].control : '') + ' (' + word + ')';
    return `<span class="vk-gate vk-g-${cls}" title="${esc(tip)}"><b>${esc(g)}</b>${o && o.bare ? '' : ' ' + esc(word)}</span>`;
  }
  const gateName = (g) => (GATE[g] ? GATE[g].control : String(g));
  const EX_STATUS = { raised: ['Raised', 'warn'], assigned: ['Assigned', 'info'], 'awaiting client': ['Awaiting client', 'warn'], resolved: ['Resolved, to close', 'ok'], closed: ['Closed', ''] };
  const exStatus = (x) => { const k = exOf(x); const s = EX_STATUS[k && k.status] || [k ? k.status : '', '']; return pill(s[0], s[1]); };

  /* ---------- layout ---------- */
  // The page heading. title is text; intro is HTML the caller has already escaped. o.key names the heading block (<key>-head).
  function page(title, intro, body, o) {
    o = o || {};
    const key = o.key || routeOf().name;
    return `<div class="stack vk-page"><div class="pagehead" data-rv-key="${esc(key)}-head"><div class="vk-headtext"><h1>${esc(title)}</h1>${intro ? `<p class="muted">${intro}</p>` : ''}</div>${o.actions ? `<div class="actions">${o.actions}</div>` : ''}</div>${body || ''}</div>`;
  }
  // A card section with an explicit review key. opts: count (shown beside the title), intro (HTML), actions (HTML), cls.
  function section(key, title, body, opts) {
    opts = opts || {};
    const count = opts.count != null ? `<span class="count${opts.count ? '' : ' zero'}" aria-label="${esc(opts.count)} items">${esc(opts.count)}</span>` : '';
    return `<section class="card vk-sec${opts.cls ? ' ' + esc(opts.cls) : ''}" data-rv-key="${esc(key)}"><header class="vk-sec-h"><h2>${esc(title)}</h2>${count}${opts.actions ? `<span class="vk-sec-a">${opts.actions}</span>` : ''}</header>${opts.intro ? `<p class="vk-sec-intro">${opts.intro}</p>` : ''}${body || ''}</section>`;
  }
  // columns: [{ label, cls }] or labels. rows: arrays of cell HTML, or { cells, cls }. On phones each row becomes a labelled card
  // (opts.phone 'scroll' keeps the table and scrolls it inside its own box instead). opts: key, caption, empty, cls.
  function table(columns, rows, opts) {
    opts = opts || {};
    const cols = columns.map((c) => (typeof c === 'string' ? { label: c } : c));
    if (!rows.length) return empty(opts.empty || 'Nothing to show.');
    const head = cols.map((c) => `<th scope="col"${c.cls ? ` class="${esc(c.cls)}"` : ''}>${c.label ? esc(c.label) : '<span class="sr">Actions</span>'}</th>`).join('');
    const body = rows.map((r) => {
      const cells = Array.isArray(r) ? r : r.cells;
      return `<tr${r.cls ? ` class="${esc(r.cls)}"` : ''}>${cells.map((h, i) => { const c = cols[i] || {}; return `<td data-label="${esc(c.label || '')}"${c.cls ? ` class="${esc(c.cls)}"` : ''}><div class="vk-cell">${h == null ? '' : h}</div></td>`; }).join('')}</tr>`;
    }).join('');
    return `<div class="tablewrap vk-tablewrap${opts.phone === 'scroll' ? '' : ' vk-cards'}${opts.cls ? ' ' + esc(opts.cls) : ''}"${opts.key ? ` data-rv-key="${esc(opts.key)}"` : ''}><table>${opts.caption ? `<caption class="sr">${esc(opts.caption)}</caption>` : ''}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  // An empty state. text is plain text; o.html adds escaped-by-caller HTML (a hint or a link).
  const empty = (text, o) => `<div class="vk-empty">${I.check}<div><p>${esc(text)}</p>${o && o.html ? o.html : ''}</div></div>`;
  // A plain list of rows: items are HTML strings. o.cls adds a modifier class.
  const list = (items, o) => (items.length ? `<ul class="vk-list${o && o.cls ? ' ' + esc(o.cls) : ''}">${items.map((h) => `<li>${h}</li>`).join('')}</ul>` : empty((o && o.empty) || 'Nothing to show.'));

  // The phase/gate tracker for one case: the board's columns in order, each with its gates' states. Wraps on phones.
  function tracker(c) {
    const k = caseOf(c); if (!k) return '';
    const cur = ENGINE.currentGate(k); const col = ENGINE.columnOf(k);
    return `<ol class="vk-track" aria-label="Gates for ${esc(k.id)}">${BOARD.map((b) => {
      const gates = b.gates.map((g) => { const st = ENGINE.gateState(k, g); const [word, cls] = gateStateWord(st);
        return `<li class="vk-tk vk-g-${cls}${g === cur ? ' now' : ''}" title="${esc(g + ': ' + gateName(g))}"><b>${esc(g)}</b><span>${esc(word)}</span></li>`; }).join('');
      return `<li class="vk-tcol${b.key === col ? ' now' : ''}"${b.key === col ? ' aria-current="step"' : ''}><span class="vk-tcol-h">${esc(b.label)}</span><ol>${gates}</ol></li>`;
    }).join('')}</ol>`;
  }

  /* ---------- results ---------- */
  // After an ENGINE call: toast the outcome (the refusal reason when result.ok is false) and render. Returns result.ok.
  function done(result, okMessage) {
    const ok = !!(result && result.ok);
    toast(ok ? okMessage : 'Not done: ' + ((result && result.why) || 'Operon refused this.'));
    render();
    return ok;
  }

  /* ---------- lists more than one screen needs ---------- */
  const actorFor = (role) => (role === S.role ? ACTOR.me() : ACTOR.as(role));
  // Does a register owner string name this role? "AI Agent; Tax Consultant for exceptions" and "Integration Administrator +
  // substantive gate owner" name two (the substantive gates belong to the Tax Consultant). "Records/Compliance Owner" is one role.
  function ownedBy(owner, role) {
    return String(owner || '').split(/\s*;\s*|\s+\+\s+|\s+\/\s+/).some((p) => p === role || p.startsWith(role + ' ') || (p === 'substantive gate owner' && role === 'Tax Consultant'));
  }
  // The gates waiting for a role, ready ones first. Kinds: 'gate' (release with ENGINE.release), 'g18' (a transaction awaiting this
  // role's G18 sign-off) and 'incident' (G17, closed on the Incidents screen). AI gates count only once the AI has routed them to
  // the consultant; G16 only once its retention review date is reached.
  function waitingGates(role) {
    role = role || S.role;
    const a = actorFor(role); const out = []; const today = ENGINE.isoDay(now());
    S.cases.forEach((c) => {
      if (c.archived) return;
      ENGINE.seq(c).forEach((g) => {
        if (g === 'G18' || c.gates[g].status === 'released') return;
        const rel = RELEASE[g];
        if (!rel || !(rel.by === 'role' || rel.by === 'ai') || rel.role !== role) return;
        if (ENGINE.pendingBefore(c, g).length) return;
        if (rel.by === 'ai' && !c.gates[g].routed) return;
        if (g === 'G16' && !(c.retention.review && today >= c.retention.review)) return;
        const r = ENGINE.canRelease(c, g, a);
        out.push({ kind: 'gate', key: c.id + '-' + g, c, g, ready: r.ok, why: r.why, blockers: r.blockers, missing: r.missing, label: gateName(g) });
      });
    });
    if (RELEASE.G18.roles.includes(role)) {
      S.txs.filter((t) => t.status === 'awaiting G18' && !t.signoffs.some((s) => s.role === role)).forEach((t) => {
        const c = ENGINE.caseById(t.caseId); if (!c) return;
        const bad = ENGINE.g18Checks(t).filter((k) => !k.ok); const gb = ENGINE.g18Blockers(t);
        const why = [bad.length ? 'Check ' + bad.map((k) => k.n + ' fails (' + k.why + ')').join('; ') : '', gb.length ? 'Blocked by ' + gb.join(', ') : ''].filter(Boolean).join('; ');
        const other = t.signoffs.map((s) => pname(s.id) + ' (' + s.role + ') has signed');
        out.push({ kind: 'g18', key: t.id, c, g: 'G18', tx: t, ready: !why, why, blockers: [], missing: [], label: 'Sign G18 for ' + t.id + ' (' + t.label + ')', note: other.join('; ') });
      });
    }
    if (role === RELEASE.G17.role) {
      S.incidents.filter((i) => i.status === 'open').forEach((inc) => {
        const left = Object.keys(ENGINE.INCIDENT_STEPS).filter((k) => !inc.steps[k]).map((k) => ENGINE.INCIDENT_STEPS[k]);
        out.push({ kind: 'incident', key: inc.id, c: inc.caseId ? ENGINE.caseById(inc.caseId) : null, g: 'G17', inc, ready: !left.length,
          why: left.length ? 'Still to record: ' + left.join(', ') : '', blockers: [], missing: left, label: 'Close incident ' + inc.id + ' (' + inc.codes.join(', ') + ')' });
      });
    }
    return out.sort((p, q) => (p.ready === q.ready ? (p.c ? p.c.id : '').localeCompare(q.c ? q.c.id : '') : (p.ready ? -1 : 1)));
  }
  // Exceptions waiting for a role: open ones its role owns ('resolve'), and resolved ones it closes as secondary reviewer ('close').
  // o.sev limits severities, e.g. ['S1', 'S2']. Sorted by severity, then oldest first.
  function myExceptions(role, o) {
    role = role || S.role; o = o || {};
    const out = [];
    S.exceptions.forEach((x) => {
      if (o.sev && !o.sev.includes(x.sev)) return;
      if (ENGINE.isOpen(x) && ownedBy(x.owner, role)) out.push({ x, need: 'resolve' });
      else if (x.status === 'resolved' && x.secondary === role) out.push({ x, need: 'close' });
    });
    return out.sort((p, q) => (SEV.indexOf(p.x.sev) - SEV.indexOf(q.x.sev)) || (p.x.at - q.x.at));
  }
  // Deadlines up to o.days business days ahead (default 10), overdue ones included. From the case (filing season close, Declaration
  // Alert, verification and audit due dates, the remedy's statutory deadline, PaperSync reminders running out) and from open
  // exceptions (SARS deadline, client due date). One row per case and day; the codes due that day are merged into it.
  function deadlines(o) {
    o = o || {};
    const days = o.days == null ? 10 : o.days;
    const rows = []; const at = {};
    const add = (iso, what, c, extra) => {
      extra = extra || {};
      const left = bizLeft(iso, extra.ch9); if (left == null || left > days) return null;
      const k = (c ? c.id : 'none') + '|' + iso;
      if (at[k]) { (extra.codes || []).forEach((y) => { if (!at[k].codes.some((z) => z.id === y.id)) at[k].codes.push(y); }); return at[k]; }
      const row = { key: k, date: iso, left, what, c: c || null, codes: (extra.codes || []).slice(), kind: extra.kind || 'case', ch9: !!extra.ch9, source: extra.source || '' };
      at[k] = row; rows.push(row); return row;
    };
    S.cases.forEach((c) => {
      if (c.archived) return;
      if (!(c.submission && c.submission.ok) && c.year === FILING_2026.year) {
        const f = c.filing === 'provisional' ? FILING_2026.provisional : FILING_2026.nonProvisional;
        add(f.closes, 'ITR12 filing season closes (' + f.label.toLowerCase() + ')', c, { kind: 'filing', source: 'SARS filing season 2026' });
      }
      if (c.da && c.da.due && !c.da.submitted && !c.da.moved) add(c.da.due, 'Declaration Alert response due (' + c.da.ref + ')', c, { kind: 'sars', source: 'SARS notice' });
      if (c.vrf && c.vrf.due && !c.vrf.uploaded) add(c.vrf.due, 'Verification documents due (' + c.vrf.ref + ')', c, { kind: 'sars', source: 'SARS notice' });
      if (c.aud && c.aud.due && !c.aud.uploaded) add(c.aud.due, 'Audit response due (' + c.aud.ref + ')', c, { kind: 'sars', source: 'SARS notice' });
      if (c.remedy && c.remedy.deadline && !ENGINE.stepDone(c, 'G15')) {
        const p = PERIODS[c.remedy.route];
        add(c.remedy.deadline, (p ? p.label : 'Remedy') + ' due', c, { kind: 'remedy', ch9: true, source: p ? p.rule : '' });
      }
      c.reminders.filter((r) => r.status === 'sent').forEach((r) => add(ENGINE.isoDay(r.expires), 'PaperSync ' + r.kind + ' reminder runs out (policy pending Johan)', c, { kind: 'reminder', source: 'Firm policy' }));
    });
    S.exceptions.forEach((x) => {
      if (!ENGINE.isOpen(x)) return;
      const c = x.caseId ? ENGINE.caseById(x.caseId) : null;
      if (c && c.archived) return;
      if (x.sarsDeadline) add(x.sarsDeadline, x.code + ' ' + x.title, c, { kind: 'exception', codes: [x], ch9: /^REM-/.test(x.code), source: 'SARS deadline' });
      if (x.clientDue) add(x.clientDue, 'Client action due: ' + x.code + ' ' + x.title, c, { kind: 'client', codes: [x], source: 'Client due date' });
    });
    return rows.sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : (p.c ? p.c.id : '').localeCompare(q.c ? q.c.id : '')));
  }

  /* ---------- shared actions ---------- */
  // Modal flows keep the dialog open with the refusal reason; success closes it, toasts and renders.
  const finish = (r, okMessage) => (r && r.ok ? () => done(r, okMessage) : 'Not done: ' + ((r && r.why) || 'Operon refused this.'));
  const facts = (pairs) => `<dl class="facts">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;

  // Release a gate (data-case, data-gate). For G18, data-tx names the transaction this role signs.
  function actRelease(t) {
    const c = ENGINE.caseById(t.dataset.case); const g = t.dataset.gate;
    if (!c || !GATE[g]) { toast('That case or gate is no longer here.'); render(); return; }
    const cl = ENGINE.clientOf(c);
    if (g === 'G18') {
      const tx = ENGINE.txById(t.dataset.tx);
      if (!tx || tx.caseId !== c.id) { toast('That SARS transaction is no longer here.'); render(); return; }
      const checks = ENGINE.g18Checks(tx); const gb = ENGINE.g18Blockers(tx);
      modal('Sign G18 for ' + tx.id, `${facts([['Case', esc(c.id) + ' · ' + esc(cl.name)], ['Transaction', esc(tx.id + ' · ' + tx.label + ' · version ' + tx.version)],
        ['Signed so far', tx.signoffs.length ? esc(tx.signoffs.map((s) => pname(s.id) + ' (' + s.role + ')').join(', ')) : 'Nobody yet']])}
        <ol class="vk-checks">${checks.map((k) => `<li class="${k.ok ? 'ok' : 'bad'}">${k.ok ? I.check : I.alert}<span>${esc(k.label)}${k.ok ? '' : `<br><span class="err">${esc(scrub(k.why))}</span>`}</span></li>`).join('')}</ol>
        ${gb.length ? `<p class="err">Blocked by ${esc(gb.join(', '))}</p>` : ''}
        <p class="hint">G18 needs two different people: the Integration Administrator and the Tax Consultant. Nothing is sent to SARS: the link is simulated.</p>`,
      'Sign G18', () => finish(ENGINE.signG18(tx, ACTOR.me()), 'Signed G18 for ' + tx.id + '.'));
      return;
    }
    const cr = ENGINE.canRelease(c, g, ACTOR.me());
    modal('Release ' + g + ' for ' + c.id, `${facts([['Gate', esc(g + ' · ' + gateName(g))], ['Case', esc(c.id) + ' · ' + esc(cl.name)], ['Version', esc(ENGINE.vN(c) || 'none yet')]])}
      ${GATE[g].criterion ? `<p class="small"><span class="muted">Release when:</span> ${esc(GATE[g].criterion)}</p>` : ''}
      ${cr.ok ? `<p class="vk-okline">${I.check} Every check for ${esc(g)} passes.</p>` : `<p class="err">${esc(scrub(cr.why))}</p>`}
      <label class="f" for="vk-rel-ev">Note or evidence (optional)<input id="vk-rel-ev" name="evidence" maxlength="300" autocomplete="off"></label>
      <p class="hint">You release it as ${esc(S.role)} (${esc(me().name)}). Operon records it in the audit trail.</p>`,
    'Release ' + g, (fd) => finish(ENGINE.release(c, g, ACTOR.me(), { evidence: String(fd.evidence || '').trim() }), 'Released ' + g + ' for ' + c.id + '.'));
  }
  // Resolve an exception: the action taken (required) and optional evidence.
  function actResolve(t) {
    const x = ENGINE.exById(t.dataset.ex);
    if (!x) { toast('That exception is no longer here.'); render(); return; }
    const c = x.caseId ? ENGINE.caseById(x.caseId) : null; const def = CODE[x.code] || {};
    const guard = ENGINE.resolveGuard(c, x);
    modal('Resolve ' + x.id, `<p class="row">${codeChip(x.code)}${sevChip(x.sev)}<strong>${esc(x.title)}</strong></p>
      ${facts([['Case', c ? esc(c.id) + ' · ' + esc(clientName(c.clientId)) : 'No case'], ['Resolved when', esc(def.resolution || '')]])}
      ${x.note ? `<p class="note">${esc(scrub(x.note))}</p>` : ''}
      ${guard ? `<p class="err">${esc(scrub(guard))}</p>` : ''}
      <label class="f" for="vk-res-action">What was done (required)<textarea id="vk-res-action" name="action" maxlength="1000"></textarea></label>
      <label class="f" for="vk-res-ev">Evidence (optional)<input id="vk-res-ev" name="evidence" maxlength="300" autocomplete="off" placeholder="A file name or reference"></label>
      ${x.secondary ? `<p class="hint">A different person in the ${esc(x.secondary)} role then closes it as secondary reviewer. It keeps blocking until then.</p>` : ''}`,
    'Resolve', (fd) => {
      const action = String(fd.action || '').trim();
      if (!action) return 'Write what was done.';
      return finish(ENGINE.resolve(x, ACTOR.me(), { action, evidence: String(fd.evidence || '').trim() || null }), 'Resolved ' + x.id + ' (' + x.code + ').');
    });
  }
  // Close a resolved exception as the secondary reviewer (a different person from the resolver).
  function actClose(t) {
    const x = ENGINE.exById(t.dataset.ex);
    if (!x) { toast('That exception is no longer here.'); render(); return; }
    const c = x.caseId ? ENGINE.caseById(x.caseId) : null;
    modal('Close ' + x.id + ' as secondary reviewer', `<p class="row">${codeChip(x.code)}${sevChip(x.sev)}<strong>${esc(x.title)}</strong></p>
      ${facts([['Case', c ? esc(c.id) + ' · ' + esc(clientName(c.clientId)) : 'No case'], ['Resolved by', esc(x.resolvedBy || '')], ['What was done', esc(scrub(x.resolution || ''))], ['Evidence', esc(scrub(x.evidence || 'None given'))]])}
      <label class="f" for="vk-close-note">Review note (optional)<input id="vk-close-note" name="note" maxlength="300" autocomplete="off"></label>
      <p class="hint">Close it only if the resolution meets the register’s criterion. You must not be the person who resolved it.</p>`,
    'Close exception', (fd) => finish(ENGINE.close(x, ACTOR.me(), { note: String(fd.note || '').trim() }), 'Closed ' + x.id + ' (' + x.code + ').'));
  }
  // The register gives some codes to a platform role (AI-07, AI-06, VER-02) or a platform secondary reviewer (TAX-06). The platform
  // team works outside the firm, so the preview simulates it: anyone may press the button, and ENGINE records the simulated
  // ACTOR.platform(<that role>), never the signed-in person.
  const isPlatform = (role) => /^Platform /.test(String(role || ''));
  const SIM_NOTE = 'In real life the platform team does this outside Operon. Here it is simulated: Operon records it as the platform team, not as you.';
  function actPlatResolve(t) {
    const x = ENGINE.exById(t.dataset.ex);
    if (!x || !isPlatform(x.owner)) { toast('That exception is no longer here.'); render(); return; }
    const c = x.caseId ? ENGINE.caseById(x.caseId) : null; const def = CODE[x.code] || {};
    const guard = ENGINE.resolveGuard(c, x);
    modal('Resolve ' + x.id + ' as the simulated platform team', `<p class="row">${codeChip(x.code)}${sevChip(x.sev)}<strong>${esc(x.title)}</strong></p>
      ${facts([['Case', c ? esc(c.id) + ' · ' + esc(clientName(c.clientId)) : 'No case'], ['Owner', esc(x.owner + ' (simulated platform team)')], ['Resolved when', esc(def.resolution || '')]])}
      ${guard ? `<p class="err">${esc(scrub(guard))}</p>` : ''}
      <label class="f" for="vk-pres-action">What the platform team did (required)<textarea id="vk-pres-action" name="action" maxlength="1000"></textarea></label>
      <label class="f" for="vk-pres-ev">Evidence (optional)<input id="vk-pres-ev" name="evidence" maxlength="300" autocomplete="off" placeholder="A file name or reference"></label>
      <p class="hint">${esc(SIM_NOTE)}${x.secondary ? esc(' A ' + x.secondary + ' then closes it as secondary reviewer.') : ''}</p>`,
    'Resolve as the platform team', (fd) => {
      const action = String(fd.action || '').trim();
      if (!action) return 'Write what the platform team did.';
      return finish(ENGINE.resolve(x, ACTOR.platform(x.owner), { action, evidence: String(fd.evidence || '').trim() || null }), 'Resolved ' + x.id + ' (' + x.code + ') as the simulated ' + x.owner + '.');
    });
  }
  function actPlatClose(t) {
    const x = ENGINE.exById(t.dataset.ex);
    if (!x || !isPlatform(x.secondary)) { toast('That exception is no longer here.'); render(); return; }
    const c = x.caseId ? ENGINE.caseById(x.caseId) : null;
    modal('Close ' + x.id + ' as the simulated platform team', `<p class="row">${codeChip(x.code)}${sevChip(x.sev)}<strong>${esc(x.title)}</strong></p>
      ${facts([['Case', c ? esc(c.id) + ' · ' + esc(clientName(c.clientId)) : 'No case'], ['Secondary reviewer', esc(x.secondary + ' (simulated platform team)')], ['Resolved by', esc(x.resolvedBy || '')], ['What was done', esc(scrub(x.resolution || ''))]])}
      <label class="f" for="vk-pclose-note">Review note (optional)<input id="vk-pclose-note" name="note" maxlength="300" autocomplete="off"></label>
      <p class="hint">${esc(SIM_NOTE)}</p>`,
    'Close as the platform team', (fd) => finish(ENGINE.close(x, ACTOR.platform(x.secondary), { note: String(fd.note || '').trim() }), 'Closed ' + x.id + ' (' + x.code + ') as the simulated ' + x.secondary + '.'));
  }
  Object.assign(ACT, { 'vk.release': actRelease, 'vk.resolve': actResolve, 'vk.close': actClose, 'vk.platResolve': actPlatResolve, 'vk.platClose': actPlatClose });

  // Buttons for the shared actions. A row from waitingGates() or myExceptions() picks the right one; locked buttons say why.
  function releaseBtn(row) {
    if (row.kind === 'incident') return safeId(row.inc.id) ? `<a class="btn sm" href="#incident-${row.inc.id}">Open ${esc(row.inc.id)}</a>` : '';
    const label = row.kind === 'g18' ? 'Sign G18' : 'Release ' + row.g;
    const data = { case: row.c.id, gate: row.g }; if (row.tx) data.tx = row.tx.id;
    return btn(label, 'vk.release', { cls: 'sm' + (row.ready ? ' primary' : ''), data, title: row.ready ? '' : row.why });
  }
  // Resolve, or Close as the secondary reviewer. Only the role that may act gets a live button; everyone else sees a lock saying
  // who acts. Platform-owned codes get the simulated platform team's button instead (any role may press it; ENGINE records the
  // platform actor).
  function exceptionBtn(row) {
    const x = row.x; const a = ACTOR.me();
    if (row.need === 'close') {
      if (x.status !== 'resolved') return '';
      if (!x.secondary) return `<span class="lock">${I.hourglass}${esc('Closes by itself when its gates are done')}</span>`;
      if (isPlatform(x.secondary)) return btn('Close as the simulated platform team', 'vk.platClose', { cls: 'sm', data: { ex: x.id }, title: 'The ' + x.secondary + ' closes it; the preview simulates the platform team' });
      const lock = x.secondary !== a.role ? 'Closed by the ' + x.secondary : (x.resolvedById === a.id ? 'You resolved it; someone else closes it' : null);
      return btn('Close', 'vk.close', { cls: 'sm', data: { ex: x.id }, lock });
    }
    const guard = ENGINE.resolveGuard(x.caseId ? ENGINE.caseById(x.caseId) : null, x);
    if (isPlatform(x.owner)) {
      if (guard) return `<span class="lock">${I.hourglass}${esc(scrub(guard))}</span>`;
      return btn('Resolve as the simulated platform team', 'vk.platResolve', { cls: 'sm', data: { ex: x.id }, title: 'The ' + x.owner + ' resolves it; the preview simulates the platform team' });
    }
    const whoWhy = ENGINE.resolverCheck(x, a);
    if (whoWhy) return `<span class="lock">${I.lock}${esc(whoWhy)}</span>`;
    if (guard) return `<span class="lock">${I.hourglass}${esc(scrub(guard))}</span>`;
    return btn('Resolve', 'vk.resolve', { cls: 'sm', data: { ex: x.id } });
  }

  return {
    safeId, link, caseLink, clientLink, exLink, caseWho, clientName, who,
    maskId, maskTaxRef, idHtml, taxRefHtml, scrub,
    money, toDay, date, dateShort, when, datebox, bizLeft, leftText, leftPill,
    pill, sevChip, codeChip, gateChip, gateStateWord, gateName, exStatus,
    page, section, table, empty, list, tracker, facts,
    done, ownedBy, waitingGates, myExceptions, deadlines, releaseBtn, exceptionBtn,
  };
})();

// Header count: every gate waiting for the signed-in role (ready or not).
NAV_COUNT.approvals = () => VK.waitingGates(S.role).length;
