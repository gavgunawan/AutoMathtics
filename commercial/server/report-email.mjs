// The weekly progress email (email-v1): a family's week (server/report.mjs buildFamilyReport) as an email, HTML and plain text.
// An email client applies neither the app's CSP nor most CSS, so this is tables and inline styles, one column that reads on a
// phone, the game's colours (cyan #35E0FF, magenta #FF2DA8, deep navy), and no image or font fetched from anywhere. Every name a
// parent typed is escaped. No id is ever shown: ids travel only inside the signed links behind the buttons.
const C = { navy: '#07091A', panel: '#10153A', line: '#2A3170', ink: '#EAF2FF', muted: '#A9B6D3', dim: '#7C89A8', cyan: '#35E0FF', magenta: '#FF2DA8' };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = (list) => (list.length <= 1 ? list.join('') : list.length <= 3 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : `${list.slice(0, 2).join(', ')} and ${list.length - 2} more`);

/** The buttons a child's section carries: the pace when a change is suggested; the scan focus to offer or to switch off, unless the scan is locked. */
export function buttonsFor(c) {
  if (!c.answered) return { pace: null, focus: null };
  return { pace: c.pace.enough && c.pace.direction !== 'keep' ? c.pace.suggested : null, focus: c.scan.status === 'locked' ? null : c.scan.focus ? false : c.engineWeak ? true : null };
}
/** "Allison and Geralt this week: 4 missions, 92% right" — the children who answered, the family's missions and accuracy. */
export function subjectFor(data) {
  return `${names(data.children.filter((c) => c.answered).map((c) => c.nickname)) || 'Your family'} this week: ${count(data.totals.sessions, 'mission')}, ${pct(data.totals.accuracy)} right`;
}

// ---- one child's section, as blocks both renderings share
const LISTS = [['strong', '✅ Right and fast', (s) => `${s.correct} of ${s.n} right, using about ${pct(s.speed)} of the time allowed`],
  ['slow', '🐢 Right but slow', (s) => `${s.correct} of ${s.n} right, but using about ${pct(s.speed)} of the time allowed`],
  ['trouble', '⚠️ Wrong again and again', (s) => `wrong ${s.wrong} times out of ${s.n}${s.timeouts ? ` (${s.timeouts} ran out of time)` : ''}`]];
function childBlocks(c, links) {
  const t = c.totals, name = c.nickname, b = buttonsFor(c), url = links.children?.[c.childId] || {}, blocks = [];
  blocks.push({ kind: 'name', text: name });
  blocks.push({ kind: 'line', text: [count(t.sessions, 'mission'), count(t.questions, 'question'), `${pct(t.accuracy)} right`, count(t.minutes, 'minute'),
    ...(t.papersPassed ? [`${count(t.papersPassed, 'paper')} passed`] : []), ...(t.checkpoints ? [`${count(t.checkpoints, 'check point')} cleared`] : []), ...(t.left ? [`${t.left} left early`] : [])].join(' · ') });
  if (c.partial) blocks.push({ kind: 'note', text: 'A busy week: these counts cover the newest 60 sessions the game keeps.' });
  const lists = LISTS.filter(([k]) => c[k].length);
  if (!lists.length) blocks.push({ kind: 'note', text: 'No style had five or more answers this week, so there is nothing to sort yet.' });
  for (const [k, title, detail] of lists) blocks.push({ kind: 'list', title, items: c[k].map((s) => ({ label: s.label, detail: detail(s) })) });
  blocks.push({ kind: 'line', text: `⏱ Pace: ${c.pace.sentence}` });
  if (b.pace !== null && url.pace) blocks.push({ kind: 'button', label: `Set ${name}’s pace to ${b.pace}%`, href: url.pace });
  if (c.scan.status === 'locked') blocks.push({ kind: 'line', text: '🧠 System Scan unlocks at Engine Sector B, paper 21.' });
  else {
    blocks.push({ kind: 'line', text: c.scan.status === 'passed' ? '🧠 System Scan: passed this week.' : c.scan.tried ? '🧠 System Scan: tried this week, not passed yet (a pass needs all 25 right). It resets every Monday.' : '🧠 System Scan: not done this week. It resets every Monday.' });
    if (b.focus === true && url.focus) blocks.push({ kind: 'line', text: `Next week’s scan can focus on the styles above: about 75% of its questions on what ${name} gets wrong or slow, 25% recap.` }, { kind: 'button', label: `Focus ${name}’s System Scan on these`, href: url.focus });
    if (b.focus === false && url.focus) blocks.push({ kind: 'line', text: `${name}’s System Scan is focused on weak spots: about 75% of its questions.` }, { kind: 'button', label: `Switch ${name}’s scan focus off`, href: url.focus });
  }
  return blocks;
}
const quietLine = (c) => (c.totals.left ? `${c.nickname} started ${count(c.totals.left, 'session')} this week but left before the end.` : `${c.nickname} didn’t answer any questions this week.`);

