/* Due-date engine. The business-day logic is ported line for line from the firm's "SARS Business Day Calculator V4"
   (5 Oct 2026): South African public holidays with Sunday→Monday observance, Easter, the Chapter 9 exclusion
   (16 December to 15 January, inclusive) and the 21-business-day verification tracker (submission date = Day 0).
   Dates are calendar days handled in UTC, exactly as the calculator does. tests/test_dates.py checks parity with the calculator. */
const DATES = (() => {
  const DAY = 86400000;
  function dt(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d));
    return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x : null;
  }
  const add = (d, n) => new Date(d.getTime() + n * DAY);
  const iso = (d) => d.toISOString().slice(0, 10);
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = (h + l - 7 * m + 114) % 31 + 1;
    return new Date(Date.UTC(y, mo - 1, da));
  }
  const FIXED = [[1, 1, "New Year's Day"], [3, 21, 'Human Rights Day'], [4, 27, 'Freedom Day'], [5, 1, "Workers' Day"], [6, 16, 'Youth Day'],
    [8, 9, "National Women's Day"], [9, 24, 'Heritage Day'], [12, 16, 'Day of Reconciliation'], [12, 25, 'Christmas Day'], [12, 26, 'Day of Goodwill']];
  const cache = new Map();
  function holidays(y) {
    if (cache.has(y)) return cache.get(y);
    const m = new Map(); const put = (d, n) => { const k = iso(d); m.set(k, m.has(k) ? m.get(k) + '; ' + n : n); };
    FIXED.forEach(([mo, d, n]) => put(new Date(Date.UTC(y, mo - 1, d)), n));
    const e = easter(y); put(add(e, -2), 'Good Friday'); put(add(e, 1), 'Family Day');
    [...m].forEach(([k, n]) => { const d = dt(k); if (d.getUTCDay() === 0) put(add(d, 1), n + ' observed'); });
    cache.set(y, m); return m;
  }
  // Additional declared public holidays (verified separately, each with its source). Same role as the calculator's "custom" box.
  const EXTRA = new Map();
  // Declared under s2A of the Public Holidays Act: Proclamation Notice 346 of 2026, Government Gazette 55352, 8 Sep 2026.
  // https://www.gov.za/sites/default/files/gcis_document/202609/55352-rg12046pr346.pdf
  EXTRA.set('2026-11-04', 'Local government elections');
  const isChapter9 = (d) => { const mo = d.getUTCMonth() + 1, da = d.getUTCDate(); return (mo === 12 && da >= 16) || (mo === 1 && da <= 15); };
  // A business day excludes Saturday, Sunday and a public holiday; Chapter 9 periods also exclude 16 Dec–15 Jan.
  function biz(d, o) {
    const w = d.getUTCDay();
    return w !== 0 && w !== 6 && !holidays(d.getUTCFullYear()).has(iso(d)) && !EXTRA.has(iso(d)) && !(o && o.ch9 && isChapter9(d));
  }
  function nextBiz(d, o) { do { d = add(d, 1); } while (!biz(d, o)); return d; }
  // n business days after d (d itself is Day 0).
  function addBusinessDays(d, n, o) { let k = 0; while (k < n) { d = add(d, 1); if (biz(d, o)) k++; } return d; }
  // Business days from a to b: a is Day 0, so tomorrow-if-a-business-day is 1. Negative when b is before a.
  function businessDaysBetween(a, b, o) {
    if (iso(a) === iso(b)) return 0;
    const sign = b > a ? 1 : -1; let n = 0; let d = a;
    while (iso(d) !== iso(b)) { d = add(d, sign); if (biz(d, o)) n += sign; }
    return n;
  }
  // The calculator's 21-business-day verification tracker. method 'after' (recommended): submission date is Day 0.
  // method 'include': the submission date is Day 1 if it is a business day.
  function verification21(submitted, method) {
    let d = new Date(submitted); let n = 0; const rows = [];
    if (method === 'include' && biz(d)) { n = 1; rows.push([n, new Date(d)]); }
    while (n < 21) { d = add(d, 1); if (biz(d)) { n++; rows.push([n, new Date(d)]); } }
    return { submitted, day1: rows[0][1], target: new Date(d), follow: nextBiz(d), method, rows };
  }
  // The calculator's "business days between dates". mode: 'es' exclude start/include end, 'both', 'neither', 'ee' include start/exclude end.
  function countRange(s, e, mode, ch9) {
    let a = new Date(s), z = new Date(e);
    if (mode === 'es' || mode === 'neither') a = add(a, 1);
    if (mode === 'ee' || mode === 'neither') z = add(z, -1);
    const rows = []; let b = 0, x = 0, t = 0;
    for (let d = a; d <= z; d = add(d, 1)) {
      t++; const rs = []; const w = d.getUTCDay(); const h = holidays(d.getUTCFullYear()).get(iso(d)); const ch = EXTRA.get(iso(d));
      if (w === 0 || w === 6) rs.push(w === 0 ? 'Sunday' : 'Saturday');
      if (h || ch) rs.push([h, ch].filter(Boolean).join('; '));
      if (ch9 && isChapter9(d)) rs.push('Chapter 9 exclusion');
      if (rs.length) x++; else b++;
      rows.push({ date: iso(d), business: !rs.length, reason: rs.join(' | ') || 'Counted' });
    }
    return { business: b, total: t, excluded: x, rows };
  }
  // Bridges between the app's local-time Dates and the calculator's UTC calendar days.
  const fromLocal = (d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const toLocal = (u, h = 17, mi = 0) => new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), h, mi);
  const holidayName = (d) => holidays(d.getUTCFullYear()).get(iso(d)) || EXTRA.get(iso(d)) || null;
  return { DAY, dt, add, iso, easter, holidays, EXTRA, isChapter9, biz, nextBiz, addBusinessDays, businessDaysBetween, verification21, countRange, fromLocal, toLocal, holidayName };
})();
