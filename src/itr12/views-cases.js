/* Cases: the 2026 ITR12 board. Columns are the phases in BOARD (workflow.js); a card sits in ENGINE.columnOf(c). Incidents are a
   badge on the card, not a column. There is also a table view sorted by the nearest deadline.
   Moving a card is a request to ENGINE, never a change made here:
     - forward (drag to the next column, or the card's "Next stage" button): ENGINE.dragForward(c, ACTOR.me(), toKey). It passes
       only for the gate owner with nothing blocking; otherwise the card snaps back and the open codes are listed. Client gates and
       G18 never pass by a staff drag.
     - backward (drag to an earlier column, or "Back for rework"): a reason, then ENGINE.returnForRework.
   The engine audits every attempt, refusals included. Card dragging uses the Sortable library the build loads for the review
   layer, in its own group; it is off while the review layer's page arranging is on, and rendering waits until a drag ends.
   Shared with views-case.js: CASES_BOARD.forward(c), CASES_BOARD.rework(c, toKey) and the ACT handlers 'cases.fwd' and 'cases.back'. */
const CASES_BOARD = (() => {
  const MODE_KEY = 'op-cases-view';
  let mode = LS.get(MODE_KEY) === 'table' ? 'table' : 'board';  // a per-viewer convenience, never shared state
  let last = null;       // the latest move on this screen: { id, ok, text, codes: [exception or code] }
  let sortables = [];
  let dragging = false;
  const NEAR = 10;  // cards show a deadline within this many business days (or overdue); the table shows them all

  const colIdx = (k) => BOARD.findIndex((b) => b.key === k);
  const colLabel = (k) => { const b = BOARD[colIdx(k)]; return b ? b.label : String(k || ''); };
  const applies = (c, b) => b.gates.some((g) => ENGINE.applies(c, g));
  // The next column a forward move asks for: the engine skips columns whose gates do not apply to this case.
  function nextCol(c) {
    const i = colIdx(ENGINE.columnOf(c));
    for (let j = i + 1; j < BOARD.length; j++) if (applies(c, BOARD[j])) return BOARD[j].key;
    return null;
  }
  // Columns a card can be returned to: earlier ones whose gates apply to this case.
  const earlierCols = (c) => BOARD.slice(0, Math.max(0, colIdx(ENGINE.columnOf(c)))).filter((b) => applies(c, b));
  const openEx = (c) => ENGINE.exOf(c).filter((x) => ENGINE.isOpen(x)).sort((p, q) => (SEV.indexOf(p.sev) - SEV.indexOf(q.sev)) || (p.at - q.at));
  const incidentsOf = (c) => S.incidents.filter((i) => i.caseId === c.id && i.status === 'open');
  const submitted = (c) => !!(c.submission && c.submission.ok);

  // Who releases the case's next gate, in a few words.
  function waitingOn(c, g) {
    if (!g) return 'Nothing: every gate is done';
    const r = RELEASE[g];
    switch (r.by) {
      case 'client': return 'The client, in the PaperSync portal';
      case 'system': return 'Operon’s own checks';
      case 'ai': return 'AI check (simulated) or the ' + r.role;
      case 'dual': return 'Two sign-offs on the SARS link';
      default: return 'The ' + r.role;
    }
  }
  // The nearest deadline per case, from the kit's deadline list (overdue included).
  function deadlineMap() {
    const m = {};
    VK.deadlines({ days: 100000 }).forEach((d) => { if (d.c && !m[d.c.id]) m[d.c.id] = d; });
    return m;
  }

  /* ---------- moves (each one goes through ENGINE with ACTOR.me()) ---------- */
  function codeChips(list) {
    return list.length ? `<span class="vk-codes">${list.map((x) => (typeof x === 'string' ? VK.codeChip(x) : VK.codeChip(x.code, x) + VK.sevChip(x.sev, { short: true }))).join(' ')}</span>` : '';
  }
  // toKey: the column a card was dropped in (the next one by default). A drop further on is still sent: the engine refuses it.
  function forward(c, toKey) {
    if (!c) { toast('That case is no longer here.'); render(); return false; }
    const from = ENGINE.columnOf(c);
    const r = ENGINE.dragForward(c, ACTOR.me(), toKey || nextCol(c) || undefined);
    let msg = '';
    if (r.ok) {
      msg = r.awaiting ? 'Released for ' + c.id + '. The card moves when SARS confirms the transaction (G18 on the SARS link).'
        : 'Moved ' + c.id + ' from ' + colLabel(from) + ' to ' + colLabel(r.to || ENGINE.columnOf(c)) + '.';
    }
    // Refused: list the open codes that stop it (the engine returns the blockers, or just their codes for G07).
    const blockers = r.ok ? [] : (r.blockers && r.blockers.length ? r.blockers : (r.codes || []).map((code) => ENGINE.openOf(c, code)[0] || code));
    last = { id: c.id, ok: r.ok, text: r.ok ? msg : c.id + ' stays in ' + colLabel(from) + '. ' + r.why, codes: blockers };
    return VK.done(r, msg);
  }
  // Return for rework: a modal asks where to and why, then ENGINE.returnForRework. Cancelling leaves the card where it was.
  function rework(c, toKey) {
    if (!c) { toast('That case is no longer here.'); render(); return; }
    const cols = earlierCols(c);
    const from = ENGINE.columnOf(c);
    // Nowhere earlier to go, or the return is already submitted: no reason can help, so the engine refuses (and audits) straight away.
    if (!cols.length || submitted(c)) {
      const r = ENGINE.returnForRework(c, ACTOR.me(), toKey || (cols.length ? cols[cols.length - 1].key : from), '');
      last = { id: c.id, ok: false, text: c.id + ' stays in ' + colLabel(from) + '. ' + r.why, codes: [] };
      VK.done(r, '');
      return;
    }
    const pick = cols.some((b) => b.key === toKey) ? toKey : cols[cols.length - 1].key;
    const frozen = c.frozen ? ' The version is frozen, so VER-01 is raised.' : '';
    const approved = ENGINE.currentApproval(c) ? ' The client’s approval is superseded: they approve again in the PaperSync portal.' : '';
    modal('Return ' + c.id + ' for rework', `${VK.facts([['Case', VK.caseWho(c)], ['Now in', esc(colLabel(from))]])}
      <label class="f" for="cb-rw-to">Return it to<select id="cb-rw-to" name="to">${cols.map((b) => `<option value="${esc(b.key)}"${b.key === pick ? ' selected' : ''}>${esc(b.label + ' (' + b.gates.join(', ') + ')')}</option>`).join('')}</select></label>
      <label class="f" for="cb-rw-reason">Reason (required)<textarea id="cb-rw-reason" name="reason" maxlength="500"></textarea></label>
      <p class="hint">${esc('Rework re-opens the gates from that stage on and holds the first one for the Tax Consultant.' + approved + frozen + ' Operon records the reason in the audit trail.')}</p>`,
    'Return for rework', (fd) => {
      const reason = String(fd.reason || '').trim();
      if (!reason) return 'Write the reason for the rework.';
      const r = ENGINE.returnForRework(c, ACTOR.me(), String(fd.to || ''), reason);
      last = { id: c.id, ok: r.ok, text: r.ok ? 'Returned ' + c.id + ' to ' + colLabel(r.to) + ' for rework.' : c.id + ' stays in ' + colLabel(from) + '. ' + r.why, codes: [] };
      if (!r.ok) { render(); return 'Not done: ' + r.why; }
      return () => VK.done(r, 'Returned ' + c.id + ' to ' + colLabel(r.to) + ' for rework.');
    });
  }
  // A card dropped in another column (Sortable). Forward asks to pass the gates; backward asks for a reason.
  function drop(id, toKey) {
    const c = ENGINE.caseById(id);
    if (!c || colIdx(toKey) < 0) { render(); return; }
    const fi = colIdx(ENGINE.columnOf(c)); const ti = colIdx(toKey);
    if (ti === fi) { render(); return; }
    if (ti > fi) { forward(c, toKey); return; }
    render();  // the card snaps back while the reason is asked for
    rework(c, toKey);
  }

  /* ---------- card dragging (Sortable, its own group) ---------- */
  const arranging = () => (typeof RV !== 'undefined' && RV && RV.arranging) || document.body.classList.contains('rv-arranging');
  // While a card is dragged, render() must wait: REVIEW.hold() makes REVIEW.busy() true, so render() only marks REVIEW.pending;
  // releasing the hold renders what was deferred.
  function hold(on) {
    if (dragging === on) return;
    dragging = on;
    document.body.classList.toggle('cb-dragging', on);
    if (typeof REVIEW !== 'undefined' && REVIEW.hold) REVIEW.hold(on);
  }
  function destroy() { sortables.forEach((s) => { try { s.destroy(); } catch (e) { /* detached */ } }); sortables = []; }
  function init() {
    destroy();
    if (dragging || arranging() || !window.Sortable || typeof window.Sortable.create !== 'function') return;
    $$('#app .cb-list').forEach((ul) => {
      try {
        sortables.push(window.Sortable.create(ul, {
          group: { name: 'cases-board', pull: true, put: true }, sort: false, draggable: '.cb-card',
          filter: (evt) => arranging() || !!(evt.target && evt.target.closest && evt.target.closest('a,button,select,input,textarea,.lock')), preventOnFilter: false,
          delay: 180, delayOnTouchOnly: true, touchStartThreshold: 5, animation: 120,
          forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4, emptyInsertThreshold: 24,
          ghostClass: 'cb-ghost', chosenClass: 'cb-chosen', dragClass: 'cb-drag',
          onMove: () => !arranging(),
          onStart: () => hold(true),
          onEnd: (evt) => {
            hold(false);
            const id = evt.item && evt.item.dataset ? evt.item.dataset.case : null;
            const to = evt.to && evt.to.dataset ? evt.to.dataset.col : null;
            if (!id || !to || evt.from === evt.to) { render(); return; }
            drop(id, to);
          },
        }));
      } catch (e) { console.warn('Cases board: drag setup failed', e); }
    });
  }
  // Sortable arrives asynchronously from its CDN: set the board up once it has loaded.
  try {
    const js = document.querySelector('script[src*="/Sortable.min.js"]');
    if (js && !window.Sortable) js.addEventListener('load', () => { if (routeOf().name === 'cases') queueMicrotask(init); });
  } catch (e) { /* no Sortable: the buttons still move cards */ }

  /* ---------- the board ---------- */
  function moveButtons(c) {
    const col = ENGINE.columnOf(c); const out = [];
    const sr = (t) => `<span class="sr"> ${esc(t)}</span>`;
    // Stable ids: the shell's render() keeps keyboard focus on the same button after the move, even when the card changes column.
    const sid = VK.safeId(c.id);
    if (col !== 'closed') out.push(btn('Next stage', 'cases.fwd', { cls: 'sm', id: sid ? 'cb-fwd-' + sid : '', data: { case: c.id }, html: 'Next stage' + sr('for ' + c.id), title: 'Ask Operon to pass ' + (ENGINE.currentGate(c) || 'the next gate') }));
    if (colIdx(col) > 0 && !submitted(c)) out.push(btn('Back for rework', 'cases.back', { cls: 'sm ghost', id: sid ? 'cb-back-' + sid : '', data: { case: c.id }, html: 'Back for rework' + sr('for ' + c.id) }));
    return out.length ? `<div class="cb-acts">${out.join('')}</div>` : '';
  }
  function badges(c) {
    const incs = incidentsOf(c);
    return incs.map((i) => `<a class="cb-inc" href="#incident-${esc(VK.safeId(i.id))}" title="${esc('Incident ' + i.id + ' is open (G17, Information Officer). SARS transactions on this case are stopped until it closes.')}">${I.alert}<span>Incident ${esc(i.id)}</span></a>`).join(' ');
  }
  function card(c, dl) {
    const g = ENGINE.currentGate(c); const xs = openEx(c); const shown = xs.slice(0, 4);
    const cl = ENGINE.clientOf(c);
    const due = dl[c.id];
    return `<li class="cb-card" data-case="${esc(c.id)}">
      <div class="cb-card-h">${VK.caseLink(c)}<span class="cb-name">${VK.clientLink(c.clientId)}</span>${badges(c)}</div>
      <div class="cb-line">${g ? VK.gateChip(c, g) : VK.pill('All gates done', 'ok')}<span class="small muted">${esc(waitingOn(c, g))}</span></div>
      ${xs.length ? `<div class="vk-codes">${shown.map((x) => VK.codeChip(x.code, x) + VK.sevChip(x.sev, { short: true })).join(' ')}${xs.length > shown.length ? `<span class="small muted">+${xs.length - shown.length} more</span>` : ''}</div>` : ''}
      <div class="cb-meta small muted"><span>${esc(pname(c.consultant))}</span>${due && due.left <= NEAR ? `<span title="${esc(due.what)}">${VK.leftPill(due.left)}<span class="sr">${esc(': ' + due.what)}</span></span>` : ''}${cl && cl.provisional === false ? '<span>Non-provisional</span>' : ''}</div>
      ${moveButtons(c)}
    </li>`;
  }
  function lastBlock() {
    if (!last) return '';
    const c = ENGINE.caseById(last.id);
    return `<div class="cb-last ${last.ok ? 'ok' : 'bad'}" role="status">${last.ok ? I.check : I.alert}<div><p>${esc(VK.scrub(last.text))}</p>${codeChips(last.codes)}
      <p class="small muted">${c ? VK.caseLink(c, 'Open ' + c.id) + ' · ' : ''}Every attempt, refused or not, is in the <a href="#audit">audit trail</a>.</p></div>
      ${btn('Dismiss', 'cases.clear', { cls: 'sm ghost' })}</div>`;
  }
  function boardBlock(cases, dl) {
    const cols = BOARD.map((b) => {
      const mine = cases.filter((c) => ENGINE.columnOf(c) === b.key);
      const gates = b.gates.length > 1 ? b.gates[0] + '–' + b.gates[b.gates.length - 1] : b.gates[0];
      return `<li class="cb-col" data-col="${esc(b.key)}"><div class="cb-col-h"><h3>${esc(b.label)}</h3><span class="cb-gates mono">${esc(gates)}</span><span class="count${mine.length ? '' : ' zero'}" aria-label="${mine.length} cases">${mine.length}</span></div>
        <ul class="cb-list" data-col="${esc(b.key)}" aria-label="${esc(b.label + ': ' + plural(mine.length, 'case'))}">${mine.length ? mine.map((c) => card(c, dl)).join('') : '<li class="cb-none small muted">No cases</li>'}</ul></li>`;
    }).join('');
    const intro = 'Drag a card to the next column to ask Operon to pass its gate, or use Next stage. It moves only if you own the gate and nothing blocks it; otherwise it snaps back and the open codes are listed. '
      + 'Drag it back, or use Back for rework, to return it with a reason. Client gates pass only in the PaperSync portal (simulated) and submission only through G18 on the SARS link.';
    return VK.section('cases-board', 'Board', lastBlock() + `<ol class="cb-cols" aria-label="ITR12 phases">${cols}</ol>`, {
      count: cases.length, intro: esc(intro) + (window.Sortable ? '' : ' <span class="small">Dragging is not available right now: use the buttons on each card.</span>'),
      cls: 'cb-sec',
    });
  }
  function tableBlock(cases, dl) {
    const rows = cases.slice().sort((p, q) => {
      const a = dl[p.id]; const b = dl[q.id];
      if (a && b && a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (!!a !== !!b) return a ? -1 : 1;
      return colIdx(ENGINE.columnOf(p)) - colIdx(ENGINE.columnOf(q)) || p.id.localeCompare(q.id);
    }).map((c) => {
      const d = dl[c.id]; const g = ENGINE.currentGate(c); const xs = openEx(c);
      return [
        d ? `<div>${VK.date(d.date)}</div><div>${VK.leftPill(d.left)}</div><div class="small muted">${esc(d.what)}</div>` : '<span class="muted">No deadline</span>',
        `${VK.caseWho(c)}<div class="small muted">${esc(pname(c.consultant))}</div>`,
        esc(colLabel(ENGINE.columnOf(c))),
        `${g ? VK.gateChip(c, g) : VK.pill('All gates done', 'ok')}<div class="small muted">${esc(waitingOn(c, g))}</div>`,
        (xs.length ? `<div class="vk-codes">${xs.map((x) => VK.codeChip(x.code, x) + VK.sevChip(x.sev, { short: true })).join(' ')}</div>` : '<span class="muted">None open</span>') + (incidentsOf(c).length ? `<div>${badges(c)}</div>` : ''),
        moveButtons(c),
      ];
    });
    return VK.section('cases-table', 'Cases by deadline', lastBlock() + VK.table([{ label: 'Next deadline' }, { label: 'Case' }, { label: 'Stage' }, { label: 'Waiting on' }, { label: 'Open exceptions' }, { label: '', cls: 'vk-act' }], rows,
      { caption: 'Cases sorted by their nearest deadline', empty: 'There are no cases.' }), {
      count: cases.length,
      intro: esc('Nearest deadline first: the filing season close, SARS due dates, remedy deadlines (16 Dec to 15 Jan not counted), PaperSync reminders and exception due dates. Cases with no deadline come last.'),
    });
  }

  function view() {
    const cases = S.cases.slice().sort((p, q) => p.id.localeCompare(q.id));
    const dl = deadlineMap();
    const seg = `<div class="seg" role="group" aria-label="Show the cases as">${[['board', 'Board'], ['table', 'Table']].map(([k, label]) => `<button type="button" data-act="cases.mode" data-mode="${k}" aria-pressed="${mode === k}">${label}</button>`).join('')}</div>`;
    const done = cases.filter((c) => ENGINE.columnOf(c) === 'closed').length;
    const intro = esc(FIRM + ' · ' + plural(cases.length, 'case') + ' for 2026: ' + (cases.length - done) + ' in progress, ' + done + ' closed and retained. Each card sits in the phase of the next gate it must pass. '
      + 'Incidents show as a badge on the card. All data is made up; the AI, the PaperSync portal and the SARS link are simulated.');
    queueMicrotask(() => { if (routeOf().name === 'cases' && mode === 'board') init(); else destroy(); });
    return VK.page('2026 ITR12 cases', intro, mode === 'table' ? tableBlock(cases, dl) : boardBlock(cases, dl), { key: 'cases', actions: seg });
  }

  Object.assign(ACT, {
    'cases.mode': (t) => { mode = t.dataset.mode === 'table' ? 'table' : 'board'; LS.set(MODE_KEY, mode); render(); },
    'cases.fwd': (t) => forward(ENGINE.caseById(t.dataset.case)),
    'cases.back': (t) => rework(ENGINE.caseById(t.dataset.case), t.dataset.to),
    'cases.clear': () => { last = null; render(); },
  });

  return { view, forward, rework, drop, init, nextCol, earlierCols, waitingOn, colLabel, get mode() { return mode; }, get last() { return last; } };
})();

VIEWS.cases = () => CASES_BOARD.view();
