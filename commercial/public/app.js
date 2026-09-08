const root = document.querySelector('#app'), status = document.querySelector('#message');
const icons = { fox: '\u{1f98a}', panda: '\u{1f43c}', tiger: '\u{1f42f}', wolf: '\u{1f43a}', robot: '\u{1f916}', rocket: '\u{1f680}' };
let csrf = '', model = null, authModule = null, working = false, transientView = false;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('automathtics-session') : null;
const messages = {
  CHILD_LIMIT_REACHED: 'All child slots are in use. A larger allowance is needed to add another child.',
  SUBSCRIPTION_INACTIVE: 'Learning access is inactive. Parent account access remains available.',
  PIN_LOCKED: 'Too many PIN attempts. Wait 15 minutes or ask your parent to reset the PIN.',
  PIN_SERVICE_BUSY: 'Another PIN check is in progress. Please try again in a moment.',
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
  } finally { working = false; root.removeAttribute('aria-busy'); }
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
  try { model = await api('/me'); csrf = model.csrf; renderModel(); }
  catch (error) { if (error.code === 'SIGN_IN_REQUIRED' || error.code === 'SESSION_REVOKED') { model = null; signInScreen(); } else throw error; }
}
async function auth() { authModule ||= await import('/auth.js'); return authModule; }
async function authStep(result, afterReady = null) {
  if (result.stage === 'ready') {
    try { await api('/auth/session', { idToken: result.idToken }); }
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
  if (!reauth) box.append(button(signup ? 'Already registered? Sign in' : 'New here? Create a parent account', () => signInScreen(!signup), 'ghost'));
  if (!signup && !reauth) box.append(button('Forgot password?', async () => { if (!email.input.checkValidity()) { email.input.reportValidity(); return; }
    await (await auth()).resetPassword(email.input.value); note('If this email can receive a reset link, one has been requested. Mobile verification is still required.'); }, 'text-button'));
  box.append(el('p', 'EMAIL VERIFIED  /  MOBILE VERIFIED  /  FAMILY-ONLY ACCESS', 'trust'));
}
function reauthenticate(afterReady) {
  transientView = true;
  signInScreen(false, afterReady, true);
}
async function signOut() {
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
    const enter = async () => { const code = p.input.value; p.input.value = ''; await api(`/children/${child.id}/enter`, { pin: code }); await refresh(); };
    p.input.addEventListener('keydown', (event) => { if (event.key === 'Enter') run(enter); });
    pane.append(p.wrap, button('Enter my grid', enter, 'primary'), button('Choose another child', refresh, 'ghost'));
    p.input.focus();
  }), button('Return to parent sign-in', () => signInScreen(), 'ghost'), button('Sign out', signOut, 'text-button'));
}
function childScreen() {
  const child = model.child;
  const box = panel('CHILD SESSION / FAMILY PROTECTED', `Welcome, ${child.nickname}.`, 'Your profile is ready. You are signed in with child-only permissions.');
  box.append(cards([child]), el('p', 'This first step secures accounts and child access. The learning game, progress and rewards have not been connected to this backend yet.', 'notice'),
    button('Check my secure access', async () => { await api('/child/profile'); note('Access checked by the server. Your profile is active.'); }, 'primary'),
    button('Switch child', async () => { await api('/session/select', {}); await refresh(); }, 'ghost'),
    button('Parent sign-in', () => signInScreen(), 'text-button'));
}
channel?.addEventListener('message', () => run(async () => { if (authModule) await authModule.clear(); await refresh(); }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && model && !working && !transientView) run(refresh);
});
await run(refresh);
