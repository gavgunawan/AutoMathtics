const root = document.querySelector('#app'), status = document.querySelector('#message');
const icons = { fox: '\u{1f98a}', panda: '\u{1f43c}', tiger: '\u{1f42f}', wolf: '\u{1f43a}', robot: '\u{1f916}', rocket: '\u{1f680}' };
let csrf = '', model = null, authModule = null, working = false, transientView = false;
let reauthEpoch = 0, sessionRefreshPending = false;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('automathtics-session') : null;
const messages = {
  CHILD_LIMIT_REACHED: 'All child slots are in use. A larger allowance is needed to add another child.',
  SUBSCRIPTION_INACTIVE: 'Learning access is inactive. Parent account access remains available.',
  PIN_LOCKED: 'Too many PIN attempts. Wait 15 minutes or ask your parent to reset the PIN.',
  PIN_SERVICE_BUSY: 'Another PIN check is in progress. Please try again in a moment.',
  PIN_CHECK_EXPIRED: 'This PIN check expired. Please enter your PIN again.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Please pause before trying again.',
  INCORRECT_PIN: 'That PIN did not match.', REAUTHENTICATE: 'Please sign in again for this parent action.',
  SIGN_IN_REQUIRED: 'Please sign in.', PARENT_REQUIRED: 'Return to parent sign-in to manage your family.',
  CHILD_SESSION_REVOKED: 'The child PIN changed. Select the child and enter the new PIN.',
};
// Text-only DOM construction: user nicknames and family labels are never HTML.
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label, action, className = '') {
  const b = el('button', label, className); b.type = 'button'; b.onclick = () => run(action); return b;
}
function field(label, type = 'text', options = {}) {
  const wrap = el('label', null, 'field'), input = el('input');
  wrap.append(el('span', label)); Object.assign(input, { type, required: true, ...options }); wrap.append(input);
  return { wrap, input };
}
function panel(kicker, title, subtitle) {
  root.replaceChildren();
  const box = el('section', null, 'panel');
  box.append(el('p', kicker, 'kicker'), el('h1', title), el('p', subtitle, 'muted'));
  root.append(box); return box;
}
function note(text) { status.textContent = text || ''; }
async function run(fn) {
  if (working) return;
  working = true; root.setAttribute('aria-busy', 'true');
  try { note(''); await fn(); }
  catch (error) {
    note(messages[error.code] || (error.code?.startsWith('auth/') ? 'The account check failed. Check your details or try again later.' : error.message || 'Please try again.'));
  } finally {
    working = false; root.removeAttribute('aria-busy');
    if (sessionRefreshPending) {
      sessionRefreshPending = false;
      await run(async () => { if (authModule) await authModule.clear(); await refresh(); });
    }
  }
}
async function api(path, payload, requestId) {
  const response = await fetch(`/api${path}`, { method: payload === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin',
    headers: payload === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...(requestId ? { 'Idempotency-Key': requestId } : {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  const data = await response.json();
  if (!response.ok) { const e = new Error(data.error); e.code = data.error; throw e; }
  return data;
}
async function refresh() {
  transientView = false;
  csrf = (await api('/bootstrap')).csrf;
  try { model = await api('/me'); csrf = model.csrf; await renderModel(); }
  catch (error) { if (error.code === 'SIGN_IN_REQUIRED' || error.code === 'SESSION_REVOKED') { model = null; signInScreen(); } else throw error; }
}
async function auth() { authModule ||= await import('/auth.js'); return authModule; }
async function authStep(result, afterReady = null) {
  if (afterReady?.valid && !afterReady.valid()) {
    await (await auth()).clear(); result.idToken = '';
    note('Parent verification was cancelled. Start the action again.'); return;
  }
  if (result.stage === 'ready') {
    try {
      // Reauthentication can outlast the old cookie/preauthentication CSRF lifetime.
      csrf = (await api('/bootstrap')).csrf;
      if (afterReady?.valid && !afterReady.valid()) return;
      await api('/auth/session', { idToken: result.idToken });
    }
    finally { await (await auth()).clear(); result.idToken = ''; }
    await refresh(); channel?.postMessage('changed');
    if (afterReady) await afterReady();
    return;
  }
  if (result.stage === 'signin') { signInScreen(false, afterReady, Boolean(afterReady)); note(result.notice); return; }
  if (result.stage === 'verify') {
    const box = panel('01 / VERIFY EMAIL', 'Check your inbox', 'Open the verification email, then return here. No family data is available before verification.');
    box.append(button('I have verified my email', async () => authStep(await (await auth()).checkEmail(), afterReady), 'primary'),
      button('Resend verification email', async () => { await (await auth()).resendEmail(); note('Verification email requested.'); }, 'ghost'));
    return;
  }
  const enrolling = result.stage === 'enroll';
  const box = panel('02 / VERIFY MOBILE', enrolling ? 'Protect your parent account' : 'Your second security check',
    enrolling ? 'Verify your own mobile number. Children do not need a phone or email address.' : `Send a code to ${result.phone || 'your verified mobile'} to finish signing in.`);
  const phone = field('Mobile number, including country code', 'tel', { placeholder: '+62...', autocomplete: 'tel' });
  const consent = el('input'); consent.type = 'checkbox';
  const consentLabel = el('label', null, 'check');
  consentLabel.append(consent, el('span', 'I agree to receive a verification SMS. Google processes this number for authentication and abuse prevention; carrier charges may apply.'));
  if (enrolling) box.append(phone.wrap, consentLabel);
  const otp = field('SMS verification code', 'text', { inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6, autocomplete: 'one-time-code' });
  box.append(button('Send verification code', async () => { await (await auth()).sendCode(phone.input.value, consent.checked); note('Code sent. Enter it below.'); }, 'ghost'), otp.wrap,
    button('Verify code', async () => authStep(await (await auth()).confirmCode(otp.input.value), afterReady), 'primary'));
}
function signInScreen(signup = false, afterReady = null, reauth = false) {
  if (!reauth) reauthEpoch++;
  model = null;
  const box = panel(reauth ? 'PARENT VERIFICATION' : 'YOUR FAMILY. YOUR GRID.',
    reauth ? 'Confirm it\u2019s you.' : (signup ? 'A new adventure starts here.' : 'Big futures. Small steps.'),
    reauth ? 'This sensitive parent action requires a fresh password and SMS check.' :
      (signup ? 'Create an adult account first. Then build a private space for your children.' : 'One secure parent account. A personal learning world for every child.'));
  if (!reauth) {
    const steps = el('div', null, 'steps');
    ['01  PARENT SIGN-IN', '02  YOUR FAMILY', '03  KIDS\u2019 MODE'].forEach((t) => steps.append(el('span', t))); box.append(steps);
  }
  const form = el('form', null, 'auth-form');
  const email = field('Parent email', 'email', { autocomplete: 'email', maxLength: 254 });
  const password = field('Password', 'password', { autocomplete: signup ? 'new-password' : 'current-password', minLength: signup ? 12 : 1, maxLength: 128 });
  const submit = el('button', signup ? 'Create parent account' : 'Sign in as parent', 'primary'); submit.type = 'submit';
  form.append(email.wrap, password.wrap, submit);
  form.onsubmit = (event) => { event.preventDefault(); run(async () => {
    const a = await auth(); const value = password.input.value; password.input.value = '';
    await authStep(await (signup ? a.signUp(email.input.value, value) : a.signIn(email.input.value, value)), afterReady);
  }); };
  box.append(form);
  if (reauth) box.append(button('Cancel verification', async () => {
    reauthEpoch++;
    if (authModule) await authModule.clear();
    await refresh(); note('Verification cancelled. The unfinished action was discarded.');
  }, 'ghost'));
  if (!reauth) box.append(button(signup ? 'Already registered? Sign in' : 'New here? Create a parent account', () => signInScreen(!signup), 'ghost'));
  if (!signup && !reauth) box.append(button('Forgot password?', async () => { if (!email.input.checkValidity()) { email.input.reportValidity(); return; }
    await (await auth()).resetPassword(email.input.value); note('If this email can receive a reset link, one has been requested. Mobile verification is still required.'); }, 'text-button'));
  box.append(el('p', 'EMAIL VERIFIED  /  MOBILE VERIFIED  /  FAMILY-ONLY ACCESS', 'trust'));
}
function reauthenticate(afterReady) {
  // This scope comes from authenticated /me, not an editable email form or storage.
  const expected = model?.role === 'parent' && typeof model.parent?.uid === 'string'
    ? { uid: model.parent.uid, familyId: model.family?.id ?? null } : null;
  if (!expected) { signInScreen(); note('Sign in again and restart this parent action.'); return; }
  const epoch = ++reauthEpoch;
  const resume = () => {
    if (epoch !== reauthEpoch) return;
    if (model?.role !== 'parent' || model.parent?.uid !== expected.uid ||
        (model.family?.id ?? null) !== expected.familyId) {
      // The new account may be valid, but it does not own the old account's draft.
      reauthEpoch++;
      note('Account or family changed. The unfinished action was discarded. Start a new action in this account.');
      return;
    }
    reauthEpoch++; // One-shot continuation; never automatically submit a mutation.
    return afterReady();
  };
  resume.valid = () => epoch === reauthEpoch;
  transientView = true;
  signInScreen(false, resume, true);
}
async function signOut() {
  reauthEpoch++;
  await api('/auth/logout', {}); if (authModule) await authModule.clear(); channel?.postMessage('changed'); await refresh();
}
function renderModel() {
  if (model.role === 'child') return childScreen();
  if (!model.family) return familySetup();
  return model.role === 'parent' ? parentScreen() : selectorScreen();
}
function familySetup(draft = {}) {
  transientView = true;
  const box = panel('FAMILY SETUP', 'Make this space yours.', 'The server creates one private family linked to your verified parent account.');
  const label = field('Family display name', 'text', { placeholder: 'Our family', maxLength: 40, value: draft.label || '' });
  const check = el('input'); check.type = 'checkbox';
  const wrap = el('label', null, 'check');
  check.checked = draft.attested === true;
  wrap.append(check, el('span', 'I am an adult responsible for the children I add. I acknowledge this private test stores family profiles and account security events. Use synthetic child data during testing.'));
  box.append(label.wrap, wrap, el('p', 'Pilot acknowledgement only. Final privacy and parental-consent terms must be reviewed before public launch.', 'small muted'),
    button('Create family workspace', async () => {
      if (!check.checked) { note('Please acknowledge the pilot notice.'); return; }
      try {
        await api('/family', { label: label.input.value, adultAttestation: true, consentVersion: 'pilot-v1' }); await refresh();
      } catch (error) {
        if (error.code !== 'REAUTHENTICATE') throw error;
        const saved = { label: label.input.value, attested: check.checked };
        reauthenticate(() => familySetup(saved));
      }
    }, 'primary'), button('Sign out', signOut, 'ghost'));
}
function cards(children, action) {
  const grid = el('div', null, 'player-grid');
  for (const child of children) {
    const card = el(action ? 'button' : 'div', null, 'player-card');
    if (action) { card.type = 'button'; card.onclick = () => run(() => action(child)); }
    const frame = el('span', null, 'avatar-frame'); frame.append(el('span', icons[child.icon] || icons.robot, 'avatar'));
    card.append(frame, el('strong', child.nickname), el('span', child.status === 'active' ? 'READY FOR THE GRID' : 'PROFILE INACTIVE', 'card-meta'));
    grid.append(card);
  }
  return grid;
}
function parentScreen() {
  const family = model.family, e = family.entitlement;
  const active = e.status === 'active' && e.accessUntil > Date.now(); // Display only; API is authoritative.
  const box = panel('PARENT WORKSPACE', family.label, 'Manage your children here. Hand over the device to remove parent access.');
  const summary = el('div', null, 'allowance');
  summary.append(el('strong', `${family.activeCount} / ${e.seatLimit}`, 'count'), el('span', 'child slots in use'),
    el('span', active ? 'PILOT ACCESS ACTIVE' : 'AWAITING PILOT ACTIVATION', active ? 'badge' : 'badge pending'));
  box.append(summary, cards(family.children));
  if (!active) box.append(el('p', 'Your parent account is ready. The pilot operator must activate a child allowance on the server. There is no payment or self-activation button in this build.', 'notice'));
  const row = el('div', null, 'actions');
  if (active && family.activeCount < e.seatLimit) row.append(button('Add a child', addChildScreen, 'primary'));
  if (family.children.length) row.append(button('Hand over to kids', async () => {
    if (authModule) await authModule.clear(); await api('/session/lock', {}); channel?.postMessage('changed'); await refresh();
  }, 'primary'));
  row.append(button('Sign out', signOut, 'ghost')); box.append(row);
  for (const child of family.children) box.append(button(`Reset ${child.nickname}\u2019s PIN`, () => resetPinScreen(child), 'text-button'));
  box.append(el('p', `Family reference: ${family.id}`, 'reference'));
}
function pinFields() {
  const first = field('Six-digit child PIN', 'password', { inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6, autocomplete: 'new-password' });
  const repeat = field('Repeat child PIN', 'password', { inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6, autocomplete: 'new-password' });
  return { first, repeat, valid: () => first.input.checkValidity() && first.input.value === repeat.input.value };
}
function addChildScreen(draft = {}) {
  transientView = true;
  const box = panel('NEW CHILD PROFILE', 'Meet your next explorer.', 'A nickname and an icon are enough. No child email, phone number, photo or full birth date.');
  const name = field('Nickname', 'text', { maxLength: 24, autocomplete: 'off', value: draft.nickname || '' });
  const select = el('select'); select.setAttribute('aria-label', 'Profile icon');
  for (const [key, icon] of Object.entries(icons)) { const option = el('option', `${icon} ${key}`); option.value = key; select.append(option); }
  select.value = draft.icon || 'fox';
  const { first, repeat, valid } = pinFields();
  let requestId = crypto.randomUUID();
  for (const input of [name.input, select, first.input, repeat.input]) input.addEventListener('input', () => { requestId = crypto.randomUUID(); });
  box.append(name.wrap, select, first.wrap, repeat.wrap, button('Create child profile', async () => {
    if (!valid()) { note('Enter the same six-digit PIN twice.'); return; }
    try {
      await api('/children', { nickname: name.input.value, icon: select.value, pin: first.input.value }, requestId);
      first.input.value = repeat.input.value = ''; await refresh();
    } catch (error) {
      if (error.code !== 'REAUTHENTICATE') throw error;
      const saved = { nickname: name.input.value, icon: select.value };
      first.input.value = repeat.input.value = '';
      reauthenticate(() => { addChildScreen(saved); note('Parent verified. Re-enter the child PIN to finish creating this profile.'); });
    }
  }, 'primary'), button('Back to family', refresh, 'ghost'));
}
function resetPinScreen(child) {
  transientView = true;
  const box = panel('PARENT ACTION', `Reset ${child.nickname}\u2019s PIN`, 'This invalidates existing child sessions. A recent parent sign-in is required.');
  const { first, repeat, valid } = pinFields();
  box.append(first.wrap, repeat.wrap, button('Set new PIN', async () => {
    if (!valid()) { note('Enter the same six-digit PIN twice.'); return; }
    try {
      await api(`/children/${child.id}/pin`, { pin: first.input.value }); await refresh(); note('Child PIN changed.');
    } catch (error) {
      if (error.code !== 'REAUTHENTICATE') throw error;
      first.input.value = repeat.input.value = '';
      reauthenticate(() => { resetPinScreen(child); note('Parent verified. Enter the new child PIN again.'); });
    }
  }, 'primary'), button('Back', refresh, 'ghost'), button('Reauthenticate parent', () => reauthenticate(() => resetPinScreen(child)), 'text-button'));
}
function selectorScreen() {
  const box = panel('KIDS\u2019 MODE / PARENT ACCESS LOCKED', 'Who is on a mission today?', 'Choose your profile and enter your PIN. Parent settings are no longer available in this session.');
  box.append(cards(model.family.children.filter((c) => c.status === 'active'), (child) => {
    transientView = true;
    const pane = panel('YOUR PRIVATE GRID', child.nickname, 'Enter your six-digit PIN.');
    const p = field('Child PIN', 'password', { inputMode: 'numeric', maxLength: 6, pattern: '[0-9]{6}', autocomplete: 'off' });
    const enter = async () => { const code = p.input.value; p.input.value = ''; await api(`/children/${child.id}/enter`, { pin: code }); channel?.postMessage('changed'); await refresh(); };
    p.input.addEventListener('keydown', (event) => { if (event.key === 'Enter') run(enter); });
    pane.append(p.wrap, button('Enter my grid', enter, 'primary'), button('Choose another child', refresh, 'ghost'));
    p.input.focus();
  }), button('Return to parent sign-in', () => signInScreen(), 'ghost'), button('Sign out', signOut, 'text-button'));
}
// ---- the learning engine: every question, mark, paper and coin comes from the server ----
const TRACK = { engine: { name: 'ENGINE', emoji: '⚙️' }, nav: { name: 'NAVIGATOR', emoji: '🧭' } };
let timer = null;
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
const runLabel = (s) => (s.mode === 'boss' ? `👑 Check point T${s.tierEnd / 20}` : s.mode === 'practice' ? 'Practice run' : `Papers ${s.startPaper}–${s.startPaper + 4}`);
async function childScreen() {
  stopTimer();
  const child = model.child;
  const st = await api('/learn/state');
  const box = panel('CHILD SESSION / FAMILY PROTECTED', `Welcome, ${child.nickname}.`, 'Pick a track. Every question comes from the server, and so does every mark.');
  const wallet = el('div', null, 'allowance');
  wallet.append(el('strong', `⚡ ${st.wallet.gc}`, 'count'), el('span', 'grid coins'), el('strong', `🏆 ${st.wallet.rp}`, 'count'), el('span', 'reward points'));
  box.append(wallet);
  if (st.active) {
    box.append(el('p', `A ${TRACK[st.active.session.track].name} session is open at question ${st.active.session.index + 1} of ${st.active.session.count}.`, 'notice'),
      button('Continue', () => playView(st.active.session, st.active.question), 'primary'));
  }
  for (const t of ['engine', 'nav']) {
    const p = st[t];
    const card = el('div', null, 'track');
    const next = p.next.mode === 'boss' ? `👑 Check point T${p.next.tierEnd / 20} is due` : p.next.mode === 'practice' ? 'Sector done — practice runs until the other track catches up' : `Next: papers ${p.next.startPaper}–${p.next.startPaper + 4}`;
    card.append(el('strong', `${TRACK[t].emoji} ${TRACK[t].name} · SECTOR ${p.levelId}`), el('span', `${Math.min(p.paper - 1, 100)} / 100 papers · ${p.bossCleared} / 5 crowns`, 'card-meta'), el('span', next, 'card-meta'));
    if (!st.active) card.append(button(`Start ${TRACK[t].name}`, async () => { const r = await api('/learn/session', { track: t }); playView(r.session, r.question); }, 'primary'));
    box.append(card);
  }
  if (st.history.length) {
    const log = el('div', null, 'log');
    for (const h of st.history.slice(0, 6)) log.append(el('span', `${h.date} · ${TRACK[h.track].emoji} ${h.levelId} ${h.papers} · ${h.quit ? `left at Q${h.atQ + 1}` : h.passed ? 'PASS' : `${h.correct}/${h.total}`}`, 'card-meta'));
    box.append(log);
  }
  box.append(button('Switch child', async () => { await api('/session/select', {}); channel?.postMessage('changed'); await refresh(); }, 'ghost'),
    button('Parent sign-in', () => signInScreen(), 'text-button'));
}
function displayText(d) {
  if (d.layout === 'stack') return `${d.top} ${d.sym} ${d.bottom} =`;
  if (d.layout === 'frac') return `${d.pre ? `${d.pre} ` : ''}${d.parts.map((p) => (p.sym ? p.sym : `${p.n}/${p.d}`)).join(' ')} =`;
  return d.text;
}
function playView(session, q) {
  stopTimer(); transientView = true;
  const t = TRACK[session.track];
  const box = panel(`${t.emoji} ${t.name} · SECTOR ${session.levelId}`, runLabel(session), `Question ${q.index + 1} of ${session.count} · paper ${q.paper}`);
  box.append(el('p', displayText(q.display), 'question'));
  const clock = el('p', `${q.seconds} s`, 'clock'); box.append(clock);
  let left = q.seconds;
  timer = setInterval(() => { left--; clock.textContent = `${Math.max(0, left)} s`; if (left <= 0) stopTimer(); }, 1000);
  const attemptId = crypto.randomUUID(); // one id per question shown: a retried submit cannot count twice
  const submit = async (answer) => {
    stopTimer();
    const r = await api('/learn/answer', { sessionId: session.id, index: q.index, attemptId, answer });
    if (r.done) summaryView(session, r.summary); else playView({ ...session, index: r.question.index }, r.question);
    note(r.correct ? '✓ Correct' : r.result === 'timeout' ? `⏱ Too slow — it was ${r.expected}` : `✗ It was ${r.expected}`);
  };
  const submitForm = (fields, read) => {
    const form = el('form', null, 'answer-form'); for (const f of fields) form.append(f.wrap);
    const go = el('button', 'Answer', 'primary'); go.type = 'submit'; form.append(go);
    form.onsubmit = (event) => { event.preventDefault(); run(() => submit(read())); };
    box.append(form); fields[0].input.focus();
  };
  if (q.answerType === 'choice') {
    q.display.choices.forEach((c, i) => box.append(button(c, () => submit(String(i)), 'primary')));
  } else if (q.answerType === 'frac') {
    const n = field('Numerator', 'text', { inputMode: 'numeric', pattern: '[0-9]{1,4}', maxLength: 4, autocomplete: 'off' });
    const d = field('Denominator', 'text', { inputMode: 'numeric', pattern: '[0-9]{1,4}', maxLength: 4, autocomplete: 'off' });
    submitForm([n, d], () => ({ n: n.input.value.trim(), d: d.input.value.trim() }));
  } else {
    const a = field('Your answer', 'text', { inputMode: q.answerType === 'dec' ? 'decimal' : 'numeric', maxLength: 10, autocomplete: 'off' });
    submitForm([a], () => a.input.value.trim());
  }
  box.append(button('Leave this session', async () => { stopTimer(); await api('/learn/quit', { sessionId: session.id }); await refresh(); }, 'text-button'));
}
function summaryView(session, s) {
  transientView = true;
  const t = TRACK[session.track];
  const box = panel(`${t.emoji} ${t.name} · ${s.papers}`, s.passed ? 'PASS!' : 'Not this time.',
    s.passed ? `${s.correct} out of ${s.total}. ⚡ +${s.gcEarned} 🏆 +${s.rpEarned}` : `${s.correct} out of ${s.total}${s.timeout ? `, ${s.timeout} timed out` : ''}. A pass needs every question right.`);
  if (s.leveledUp) box.append(el('p', `Sector ${s.newLevelId} unlocked!`, 'notice'));
  else if (s.bossNext) box.append(el('p', '👑 A check point is next: questions from the whole tier, double loot.', 'notice'));
  box.append(el('p', `Wallet: ⚡ ${s.wallet.gc} · 🏆 ${s.wallet.rp}`, 'muted'), button('Back to my grid', refresh, 'primary'));
}
channel?.addEventListener('message', () => {
  reauthEpoch++; // Cancel old drafts even if a request is currently in flight.
  if (working) { sessionRefreshPending = true; return; }
  run(async () => { if (authModule) await authModule.clear(); await refresh(); });
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && model && !working && !transientView) run(refresh);
});
await run(refresh);