// ---- HTML
const p = (text, style = '') => `<p style="margin:0 0 10px;font:16px/1.5 ${FONT};color:${C.muted};${style}">${esc(text)}</p>`;
const btn = (label, href) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 14px;"><tr><td style="background:${C.magenta};border-radius:10px;"><a href="${esc(href)}" style="display:inline-block;padding:12px 18px;font:700 15px/1.2 ${FONT};color:#ffffff;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
function htmlBlock(x) {
  if (x.kind === 'name') return `<h2 style="margin:0 0 6px;font:700 22px/1.3 ${FONT};color:${C.ink};">${esc(x.text)}</h2>`;
  if (x.kind === 'line') return p(x.text);
  if (x.kind === 'note') return p(x.text, `font-size:14px;color:${C.dim};`);
  if (x.kind === 'button') return btn(x.label, x.href);
  return `<p style="margin:12px 0 4px;font:700 15px/1.4 ${FONT};color:${C.ink};">${esc(x.title)}</p><ul style="margin:0 0 10px;padding-left:20px;">${x.items.map((i) => `<li style="margin:0 0 6px;font:15px/1.45 ${FONT};color:${C.muted};"><strong style="color:${C.ink};">${esc(i.label)}</strong> — ${esc(i.detail)}</li>`).join('')}</ul>`;
}
const row = (inner, pad = '20px 24px') => `<tr><td style="padding:${pad};border-top:1px solid ${C.line};">${inner}</td></tr>`;

/**
 * renderReport(data, links) → { subject, html, text }. `links`: { app, settings, unsubscribe, children: { [childId]: { pace?, focus? } } },
 * every one a full URL; a button shows only when it is due (buttonsFor) and its link was given.
 */
export function renderReport(data, links) {
  const subject = subjectFor(data), host = (() => { try { return new URL(links.app).host; } catch { return 'AutoMathtics'; } })();
  const played = data.children.filter((c) => c.answered), quiet = data.children.filter((c) => !c.answered), t = data.totals;
  const summary = `${data.weekLabel} · ${count(t.sessions, 'mission')} · ${pct(t.accuracy)} right across ${count(t.questions, 'question')}`;
  const why = 'Why this email: you created an AutoMathtics parent account and agreed to account and progress emails. The weekly report comes every Monday while it is switched on.';
  const sender = `AutoMathtics · Mission Control for parents · ${host}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark light"><title>${esc(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:${C.navy};"><div style="display:none;max-height:0;overflow:hidden;">${esc(summary)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.navy};"><tr><td align="center" style="padding:24px 12px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${C.panel};border:1px solid ${C.line};border-radius:16px;">`
    + `<tr><td style="padding:28px 24px 18px;"><p style="margin:0 0 12px;font:700 12px/1 ${FONT};letter-spacing:2px;color:${C.cyan};">AUTOMATHTICS · WEEKLY REPORT</p>`
    + `<h1 style="margin:0 0 8px;font:700 26px/1.25 ${FONT};color:${C.ink};">Your family’s week</h1>${p(summary, 'margin:0;')}</td></tr>`
    + played.map((c) => row(childBlocks(c, links).map(htmlBlock).join(''))).join('')
    + (quiet.length ? row(quiet.map((c) => p(quietLine(c))).join('')) : '')
    + row(`${p(why, `font-size:13px;color:${C.dim};`)}<p style="margin:0 0 10px;font:14px/1.5 ${FONT};"><a href="${esc(links.unsubscribe)}" style="color:${C.cyan};">Stop weekly reports</a> <span style="color:${C.dim};">·</span> <a href="${esc(links.settings)}" style="color:${C.cyan};">Email settings</a></p>${p(sender, `margin:0;font-size:12px;color:${C.dim};`)}`, '18px 24px 24px')
    + '</table></td></tr></table></body></html>';
  const textBlock = (x) => (x.kind === 'name' ? `\n${x.text.toUpperCase()}` : x.kind === 'button' ? `  ${x.label}: ${x.href}` : x.kind === 'list' ? [x.title, ...x.items.map((i) => `  - ${i.label} — ${i.detail}`)].join('\n') : x.text);
  const text = ['AUTOMATHTICS · WEEKLY REPORT', 'Your family’s week', summary, ...played.flatMap((c) => childBlocks(c, links).map(textBlock)), ...(quiet.length ? ['', ...quiet.map(quietLine)] : []),
    '', '—', why, `Stop weekly reports: ${links.unsubscribe}`, `Email settings: ${links.settings}`, sender, ''].join('\n');
  return { subject, html, text };
}
