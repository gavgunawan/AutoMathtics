const root = document.querySelector('#app'), status = document.querySelector('#message');
const icons = { fox: '\u{1f98a}', panda: '\u{1f43c}', tiger: '\u{1f42f}', wolf: '\u{1f43a}', robot: '\u{1f916}', rocket: '\u{1f680}' };
let csrf = '', model = null, authModule = null, working = false, transientView = false;
let reauthEpoch = 0, sessionRefreshPending = false, keepSdkSession = false; // keepSdkSession: a change of mobile needs the provider's fresh sign-in kept open
// rememberChoice: the parent's answer to “Remember this device” on a sign-in's SMS step, sent with the session request;
// undefined on the fresh check of a parent action, where the server keeps whatever the device already had
let rememberChoice;
const REMEMBER_PREF = 'automathtics.remember'; // the account that last ticked the box here (accountTag), so it comes back ticked for that account only
// a SHA-256 tag of the sign-in email: another account on the same device finds the box unticked (review of PR #44)
async function accountTag(email) {
  const text = String(email || '').trim().toLowerCase(); if (!text) return '';
  try { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`remember:${text}`)))].map((b) => b.toString(16).padStart(2, '0')).join(''); } catch { return ''; }
}
// screenId: which panel is on screen, so a late answer never touches a button that has gone; onBack: what the browser's
// Back does on this screen (null: stay put); sendClock: the one ticking Send countdown. panel() resets all three.
let screenId = 0, onBack = null, sendClock = null;
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
  TRIAL_ALREADY_USED: 'A free trial has already been used with this mobile number.', TRIAL_REQUIRES_VERIFIED_PHONE: 'A verified mobile number is needed for the free trial.',
  SUBSCRIPTION_EXISTS: 'This family already has a subscription.', NO_SUBSCRIPTION: 'There is no subscription to change.', INVALID_TRANSITION: 'That change is not possible in the current state.',
  CHILD_INACTIVE: 'This explorer\u2019s seat is not active right now. Ask your parent.', REWARD_PENDING_LIMIT: 'Too many reward requests are waiting for your parent. Ask them to decide first.',
  FAMILY_DELETED: 'This family has been deleted.', NO_DELETION_PENDING: 'No deletion is scheduled.', FAMILY_STILL_EXISTS: 'Delete the family first; the sign-in account can go after that.', PLACEMENT_PENDING: 'The placement test comes first.', PLACEMENT_NOT_PENDING: 'There is no placement test to take.', ALREADY_STARTED: 'This child has already started playing; the starting point can no longer be changed.', INVALID_START: 'Choose a year level for that starting option.', RECOVERY_NOT_FOUND: 'No recovery request exists for that account.', ACCOUNT_DELETED: 'This sign-in account has been deleted.', MULTIPLE_PROVIDER_SUBSCRIPTIONS: 'Your payment account needs a check by support before this change can be made. Nothing has been charged.', PAYMENT_PENDING: 'A plan change is still waiting for its payment. Complete that payment, or wait for it to lapse, before changing the plan again.', RECOVERY_NOT_PENDING: 'That recovery request is no longer pending.', IDENTITY_UNAVAILABLE: 'The sign-in service did not answer. Try again in a moment.',
  MANUAL_GRANT_ACTIVE: 'This family already has pilot access, so the free trial is not needed.', CHECKOUT_REQUIRED: 'Choose a plan to subscribe first; a trial cannot be changed.', PLAN_CHANGE_NOT_AUTHORIZED: 'That payment does not match the plan on record.', RENEWAL_REQUIRED: 'The renewal payment comes first; upgrade after it goes through.', CHANGE_IN_PROGRESS: 'A plan change is already in progress. Try again in a moment.', USE_PLAN_CHANGE: 'Your family is subscribed: change the plan from the subscription controls.', SUBSCRIPTION_CHANGED: 'The subscription changed while this was in progress. Refresh and try again.', LEDGER_REPLAYED: 'That was already done. Refresh to see the result.',
  SEATS_CANNOT_REMOVE: 'Seats can be added here, not taken away.', INVALID_PLAN: 'That plan is not available.', SELECT_CHILDREN_FOR_DOWNGRADE: 'Not enough seats for that many children.', IDEMPOTENCY_CONFLICT: 'That request was already made differently. Refresh and try again.',
  INSUFFICIENT_GRID_COINS: 'Not enough Grid Coins yet.', INSUFFICIENT_REWARD_POINTS: 'Not enough Reward Points yet.',
  ITEM_ALREADY_OWNED: 'You already own that item.', SHIELD_LIMIT: 'You can hold at most two streak shields.',
  EGG_ALREADY_WARMING: 'Your Mystery Egg is already warming.', REWARD_DAILY_LIMIT: 'That reward has reached its daily limit.',
  CRATE_EMPTY: '🎁 Nothing left to find — you own every surprise!', EGG_COLLECTION_COMPLETE: '🥚 Your nest is full — every egg pet is already yours!', // v2's words (1754, 1762)
  ITEM_NOT_OWNED: 'That item is not in your collection.', REWARD_NOT_FOUND: 'That reward is no longer in the store.',
  SCAN_ALREADY_DONE: 'System Scan is already complete this week.', SCAN_LOCKED: 'System Scan unlocks in Sector B after the first tier.',
  INVALID_ANSWER: 'The grid could not read that answer. Check it, then tap Go again.',
};
// The sign-in provider's own refusals: in the parent's words where the cause is known, otherwise the provider's code and text,
// so that a failure can be reported and matched against the provider's own log (the one generic sentence used to hide everything).
const PROVIDER = {
  'auth/invalid-phone-number': 'That mobile number is not valid. Use the international form, for example +62 812 3456 7890.',
  'auth/missing-phone-number': 'Enter the mobile number first.',
  'auth/too-many-requests': 'The sign-in provider has paused requests from this device or number for a while. Wait, then try again.',
  'auth/quota-exceeded': 'The SMS limit for this app has been reached for today. Tell the operator.',
  'auth/captcha-check-failed': 'The \u201cI\u2019m not a robot\u201d check did not pass. Tick it, then send again.',
  'auth/invalid-app-credential': 'The \u201cI\u2019m not a robot\u201d check expired. Tick it again, then send.',
  'auth/operation-not-allowed': 'SMS verification is switched off for this app. Tell the operator.',
  'auth/unauthorized-domain': 'This address is not allowed to sign in. Use the app\u2019s own address.',
  'auth/requires-recent-login': 'Sign in again, then repeat this step.',
  'auth/user-disabled': 'This account is disabled. Contact support.',
  'auth/invalid-credential': 'That email or password did not match.', 'auth/invalid-login-credentials': 'That email or password did not match.', 'auth/wrong-password': 'That email or password did not match.', 'auth/user-not-found': 'That email or password did not match.',
  'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.', 'auth/weak-password': 'Choose a longer password (at least 12 characters).', 'auth/invalid-email': 'That email address is not valid.',
  'auth/network-request-failed': 'No connection to the sign-in provider. Check the network and try again.',
  'auth/code-expired': 'That code has expired. Send a new one.', 'auth/invalid-verification-code': 'That code did not match.',
  'auth/second-factor-already-in-use': 'That mobile number is already enrolled on this account.', 'auth/multi-factor-info-not-found': 'That mobile factor is no longer on the account. Sign in again.',
};
// [^)] rather than [a-z-]: the provider derives a code from its own error text, so one can carry a full stop or
// a digit — auth/internal-error-encountered. is a real one — and the narrower class left the entire message in,
// which printed the code twice and ended the sentence with two full stops.
const providerText = (error) => String(error?.message || '').replace(/^Firebase:\s*/, '').replace(/\s*\(auth\/[^)]+\)\.?$/, '').replace(/^Error\.?$/, '').trim();
// A refusal that may be our own resend ladder without its seconds: the provider's bare internal error, or a
// relayed resource-exhausted whose SMS_WAIT did not survive the trip.
const possibleRefusal = (error) => /resource[-_ ]exhausted/i.test(`${error?.code || ''} ${error?.message || ''}`)
  || (/^auth\/internal-error/.test(String(error?.code || '')) && !providerText(error));
function providerMessage(error) {
  if (PROVIDER[error.code]) return PROVIDER[error.code];
  const text = providerText(error);
  // An internal error with nothing to read is all the provider says when it will not send an SMS — whether our own
  // resend ladder refused or the provider itself failed. Say what the parent can do about either.
  if (!text && /^auth\/internal-error/.test(String(error.code || ''))) return 'The sign-in provider could not send a code just now. If you have asked for one already, the next is spaced out \u2014 wait a few minutes and try again. If this was your first try, tell the operator.';
  return `The sign-in provider refused this step (${error.code})${text ? `: ${text.slice(0, 220)}` : ''}. Tell the operator what it says.`;
}
// Text-only DOM construction: user nicknames and family labels are never HTML.
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
// The one way a dynamic value (a width, a position, a colour) reaches CSS: a custom property set through the CSSOM. The CSP
// (style-src 'self') refuses a style attribute, whether written in markup or set by script, and a style element, silently
// on a phone, so a screen built with one only looks right in a test. Optional, for a DOM without CSSOM.
const setVar = (n, k, v) => n.style?.setProperty(k, v);
function button(label, action, className = '') {
  const b = el('button', label, className); b.type = 'button'; b.onclick = () => (b.disabled ? undefined : run(action)); return b; // a counting-down Send is disabled: nothing runs
}
function field(label, type = 'text', options = {}) {
  const wrap = el('label', null, 'field'), input = el('input');
  wrap.append(el('span', label)); Object.assign(input, { type, required: true, ...options }); wrap.append(input);
  return { wrap, input };
}
// The provider's \u201cI\u2019m not a robot\u201d box renders into #recaptcha. It lives inside the screen that needs it, right under the
// Send button, and the parent is told to tick it: a widget nobody mentioned, appearing under the panel, read as a dead button.
function captchaBox() { const c = el('div', null, 'captcha'); c.id = 'recaptcha'; return c; }
// The number in international form. Separators are fine to type, and `tidy` removes them before the check AND
// before the send, so the string that passed the check is the string the provider is given.
const tidy = (value) => String(value || '').replace(/[\s().-]/g, '');
const e164 = (value) => /^\+[1-9]\d{6,14}$/.test(tidy(value));
// the robot check belongs on the screen from the moment it opens, not only once Send has been pressed
function armCaptcha() { auth().then((a) => a.armCaptcha?.()).catch(() => {}); }
// A child's equipped background dresses that child's screens only (data-bg on <html> and the #decor layer behind #app): the
// launch pad and every parent screen take it off again (applyLook, with the cosmetics layer).
function clearLook() { applyLook(null); }
// The shell follows the role: styles.css hides the parents' masthead from the launch pad and a child's screens, and the footer
// from those. Set as soon as /me answers, so a kid's device does not show the parents' masthead while its first screen loads.
function setMode() {
  const mode = model?.role === 'child' ? 'kid' : model?.role === 'selector' ? 'select' : 'parent';
  document.documentElement?.setAttribute('data-mode', mode); if (mode !== 'kid') clearLook();
}
// variant: one of v2's narrower cards (narrow 420px, w460, w520) or a screen's own class
function panel(kicker, title, subtitle, variant = '') {
  authModule?.resetCaptcha?.(); // the robot check belongs to the screen that built it; one left behind strands its frame
  stopSendClock(); stopTimer(); screenId++; onBack = null; // the same for the Send countdown and a question's clock, and Back is each screen's to set again
  root.replaceChildren(); setMode(); root.setAttribute('aria-live', 'polite'); // a session turns it off while it plays
  const box = el('section', null, variant ? `panel ${variant}` : 'panel');
  box.append(el('p', kicker, 'kicker'), el('h1', title), el('p', subtitle, 'intro muted'));
  root.append(box); return box;
}
// The DOM a test runs this page in has no prepend or insertBefore: a node goes first by rebuilding the list.
const putFirst = (box, node) => box.replaceChildren(node, ...box.children);
// a phone or tablet: the on-screen keypad is the keyboard, so the system one is not opened over it
const coarse = () => Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
// one key of v2's keypad (st.key 3769): it edits a field, it never submits a form by itself
function padKey(label, press, extra = '', aria = '') {
  const b = el('button', label, extra ? `padkey ${extra}` : 'padkey'); b.type = 'button'; b.onclick = press;
  if (aria) b.setAttribute('aria-label', aria); return b;
}
// v2's message colours: mint for a ✓ line, red for a refusal (tone 'bad', from run) or a ✗ or ⚠ line, gold for the rest
function note(text, tone) {
  status.textContent = text || '';
  status.className = !text ? 'message' : `message msg-${tone || (/^✓/.test(text) ? 'ok' : /^[✗⚠]/.test(text) ? 'bad' : 'note')}`;
}
// ---- the Send countdown (the SMS resend ladder, DEPLOY_V3.md section 5) ----
// H:MM:SS with the hours unbounded, so a day's wait reads 24:00:00 rather than a clock that wrapped to 0:00:00.
function hms(seconds) {
  const s = Math.max(0, Math.ceil(Number(seconds) || 0)), pad = (n) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function stopSendClock() { if (sendClock) { clearInterval(sendClock); sendClock = null; } }
// The Send button of the three screens that ask for an SMS: verify mobile, the sign-in challenge, change mobile. The
// owner asked for a clock, not "try again in 15 minutes": until a send is allowed the button is disabled and shows
// the time left as H:MM:SS, ticking each second, and it comes back at zero. The count comes from the provider's
// seconds when a refusal carries them, otherwise from this device's mirror of the ladder (auth.js nextSendAt);
// with neither there is no clock and the parent reads the plain sentence. One clock ticks at a time and panel()
// stops it with its screen, so no interval outlives the button it drives.
function sendControl(label, destination, send) {
  const mine = screenId; let b = null;
  const hold = (until) => {
    if (mine !== screenId) return; // the screen has gone; its button with it
    stopSendClock();
    const tick = () => {
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left <= 0) { stopSendClock(); b.disabled = false; b.textContent = label; return; }
      b.disabled = true; b.textContent = `Send again in ${hms(left)}`;
    };
    tick(); if (b.disabled) sendClock = setInterval(tick, 1000);
  };
  const mirror = async () => { try { return Number(await (await auth()).nextSendAt?.(destination())) || 0; } catch { return 0; } };
  // release: the destination changed (a different number typed), so a clock for the old one no longer applies
  const check = async (release = false) => { const at = await mirror(); if (at > Date.now()) hold(at); else if (release) hold(0); };
  b = button(label, async () => {
    try { await send(); }
    catch (error) {
      if (error?.waitSeconds > 0) { hold(Date.now() + error.waitSeconds * 1000); throw error; }
      if (possibleRefusal(error)) {
        const at = await mirror();
        if (at > Date.now()) { hold(at); throw Error('No code was sent. Codes to one number are spaced out: the Send button counts down to when the next one should be allowed.'); }
      }
      throw error; // the plain sentence (providerMessage) with no clock: nothing to count from
    }
    await check(); // the rung this send has just climbed
  }, 'ghost');
  check(); // a screen opened inside a wait starts counting at once
  return { button: b, check };
}
async function run(fn) {
  if (working) return;
  working = true; root.setAttribute('aria-busy', 'true');
  try { note(''); await fn(); }
  catch (error) {
    note(messages[error.code] || (error.code?.startsWith('auth/') ? providerMessage(error) : error.message || 'Please try again.'), 'bad');
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
  try { model = await api('/me'); csrf = model.csrf; setMode(); await renderModel(); }
  catch (error) {
    if (error.code === 'SIGN_IN_REQUIRED' || error.code === 'SESSION_REVOKED') { model = null; signInScreen(); return; }
    // a child whose seat, PIN or subscription changed under the device goes back to the launch pad — never a dead screen (Stage 4 review, third round)
    if (['CHILD_INACTIVE', 'CHILD_SESSION_REVOKED', 'SUBSCRIPTION_INACTIVE'].includes(error.code)) {
      try { await api('/session/select', {}); model = await api('/me'); csrf = model.csrf; setMode(); await renderModel(); }
      catch { model = null; signInScreen(); }
      note(messages[error.code] || 'Please choose an explorer again.'); return;
    }
    throw error;
  }
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
      await api('/auth/session', { idToken: result.idToken, ...(typeof rememberChoice === 'boolean' ? { remember: rememberChoice } : {}) });
    }
    finally { if (!keepSdkSession) await (await auth()).clear(); result.idToken = ''; rememberChoice = undefined; }
    await refresh(); channel?.postMessage('changed');
    if (afterReady) await afterReady();
    return;
  }
  if (result.stage === 'signin') { signInScreen(false, afterReady, Boolean(afterReady)); note(result.notice); return; }
  if (result.stage === 'verify') {
    const box = panel('STEP 1 OF 3 · EMAIL', 'Check your inbox.', 'Open the verification email, then come back here. Nothing about your family exists until this is done.', 'w460');
    if (afterReady) onBack = cancelVerification;
    box.append(rail(1), button('I have verified my email', async () => authStep(await (await auth()).checkEmail(), afterReady), 'primary'),
      button('Resend verification email', async () => { await (await auth()).resendEmail(); note('Verification email requested.'); }, 'ghost'));
    return;
  }
  const enrolling = result.stage === 'enroll';
  const box = panel(enrolling ? 'STEP 1 OF 3 · MOBILE' : 'SECOND CHECK', enrolling ? 'Protect the command deck.' : 'Your second security check',
    enrolling ? 'Verify your own mobile number. Children never need a phone or an email address.' : `Send a code to ${result.phone || 'your verified mobile'} to finish signing in.`, 'w460');
  if (enrolling) box.append(rail(1));
  if (afterReady) onBack = cancelVerification; // the second check of a parent action: Back abandons the action, as Cancel would
  const phone = field('Mobile number, including country code', 'tel', { placeholder: '+62...', autocomplete: 'tel' });
  const consent = el('input'); consent.type = 'checkbox';
  const consentLabel = el('label', null, 'check');
  consentLabel.append(consent, el('span', 'I agree to receive a verification SMS. Google processes this number for authentication and abuse prevention; carrier charges may apply.'));
  if (enrolling) box.append(phone.wrap, consentLabel);
  const otp = field('SMS verification code', 'text', { inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6, autocomplete: 'one-time-code' });
  // the destination is the typed number when enrolling; on the challenge it is the enrolled factor, which auth.js knows
  const send = sendControl('Send verification code', () => tidy(phone.input.value), async () => {
    if (enrolling && !e164(phone.input.value)) { note('Enter the number in international form, for example +62 812 3456 7890.'); return; }
    note('Tick \u201cI\u2019m not a robot\u201d just below, then the code is sent.'); await (await auth()).sendCode(tidy(phone.input.value), consent.checked); note('Code sent. Enter it below.');
  });
  if (enrolling) phone.input.addEventListener('input', () => send.check(true));
  // Remember this device (owner's request, 11 Sep 2026): asked on a sign-in's own SMS step only. Enrolment ends in a fresh
  // sign-in anyway, and the check of a parent action keeps what the device already had (the server decides that).
  rememberChoice = undefined;
  let remember = null;
  const rememberLabel = !enrolling && !afterReady ? el('label', null, 'check') : null;
  if (rememberLabel) {
    remember = el('input'); remember.type = 'checkbox';
    accountTag(result.email).then((tag) => { try { if (tag && localStorage.getItem(REMEMBER_PREF) === tag) remember.checked = true; } catch { /* no storage: unticked */ } });
    const words = el('span', 'Remember this device for 30 days');
    words.append(el('small', 'Opening the app again from a bookmark or home-screen shortcut skips signing in. Tick it only on a device you trust. \u201cHand over to kids\u201d still locks parent access, and changing your password signs every remembered device out.'));
    rememberLabel.append(remember, words);
  }
  box.append(send.button, captchaBox(), otp.wrap, ...(rememberLabel ? [rememberLabel] : []),
    button('Verify code', async () => {
      if (remember) { rememberChoice = remember.checked; const tag = await accountTag(result.email); try { if (remember.checked && tag) localStorage.setItem(REMEMBER_PREF, tag); else localStorage.removeItem(REMEMBER_PREF); } catch { /* no storage */ } }
      return authStep(await (await auth()).confirmCode(otp.input.value), afterReady);
    }, 'primary'));
  armCaptcha();
  if (!enrolling && result.email) box.append(button('I can\u2019t receive the code', () => recoveryScreen(result.email), 'text-button')); // Stage 4.4
}
// Stage 4.4: the lost-phone ceremony (RECOVERY.md). No session exists here; the server answers the same for any email.
function recoveryScreen(email) {
  reauthEpoch++; model = null;
  const box = panel('ACCOUNT RECOVERY', 'Lost your phone?', 'Recovery takes seven days and needs your email inbox. Nobody can shorten it. Your family and children stay exactly as they are.', 'w460');
  onBack = () => signInScreen();
  box.append(el('p', `1. Start recovery for ${email}.  2. Reset your password from the emailed link \u2014 that proves the inbox is yours.  3. After the waiting period, complete recovery here, then sign in and verify your new mobile.`, 'notice'));
  const when = (ms) => new Date(ms).toLocaleString();
  box.append(button('1. Start recovery', async () => { const r = await api('/auth/recovery/start', { email }); note(`Recovery requested. If this account exists, it can be completed from ${when(r.readyAt)} at the earliest. Now reset your password from the email link.`); }, 'primary'),
    button('2. Send password reset email', async () => { await (await auth()).resetPassword(email); note('If this email can receive a reset link, one has been requested. Set a new password, then come back after the waiting period.'); }, 'ghost'),
    button('3. Complete recovery', async () => {
      const r = await api('/auth/recovery/complete', { email });
      if (r.completed) { signInScreen(); note('Recovery complete. Sign in with your password, then verify your new mobile number.'); return; }
      note('Not completed yet. Recovery needs a request for this email, the password reset from the emailed link, and the waiting period to have passed. Try again later.');
    }, 'ghost'),
    button('Back to sign-in', () => signInScreen(), 'text-button'));
}
// the three steps a parent walks to the grid: lit = here, done = behind
function rail(current) {
  const steps = el('div', null, 'steps');
  ['01  PARENT SIGN-IN', '02  YOUR CREW', '03  KIDS\u2019 MODE'].forEach((t, i) => steps.append(el('span', t, i + 1 < current ? 'done' : i + 1 === current ? 'lit' : '')));
  return steps;
}
function signInScreen(signup = false, afterReady = null, reauth = false) {
  if (!reauth) reauthEpoch++;
  model = null;
  const box = panel(reauth ? 'PARENT VERIFICATION' : 'MISSION CONTROL',
    reauth ? 'Confirm it\u2019s you.' : (signup ? 'A new crew starts here.' : 'Big futures. Small steps.'),
    reauth ? 'This sensitive parent action needs a fresh password and SMS check.' :
      (signup ? 'Create your adult account first. Then build a private grid for your explorers.' : 'One secure parent account. A personal learning grid for every child.'), 'w460');
  if (!reauth) box.append(rail(1));
  if (reauth) onBack = cancelVerification; else if (signup) onBack = () => signInScreen();
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
  if (reauth) box.append(button('Cancel verification', cancelVerification, 'ghost'));
  if (!reauth) box.append(button(signup ? 'Already registered? Sign in' : 'New here? Create a parent account', () => signInScreen(!signup), 'ghost'));
  if (!signup && !reauth) box.append(button('Forgot password?', async () => { if (!email.input.checkValidity()) { email.input.reportValidity(); return; }
    await (await auth()).resetPassword(email.input.value); note('If this email can receive a reset link, one has been requested. Mobile verification is still required.'); }, 'text-button'));
  box.append(el('p', 'EMAIL VERIFIED  //  MOBILE VERIFIED  //  FAMILY-ONLY ACCESS', 'trust'));
}
async function cancelVerification() {
  reauthEpoch++; keepSdkSession = false;
  if (authModule) await authModule.clear();
  await refresh(); note('Verification cancelled. The unfinished action was discarded.');
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
  reauthEpoch++; keepSdkSession = false;
  await api('/auth/logout', {}); if (authModule) await authModule.clear(); channel?.postMessage('changed'); await refresh();
}
function renderModel() {
  if (model.role === 'child') return childScreen();
  if (!model.family) return familySetup();
  return model.role === 'parent' ? parentScreen() : selectorScreen();
}
function familySetup(draft = {}) {
  transientView = true;
  const box = panel('STEP 2 OF 3 · YOUR CREW', 'Name your crew.', 'One private family, linked to your verified parent account. Your explorers join next.');
  box.append(rail(2));
  const label = field('Family display name', 'text', { placeholder: 'Our family', maxLength: 40, value: draft.label || '' });
  const check = el('input'); check.type = 'checkbox';
  const wrap = el('label', null, 'check');
  check.checked = draft.attested === true;
  wrap.append(check, el('span', 'I am an adult responsible for the children I add. I acknowledge this private test stores family profiles and account security events. Use synthetic child data during testing.'));
  // Stage 4: a parent with no family (deleted, or never created) may delete the sign-in account itself
  const leave = el('div', null, 'actions');
  const accountOp = crypto.randomUUID();
  leave.append(button('Delete my sign-in account', async () => {
    if (!window.confirm('Delete your AutoMathtics sign-in account? Your email and mobile number are removed from sign-in. A used free trial stays used.')) return;
    await api('/account/deletion', { operationId: accountOp }); if (authModule) await authModule.clear(); note('Your sign-in account has been deleted.'); await refresh();
  }, 'text-button'));
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
  box.append(el('p', 'No family? You can also remove this sign-in account entirely.', 'small muted'), leave);
}
// The parent's crew cards (their v2 rebuild is port plan step 12); v2's .player-card is the launch pad's alone.
function cards(children) {
  const grid = el('div', null, 'crew-grid');
  for (const child of children) {
    const card = el('div', null, 'crew-card');
    const frame = el('span', null, 'avatar-frame'); frame.append(el('span', icons[child.icon] || icons.robot, 'avatar'));
    card.append(frame, el('strong', child.nickname), el('span', child.status === 'active' ? 'READY FOR THE GRID' : 'PROFILE INACTIVE', 'card-meta'));
    if (child.yearLevel) card.append(el('span', `Year ${child.yearLevel}${child.start === 'test' ? ' · placement test' : ''}`, 'card-meta'));
    grid.append(card);
  }
  return grid;
}
// Stage 3.3: a plan choice starts a checkout on the server. With the pilot's fake provider no money
// moves: the server returns a payment reference the operator completes; a real provider (Stage 4)
// returns a URL to go to. Nothing about the plan or the family is decided in the browser.
function planButtons(box, billing) {
  if (!billing?.plans?.length) return;
  const row = el('div', null, 'actions');
  for (const plan of billing.plans) {
    const op = crypto.randomUUID();
    row.append(button(`${plan.name}: ${plan.seats} child slots`, async () => {
      const r = await api('/billing/checkout', { plan: plan.id, operationId: op });
      if (r.url) { location.href = r.url; return; }
      note(`Pilot mode: no payment is taken. Reference ${r.customerRef}, checkout ${r.checkoutId}. The operator completes it.`);
    }, 'ghost'));
  }
  box.append(el('p', 'Choose a plan to subscribe. Prices are shown at checkout.', 'notice'), row);
  if (billing.customer?.fake) box.append(el('p', `Payment reference: ${billing.customer.fake}`, 'reference'));
}
// Stage 3.4: change plan. Up: now (the provider bills the prorated difference). Down: at the next
// renewal, with the parent choosing who keeps a seat — nobody loses one mid-cycle.
function planChangeControls(box, billing, e, family) {
  if (!billing?.plans?.length) return;
  if (e.scheduled) {
    const keepOp = crypto.randomUUID();
    box.append(el('p', `Switching to ${e.scheduled.planName} (${e.scheduled.seats} child slots) on ${new Date(e.scheduled.at).toLocaleDateString()}.`, 'notice'),
      button('Keep my current plan instead', async () => { await api('/billing/plan', { plan: e.plan, operationId: keepOp }); await refresh(); }, 'text-button'));
  }
  const row = el('div', null, 'actions');
  for (const plan of billing.plans.filter((p) => p.id !== e.plan)) {
    const op = crypto.randomUUID();
    if (plan.seats > e.seatLimit) row.append(button(`Upgrade to ${plan.name} now (${plan.seats} slots)`, async () => {
      const r = await api('/billing/plan', { plan: plan.id, operationId: op });
      if (r.pending) { // Stage 4: the provider holds the upgrade until its payment is complete (a card that needs authentication, or a failed charge)
        note('The payment for this upgrade is not complete yet. Finish it with your card issuer; the plan changes the moment the payment provider confirms it.');
        if (r.invoiceUrl && typeof window !== 'undefined' && window.open) window.open(r.invoiceUrl, '_blank', 'noopener');
        await refresh(); return;
      }
      note(r.proration?.simulated ? `Upgraded. Pilot mode: the prorated difference would be ${(r.proration.chargeCents / 100).toFixed(2)}; nothing is charged.` : 'Upgraded.'); await refresh();
    }, 'ghost'));
    else row.append(button(`Switch to ${plan.name} at renewal (${plan.seats} slots)`, () => downgradeScreen(plan, family, op), 'ghost'));
  }
  box.append(row);
}
function downgradeScreen(plan, family, op) {
  transientView = true;
  const active = family.children.filter((c) => c.status === 'active'), choose = active.length > plan.seats;
  const box = panel('CHANGE PLAN', `${plan.name}: ${plan.seats} child slots`, choose ? `Choose who keeps a seat from the next renewal (up to ${plan.seats}). The others keep all their progress and can be given a seat again later.` : 'The change takes effect at the next renewal. Nobody loses a seat before then.', 'w460');
  onBack = refresh; // every parent sub-screen: Back is its own Back button, to the workspace
  const picks = new Map();
  if (choose) for (const c of active) {
    const label = el('label', null, 'check'), input = document.createElement('input'); input.type = 'checkbox';
    label.append(input, el('span', ` ${c.nickname}`)); picks.set(c.id, input); box.append(label);
  }
  box.append(button(`Switch to ${plan.name} at renewal`, async () => {
    const seatChildIds = [...picks].filter(([, i]) => i.checked).map(([id]) => id);
    await api('/billing/plan', { plan: plan.id, ...(choose ? { seatChildIds } : {}), operationId: op }); note('Plan change scheduled for the next renewal.'); await refresh();
  }, 'primary'), button('Back', refresh, 'ghost'));
}
function deletionScreen(family) {
  transientView = true;
  const box = panel('DELETE FAMILY', family.label, 'The children\u2019s profiles, progress, coins and this family\u2019s settings will be removed after 14 days. Payment records and the security audit trail are kept as required. A used free trial stays used. Your sign-in account itself is separate and is not deleted here.', 'w460');
  const op = crypto.randomUUID(); onBack = refresh;
  box.append(el('p', 'You can cancel any time in the next 14 days from the parent workspace. Download your data first if you want to keep it.', 'notice'),
    button('Delete after 14 days', async () => { await api('/family/deletion', { operationId: op }); note('Deletion scheduled.'); await refresh(); }, 'primary'), button('Back', refresh, 'ghost'));
}
async function parentScreen() {
  const family = model.family, e = family.entitlement || { status: 'inactive', seatLimit: 0, accessUntil: 0 };
  const billing = await api('/billing'); // plans, trial eligibility and the payment reference come from the server, never guessed from /me
  const active = e.status === 'active' && e.accessUntil > Date.now(); // Display only; API is authoritative.
  const box = panel('MISSION CONTROL', family.label, 'Your explorers, your grid. Hand the device over when it\u2019s time to play; parent access stays locked until you sign in again.');
  if (model.recovery && model.recovery.status !== 'pending' && !model.recovery.acknowledgedAt) { // Stage 4.4: a finished recovery request is shown until the parent acknowledges it
    const r = model.recovery, when = new Date(r.requestedAt).toLocaleDateString();
    box.append(el('p', r.status === 'completed' ? `Account recovery requested on ${when} was completed and a new mobile was verified. If that wasn\u2019t you, reset your password now and contact support.`
      : `Account recovery was requested on ${when} and ${r.status === 'cancelled_by_operator' ? 'cancelled by support' : 'cancelled by your sign-in'}. If you didn\u2019t request it, reset your password now.`, 'notice'),
      button('It was me', async () => { try { await api('/auth/recovery/ack', {}); } catch (error) { if (error.code !== 'REAUTHENTICATE') throw error; reauthenticate(async () => { await api('/auth/recovery/ack', {}); await refresh(); }); return; } await refresh(); }, 'ghost')); // a fresh sign-in first: a remembered device must not let anyone hide this
  }
  const summary = el('div', null, 'allowance');
  const STATE = { trial: 'FREE TRIAL', active: 'SUBSCRIBED', grace: 'RENEWAL DUE', past_due: 'PAYMENT OVERDUE', cancelled: 'CANCELLED', expired: 'EXPIRED' };
  summary.append(el('strong', `${family.activeCount} / ${e.seatLimit}`, 'count'), el('span', 'child slots in use'),
    el('span', e.state ? STATE[e.state] || e.state : (active ? 'PILOT ACCESS ACTIVE' : 'AWAITING ACTIVATION'), active ? 'badge' : 'badge pending'));
  box.append(summary, cards(family.children));
  if (e.state) { // a subscription: what it is and when it turns (dates are the server's; the browser only shows them)
    const when = e.accessUntil ? new Date(e.accessUntil).toLocaleDateString() : null;
    const line = e.state === 'trial' ? `${e.planName}${e.cancelAtPeriodEnd ? ', ending' : ', ends'} ${when}. Subscribe before then to keep going.`
      : e.state === 'active' ? `${e.planName} plan, ${e.seatLimit} child slots. ${e.cancelAtPeriodEnd ? `Ends ${when}.` : `Renews ${when}.`}`
      : e.state === 'grace' ? `${e.planName} plan. The renewal payment has not arrived; access continues until ${when}.`
      : e.state === 'past_due' ? `${e.planName} plan. Access is paused until a payment goes through.`
      : e.state === 'cancelled' ? 'The subscription has ended. Subscribe again to reopen the grid.' : 'The subscription expired. Subscribe again to reopen the grid.';
    box.append(el('p', line, 'notice'));
    if (['trial', 'active', 'grace'].includes(e.state)) {
      const cancelOp = crypto.randomUUID(); // one id per rendered button: a retried click is the same event
      box.append(button(e.cancelAtPeriodEnd ? 'Keep my subscription' : 'Cancel at the end of the period', async () => { await api('/billing/cancel', { undo: e.cancelAtPeriodEnd, operationId: cancelOp }); await refresh(); }, 'text-button'));
      // a child without a seat can be given a free one (adding only; a downgrade is the only way a seat is taken away)
      const seated = family.children.filter((c) => c.status === 'active').map((c) => c.id);
      if (active && seated.length < e.seatLimit) for (const c of family.children.filter((c) => c.status !== 'active')) {
        const seatOp = crypto.randomUUID();
        box.append(button(`Give ${c.nickname} a seat`, async () => { await api('/billing/seats', { childIds: [...seated, c.id], operationId: seatOp }); await refresh(); }, 'ghost'));
      }
      if (['active', 'grace'].includes(e.state)) planChangeControls(box, billing, e, family);
    }
    if (!['active', 'grace'].includes(e.state)) planButtons(box, billing);
  } else if (!active) {
    planButtons(box, billing);
    if (billing?.trial?.eligible) {
      const trialOp = crypto.randomUUID();
      box.append(el('p', 'Your parent account is ready. Start the free trial to open two child slots for seven days.', 'notice'),
        button('Start the 7-day free trial', async () => { await api('/billing/trial', { operationId: trialOp }); note('Trial started.'); await refresh(); }, 'primary'));
    } else {
      box.append(el('p', `${messages[billing?.trial?.reason] || 'The free trial is not available for this family.'} Ask the pilot operator to activate child slots.`, 'notice'));
    }
  }
  const row = el('div', null, 'actions');
  if (active && family.activeCount < e.seatLimit) row.append(button('Add a child', addChildScreen, 'primary'));
  if (family.children.length) row.append(button('Hand over to kids', async () => {
    if (authModule) await authModule.clear(); await api('/session/lock', {}); channel?.postMessage('changed'); await refresh();
  }, 'primary'));
  if (family.children.length) row.append(button('Game & progress', parentGameScreen, 'ghost'));
  row.append(button('Sign out', signOut, 'ghost')); box.append(row);
  if (model?.rememberedUntil) box.append(el('p', `This device stays signed in until ${new Date(model.rememberedUntil).toLocaleDateString()}. Sign out to forget it.`, 'notice')); // Remember this device
  box.append(button('Change my mobile number', changeMobileScreen, 'text-button')); // Stage 4 review: the old phone still works, the number is changing
  for (const child of family.children) { box.append(button(`Reset ${child.nickname}\u2019s PIN`, () => resetPinScreen(child), 'text-button')); box.append(button(`Change ${child.nickname}\u2019s starting point`, () => startScreen(child), 'text-button')); }
  // Stage 3.5: the family's own data to keep, and the way to leave — 14 days to change your mind
  const keep = el('div', null, 'actions');
  keep.append(button('Download my family\u2019s data', async () => {
    const data = await api('/family/export'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `automathtics-family-${family.id.slice(0, 8)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }, 'text-button'));
  if (family.deletion) {
    const cancelOp = crypto.randomUUID();
    box.append(el('p', `This family is scheduled for deletion on ${new Date(family.deletion.effectiveAt).toLocaleDateString()}. Everything except the payment records and the security audit trail will be removed.`, 'notice'));
    keep.append(button('Keep my family', async () => { await api('/family/deletion/cancel', { operationId: cancelOp }); note('Deletion cancelled.'); await refresh(); }, 'primary'));
  } else {
    keep.append(button('Delete this family', () => deletionScreen(family), 'text-button'));
  }
  box.append(keep);
  box.append(el('p', `Family reference: ${family.id}`, 'reference'));
}
// Stage 4 review: the parent still has the old phone and wants a new number on the account (RECOVERY.md). A fresh sign-in
// first — password and a code to the old number — then a code to the new number; the new factor is enrolled before the old
// one goes, so there is never a moment without a second factor. The server is not involved: its next sign-in sees the new
// factor and the phone key follows the number.
function changeMobileScreen() {
  keepSdkSession = true;
  reauthenticate(async () => {
    transientView = true;
    const box = panel('CHANGE MOBILE', 'Your new number.', 'A code goes to the new number. The old one stops working for sign-in the moment the new one is verified.', 'w460');
    const cancel = async () => { keepSdkSession = false; if (authModule) await authModule.clear(); await refresh(); };
    onBack = cancel;
    const phone = field('New mobile number, including country code', 'tel', { placeholder: '+62...', autocomplete: 'tel' });
    const consent = el('input'); consent.type = 'checkbox'; const consentLabel = el('label', null, 'check');
    consentLabel.append(consent, el('span', 'I agree to receive a verification SMS on this number. Google processes it for authentication and abuse prevention; carrier charges may apply.'));
    const otp = field('SMS verification code', 'text', { inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6, autocomplete: 'one-time-code' });
    const send = sendControl('Send code to the new number', () => tidy(phone.input.value), async () => {
      if (!e164(phone.input.value)) { note('Enter the number in international form, for example +62 812 3456 7890.'); return; }
      note('Tick \u201cI\u2019m not a robot\u201d just below, then the code is sent.'); await (await auth()).changeMobileSend(tidy(phone.input.value), consent.checked); note('Code sent to the new number. Enter it below.');
    });
    phone.input.addEventListener('input', () => send.check(true)); // the clock belongs to the number typed
    box.append(phone.wrap, consentLabel, send.button, captchaBox(), otp.wrap,
      button('Verify new number', async () => {
        const r = await (await auth()).changeMobileConfirm(otp.input.value); keepSdkSession = false;
        await api('/auth/logout', {}); channel?.postMessage('changed'); model = null; signInScreen(); note(r.notice); // the next sign-in carries the new factor
      }, 'primary'),
      button('Cancel', cancel, 'ghost'));
    armCaptcha();
  });
}
function pinFields() {
  const first = field('Six-digit child PIN', 'password', { inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6, autocomplete: 'new-password' });
  const repeat = field('Repeat child PIN', 'password', { inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6, autocomplete: 'new-password' });
  return { first, repeat, valid: () => first.input.checkValidity() && first.input.value === repeat.input.value };
}
// Where a child starts. Sector A is Year 1 primary, B Year 2 … F Year 6 — but children arrive at different
// skill and speed levels and schools differ, so the recommended way in is a short timed test at the
// year's sector; the parent may also start the child straight at the year's sector, or from A1.
function startChooser(defaults = {}) {
  const wrap = el('div', null, 'field'); wrap.append(el('span', 'Year level (primary)'));
  const year = el('select'); year.setAttribute('aria-label', 'Year level');
  for (let y = 1; y <= 6; y++) { const o = el('option', `Year ${y} · Sector ${'ABCDEF'[y - 1]}`); o.value = String(y); year.append(o); }
  year.value = String(defaults.yearLevel || 1); wrap.append(year);
  const options = el('div', null, 'options'), picks = new Map();
  const add = (value, label, detail, checked) => { const l = el('label', null, 'check'); const i = document.createElement('input'); i.type = 'radio'; i.name = 'start'; i.value = value; i.checked = checked; l.append(i, el('span', ` ${label}`), el('small', detail, 'muted')); picks.set(value, i); options.append(l); };
  add('test', 'Option 1 · Placement test (recommended)', 'About 10–20 minutes, timed. Engine and Navigator questions from the middle of the year\u2019s sector; graded on results and time. Each track starts where the child is ready.', (defaults.start || 'test') === 'test');
  add('year', 'Option 2 · Start at the year\u2019s sector', 'Both tracks begin at paper 1 of the sector for this year level.', defaults.start === 'year');
  add('a1', 'Option 3 · Start from the beginning (A1)', 'Both tracks begin at Sector A, paper 1.', defaults.start === 'a1');
  return { wrap, options, year, value: () => [...picks].find(([, i]) => i.checked)?.[0] || 'test', inputs: [year, ...picks.values()] };
}
function addChildScreen(draft = {}) {
  transientView = true;
  const box = panel('NEW CHILD PROFILE', 'Meet your next explorer.', 'A nickname and an icon are all the grid needs. Age and year level help us place the explorer. No child email, phone number, photo or full birth date \u2014 ever.', 'w460');
  onBack = refresh;
  const name = field('Nickname', 'text', { maxLength: 24, autocomplete: 'off', value: draft.nickname || '' });
  const select = el('select'); select.setAttribute('aria-label', 'Profile icon');
  for (const [key, icon] of Object.entries(icons)) { const option = el('option', `${icon} ${key}`); option.value = key; select.append(option); }
  select.value = draft.icon || 'fox';
  const age = field('Age', 'number', { min: 3, max: 17, inputMode: 'numeric', value: draft.age || '' });
  const start = startChooser(draft);
  const { first, repeat, valid } = pinFields();
  let requestId = crypto.randomUUID();
  for (const input of [name.input, select, age.input, ...start.inputs, first.input, repeat.input]) input.addEventListener('input', () => { requestId = crypto.randomUUID(); });
  box.append(name.wrap, select, first.wrap, repeat.wrap, age.wrap, start.wrap, start.options, button('Create child profile', async () => {
    if (!valid()) { note('Enter the same six-digit PIN twice.'); return; }
    const ageValue = Number(age.input.value); if (!Number.isInteger(ageValue) || ageValue < 3 || ageValue > 17) { note('Enter the child\u2019s age (3–17).'); return; }
    try {
      await api('/children', { nickname: name.input.value, icon: select.value, pin: first.input.value, age: ageValue, yearLevel: Number(start.year.value), start: start.value() }, requestId);
      first.input.value = repeat.input.value = ''; await refresh();
    } catch (error) {
      if (error.code !== 'REAUTHENTICATE') throw error;
      const saved = { nickname: name.input.value, icon: select.value, age: age.input.value, yearLevel: Number(start.year.value), start: start.value() };
      first.input.value = repeat.input.value = '';
      reauthenticate(() => { addChildScreen(saved); note('Parent verified. Re-enter the child PIN to finish creating this profile.'); });
    }
  }, 'primary'), button('Back to family', refresh, 'ghost'));
}
function startScreen(child) {
  transientView = true;
  const box = panel('LAUNCH POINT', child.nickname, 'Only possible before the child has played anything. A recent parent sign-in is required.', 'w460');
  onBack = refresh;
  const start = startChooser({ yearLevel: child.yearLevel, start: child.start });
  box.append(start.wrap, start.options, button('Save starting point', async () => {
    try { await api(`/children/${child.id}/start`, { start: start.value(), yearLevel: Number(start.year.value) }); note('Starting point saved.'); await refresh(); }
    catch (error) { if (error.code === 'ALREADY_STARTED') { note(messages.ALREADY_STARTED); return; } throw error; }
  }, 'primary'), button('Back', refresh, 'ghost'));
}
function resetPinScreen(child) {
  transientView = true;
  const box = panel('PARENT ACTION', `Reset ${child.nickname}\u2019s PIN`, 'This invalidates existing child sessions. A recent parent sign-in is required.', 'narrow');
  onBack = refresh;
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
// ---- the launch pad and the kid's PIN (v2 player selection 2392-2442, kidPin 2445-2465) ----
// A child's colour is its place in the family (S1 accent, styles.css acc-N: v2's new-player palette).
const accClass = (child) => `acc-${Number.isInteger(child?.accent) && child.accent >= 0 ? child.accent % 6 : 0}`;
// A child's avatar: the icon emoji in v2's makeAvatar look (106-107), a dark disc ringed in the child's colour. v3 keeps no
// photos of children, so the icon stands where v2 showed Allison's and Geralt's (port plan, question 2). Given the wallet, the
// equipped ring goes round it (v2 2863-2865 on the home header, 3114-3115 in a session, where the spark's orbit is smaller).
function avatarBadge(child, w, size) {
  const disc = el('span', icons[child?.icon] || icons.robot, `av av-${size} ${accClass(child)}`); disc.setAttribute('aria-hidden', 'true');
  const ring = lookup(RING_CLASS, w?.ring); if (!ring) return disc;
  const wrap = el('span', null, `ring ${ring}${size < 30 ? ' orb-sm' : ''}`); wrap.append(disc); return wrap;
}
// v2's player card: the frame with its halo rings, the name in its name effect, and what the child wears (S1: /me sends the
// look, never the wallet) — the title or MISSION READY, then pet and outfit, then vehicle (v2 2416). The button's class is
// exactly player-card; the colour rides an inner span, which carries the card's face.
function playerCard(child, pick) {
  const a = child.appearance || {}, card = el('button', null, 'player-card'); card.type = 'button';
  card.onclick = () => run(() => pick(child)); card.setAttribute('aria-label', `Play as ${child.nickname}`);
  const face = el('span', null, `player-card-face ${accClass(child)}`), frame = el('span', null, 'player-avatar-frame');
  if (a.ring === 'ring_prestige') frame.append(el('span', null, 'frame-prestige'));
  frame.append(el('span', icons[child.icon] || icons.robot, 'player-avatar'));
  const meta = el('span', null, 'player-meta');
  meta.append(el('span', null, 'status-dot'), `${a.title?.name || 'MISSION READY'}${a.pet ? ` · ${a.pet.emoji}${a.outfit?.emoji || ''}` : ''}${a.vehicle ? ` ${a.vehicle.emoji}` : ''}`);
  const go = el('span', 'ENTER GRID ', 'player-enter'); go.append(el('span', '→'));
  face.append(el('span', null, 'player-card-grid'), frame, el('span', child.nickname, `player-name ${lookup(NAMEFX_CLASS, a.nameFx)}`.trim()), meta, go);
  card.append(face); return card;
}
function selectorScreen() {
  const box = panel('AUTOMATHTICS · MATH GRID', 'PLAYER SELECTION', 'who\'s on a mission today?', 'select-shell');
  const grid = el('div', null, 'player-grid');
  for (const child of model.family.children.filter((c) => c.status === 'active')) grid.append(playerCard(child, pinPane));
  const row = el('div', null, 'row-buttons selection-row');
  row.append(button('🔐 Return to parent sign-in', () => signInScreen(), 'selection-admin'), button('Sign out', signOut, 'text-button'));
  box.append(grid, row);
}
// The PIN is six digits (v2's were four), typed on v2's keypad into a real password field, which a keyboard can use too.
// The sixth digit on the keypad sends it; the server checks it, counts the misses and locks after five.
function pinPane(child) {
  transientView = true;
  const box = panel(`${child.nickname} · ENTER PIN`, '', '', 'narrow pin-pane');
  onBack = refresh; // back to the launch pad
  putFirst(box, avatarBadge(child, null, 84)); // v2's PIN pad shows the face alone, no ring
  const wrap = el('label', null, 'pin-field'), pin = el('input', null, 'pin-box');
  Object.assign(pin, { type: 'password', inputMode: coarse() ? 'none' : 'numeric', maxLength: 6, pattern: '[0-9]{6}', autocomplete: 'off', required: true, placeholder: 'enter PIN…' });
  wrap.append(el('span', 'Child PIN', 'sr-only'), pin);
  const enter = async () => {
    const code = pin.value; pin.value = '';
    try { await api(`/children/${child.id}/enter`, { pin: code }); }
    catch (error) { pin.className = 'pin-box'; void pin.offsetWidth; pin.className = 'pin-box bad shake'; throw error; } // the refusal itself is read from #message
    channel?.postMessage('changed'); await refresh();
  };
  const put = (digit) => { if (pin.value.length >= 6) return; pin.className = 'pin-box'; pin.value += digit; if (pin.value.length === 6) run(enter); };
  const pad = el('div', null, 'pad pin-pad');
  for (const d of '123456789') pad.append(padKey(d, () => put(d)));
  pad.append(padKey('⌫', () => { pin.className = 'pin-box'; pin.value = pin.value.slice(0, -1); }, 'back', 'Delete'), padKey('0', () => put('0')), padKey('✓', () => run(enter), 'ok', 'Enter PIN'));
  pin.addEventListener('keydown', (event) => { if (event.key === 'Enter') run(enter); });
  pin.addEventListener('input', () => { pin.className = 'pin-box'; });
  const row = el('div', null, 'row-buttons');
  row.append(button('Enter my grid', enter, 'primary'), button('Back', refresh, 'ghost'));
  box.append(wrap, pad, row);
  if (!coarse()) pin.focus();
}
// ---- secure learning + migrated v2 game layer ----
// qpp: questions per paper (display mirror of progress.mjs Q_PER_PAPER); c: the track's colour class (v2 170-173)
const TRACK = { engine: { name: 'ENGINE', label: 'Engine', emoji: '⚙️', qpp: 5, c: 'c-cyan' }, nav: { name: 'NAVIGATOR', label: 'Navigator', emoji: '🧭', qpp: 3, c: 'c-gold' } };
const EQUIP_SLOT = { pet: 'activePet', fx: 'activeFx', snd: 'activeSnd', bg: 'activeBg', ring: 'ring', outfit: 'activeOutfit', shout: 'activeShout', timer: 'activeTimer', title: 'activeTitle', namefx: 'activeNameFx', map: 'activeMap', vehicle: 'activeVehicle', base: 'activeBase' };
// The v2 look (main:src/automathtics-src.jsx): display constants only. Prices, crate rolls, unlocks and every other outcome
// stay with the server; these say how a result it sent is drawn.
const LEVEL_NAMES = ['Addition (hundreds)', 'Subtraction', 'Multiplication', 'Division', 'Fractions I', 'Fractions II']; // by level, as engine.mjs LEVELS
// the shop in v2's order: the kinds a section holds, its header, its colour class (styles.css c-*) and its note
const SHOP_SECTIONS = [
  [['crate', 'egg'], '🎁 SURPRISES', 'c-gold', 'a box is a random new look · an egg hatches into a pet you can’t buy'],
  [['pet'], '🐉 CYBER PETS', 'c-violet', null],
  [['outfit'], '👒 PET OUTFITS', 'c-magenta', 'your pet wears it everywhere'],
  [['ring'], '⭕ AVATAR RINGS', 'c-cyan', null],
  [['bg'], '🌆 BACKGROUNDS', 'c-magenta', null],
  [['fx'], '🎆 SPLASH FX', 'c-gold', null],
  [['snd'], '🎵 SOUND PACKS', 'c-mint', null],
  [['shout'], '🔥 COMBO SHOUTS', 'c-magenta', 'what the screen yells at 4 · 9 · 14 · 18 in a row'],
  [['timer'], '⏱️ TIMER BARS', 'c-cyan', null],
  [['title'], '🏷️ TITLES', 'c-gold', 'shows under your name'],
  [['namefx'], '✨ NAME FX', 'c-violet', null],
  [['map'], '🗺️ MAP THEMES', 'c-mint', 'recolours your level route'],
  [['vehicle'], '🚀 GARAGE', 'c-gold', 'home screen · map route · launches on every pass'],
  [['base'], '🛰️ BASE UPGRADE', 'c-cyan', null],
  [['shield'], '🛡️ UTILITY', 'c-txt', null],
];
// the combo shout's words per pack, one per streak tier (4, 9, 14 and 18 right in a row); `default` when none is equipped
const SHOUT_PACKS = {
  default: { labels: ['COMBO!', 'SUPER COMBO!', 'HYPER COMBO!', 'ULTRA COMBO!!'], cls: '' },
  shout_kapow: { labels: ['POW!', 'KAPOW!', 'BOOM!!', 'KA-BLAMMO!!!'], cls: 'shout-kapow' },
  shout_turbo: { labels: ['TURBO!', 'OVERDRIVE!', 'HYPERDRIVE!', 'WARP SPEED!!'], cls: 'shout-turbo' },
  shout_robot: { labels: ['NICE.HUMAN', 'IMPRESSIVE', 'MAXIMUM.POWER', 'LEGENDARY.EXE'], cls: 'shout-robot' },
  shout_dino: { labels: ['RAWR!', 'MEGA RAWR!', 'ULTRA RAWR!', 'T-REX MODE!!'], cls: 'shout-dino' },
};
// a map theme recolours the lit route, the five check points and the grid (SVG attributes and setVar('--grid'), never a style)
const MAP_THEMES = {
  map_lava: { lit: '#FF5A2D', cps: ['#FFB020', '#FF7A2D', '#FF5A2D', '#FF2D55', '#FF2DA8'], grid: 'rgba(255,90,45,.07)' },
  map_ice: { lit: '#8FE9FF', cps: ['#EAF2FF', '#B8F1FF', '#8FE9FF', '#5CC8FF', '#8A9BFF'], grid: 'rgba(143,233,255,.08)' },
  map_matrix: { lit: '#2DFF6B', cps: ['#B6FFB0', '#7CFF8A', '#2DFF6B', '#00D95F', '#2DFFB3'], grid: 'rgba(45,255,107,.07)' },
  map_gold: { lit: '#FFD54F', cps: ['#FFF3B0', '#FFE082', '#FFD54F', '#FFB020', '#FF8F00'], grid: 'rgba(255,213,79,.08)' },
};
const FX_SETS = { default: ['⚡', '🪙', '🪙'], fx_confetti: ['🎊', '⚡', '🪙'], fx_lightning: ['🌩️', '⚡', '⚡'], fx_goldrain: ['💰', '🪙', '🪙'] }; // what a coin burst throws
// what the frozen server catalogue (game.mjs SHOP_ITEMS) does not say: the legendary tags, the big items' blurbs, the kinds used up
const LEGEND = { pet_legend: 'legendary', pet_semilegend: 'semi' };
const BLURB = {
  ring_prestige: 'a spinning rainbow holo-frame with an orbiting spark — on your face everywhere it shows',
  veh_bike: 'parks on your home screen, rides your map route, roars off every time you pass',
  veh_rocket: 'parks on your home screen, rides your map route, blasts off every time you pass',
  veh_mech: 'the biggest thing in the garage — home screen, map route, and a launch on every pass',
  base_deck: 'your whole home screen becomes a starship bridge — live radar, HUD corners, scanlines',
  crate: 'one random new look you don’t have yet — could be rare!',
  egg: 'keep it warm for 5 passes and it hatches into a pet nobody can buy',
};
// v2 dims a card whose price is out of reach unless the item carries its `consumable` flag (3248), which v2's catalogue gave the
// Surprise Box and the Mystery Egg only (857-858): its shield (856) has none, so a shield out of reach dims like a pet. Kept so.
const CONSUMABLE = new Set(['crate', 'egg']);
// what a Surprise Box can hold, and the kinds that come out rarely (game.mjs CRATE_KINDS, CRATE_RARE): the count on OPEN and the
// ✨ on the reveal. The roll itself is the server's.
const CRATE_KINDS = new Set(['outfit', 'shout', 'timer', 'title', 'namefx', 'map']), CRATE_RARE = new Set(['namefx', 'map']);
// equipped item id → class name, so only a catalogue id ever becomes a class (bg ids are also the page's data-bg values)
const RING_CLASS = { ring_pulse: 'ringpulse', ring_halo: 'ringhalo', ring_prestige: 'ringprestige' };
const NAMEFX_CLASS = { nfx_rainbow: 'namefx-rainbow', nfx_glitch: 'namefx-glitch', nfx_gold: 'namefx-gold' };
const TBAR_CLASS = { tbar_bolt: 'tbar-tbar_bolt', tbar_lava: 'tbar-tbar_lava', tbar_rainbow: 'tbar-tbar_rainbow', tbar_pixel: 'tbar-tbar_pixel' };
const BGCARD_CLASS = { bg_symbols: 'bgcard-bg_symbols', bg_city: 'bgcard-bg_city', bg_space: 'bgcard-bg_space' };
// own keys only: an id is the server's, and 'constructor' must not find Object's
const lookup = (map, id, fallback = '') => (typeof id === 'string' && Object.hasOwn(map, id) ? map[id] : fallback);
// ---- the cosmetics layer: how each equipped item is drawn (port plan section 3; styles.css draws them) ----
// The equipped background dresses the whole page on every screen of the child's (v2 2382-2385): data-bg on <html>, which
// styles.css turns into the page's colours, and the decor it animates in #decor. The decor is built again only when the
// background changes — never per screen — so each question of a session repaints #app and leaves the falling symbols be.
let lookBg = null;
const rnd = (a, b) => a + Math.random() * (b - a), anyOf = (xs) => xs[Math.floor(Math.random() * xs.length)];
const MRAIN = [...'0123456789+−×÷=πΣ√%<>'], MRAIN_COLORS = ['#FF2DA8', '#35E0FF', '#8A5CFF', '#FF75C6', '#4FC3FF', '#B9A4FF'];
// one piece of decor: its place, size, colour and timing are custom properties (setVar), never a style
function decorPiece(className, vars, text) { const s = el('span', text, className); for (const [k, v] of Object.entries(vars)) setVar(s, k, v); return s; }
const DECOR = {
  // bg_symbols (MatrixDecor, 1435-1455): sixteen columns of sixteen math glyphs, falling in the palette's neons
  bg_symbols: () => Array.from({ length: 16 }, () => decorPiece('mrain', { '--l': `${rnd(0, 98).toFixed(1)}%`, '--fs': `${13 + Math.floor(Math.random() * 8)}px`, '--col': anyOf(MRAIN_COLORS),
    '--op': rnd(0.3, 0.65).toFixed(2), '--dur': `${rnd(4.5, 10).toFixed(1)}s`, '--delay': `${(-Math.random() * 9).toFixed(1)}s` }, Array.from({ length: 16 }, () => anyOf(MRAIN)).join('\n'))),
  // bg_space (SpaceDecor, 1413-1433): 46 twinkling stars and three rare comets
  bg_space: () => [
    ...Array.from({ length: 46 }, () => decorPiece('star', { '--x': `${rnd(0, 100).toFixed(1)}%`, '--y': `${rnd(0, 100).toFixed(1)}%`, '--s': `${rnd(1, 3).toFixed(1)}px`, '--dur': `${rnd(1.6, 4.6).toFixed(2)}s`, '--delay': `${rnd(0, 4).toFixed(2)}s` })),
    ...Array.from({ length: 3 }, (_, i) => decorPiece('comet', { '--x': `${rnd(25, 90).toFixed(1)}%`, '--y': `${rnd(0, 35).toFixed(1)}%`, '--dur': `${rnd(8, 13).toFixed(1)}s`, '--delay': `${(i * 3.7 + rnd(0, 2)).toFixed(1)}s` })),
  ],
  // bg_city (CityDecor, 1457-1477): a lit skyline of fourteen blocks, and five pulsing signs
  bg_city: () => {
    const line = el('div', null, 'cityline');
    line.append(...Array.from({ length: 14 }, () => decorPiece('bld', { '--w': `${Math.round(rnd(34, 86))}px`, '--h': `${Math.round(rnd(60, 190))}px` })));
    return [line, ...Array.from({ length: 5 }, () => decorPiece('citysign', { '--x': `${rnd(4, 94).toFixed(1)}%`, '--y': `${rnd(55, 85).toFixed(1)}%`, '--col': anyOf(['#FF2DA8', '#35E0FF', '#FFB020']), '--delay': `${rnd(0, 3).toFixed(1)}s` }))];
  },
};
// Runs after panel() on every child screen (panel's setMode takes the look off everywhere else). Only a background the
// cosmetics layer knows becomes data-bg.
function applyLook(w) {
  const bg = typeof w?.activeBg === 'string' && Object.hasOwn(DECOR, w.activeBg) ? w.activeBg : null, html = document.documentElement;
  if (bg) html?.setAttribute('data-bg', bg); else html?.removeAttribute('data-bg');
  if (bg === lookBg) return;
  lookBg = bg; document.getElementById?.('decor')?.replaceChildren(...(bg ? DECOR[bg]() : []));
}
// The pet (2866-2870, 3122, 3604-3606): its emoji with the outfit riding its shoulder (an outfit shows only on a pet, 2868,
// and not on the summary's big pet, 3605). On the home header it idles, legendary ones glowing gold (2867, 4212); in a
// session it sways, or charges at streak tier 1-4 (4153-4161); on a pass it pops.
function petBadge(w, size, state = 'idle') {
  const pet = gameItem(w?.activePet); if (pet?.kind !== 'pet') return null;
  const motion = state === 'idle' ? `petidle${lookup(LEGEND, pet.id) ? ' petlegend' : ''}` : state === 'pop' ? 'pop2' : state > 0 ? `petcharge petcharge-${Math.min(4, state)}` : 'petsway';
  const badge = el('span', pet.emoji, `petwrap pet-${size} ${motion}`); badge.setAttribute('aria-hidden', 'true');
  const fit = gameItem(w.activeOutfit); if (fit?.kind === 'outfit' && state !== 'pop') badge.append(el('span', fit.emoji, 'petfit'));
  return badge;
}
// a title is its name alone, in v2's gold chip (1726, 2877, 4218)
function titleChip(w) { const t = gameItem(w?.activeTitle); return t?.kind === 'title' ? el('span', t.name, 'titlechip') : null; }
// the child's name in its name effect (4219-4231), drawn in capitals as v2 wrote it
function nameSpan(nickname, w) { return el('span', nickname, `caps ${lookup(NAMEFX_CLASS, w?.activeNameFx)}`.trim()); }
let timer = null, gameModel = null, playStreak = 0, audioCtx = null;
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
// ---- v2's arcade sounds (989-1086): WebAudio tones, no files. The equipped pack is the voice — the default grid chimes when
// nothing is equipped (as v2 played them), snd_retro's 8-bit squares, snd_space's sine glides. The audio context is made by
// the first tap that sounds (a browser allows audio from a tap), and anything that fails is silence.
function ac() {
  try { const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return null; audioCtx ||= new Ctx(); if (audioCtx.state === 'suspended') audioCtx.resume?.(); return audioCtx; } catch { return null; }
}
function voice(f0, f1, at, dur, type, vol, glides) {
  const c = ac(); if (!c) return;
  try {
    const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + at; o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (glides) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.85);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + (glides ? 0.015 : 0.012)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  } catch { /* silence */ }
}
const tone = (f, at, dur, type, vol) => voice(f, f, at, dur, type, vol, false), glide = (f0, f1, at, dur, type, vol) => voice(f0, f1, at, dur, type, vol, true);
const SOUNDS = {
  correct: { snd_retro: () => { tone(523.3, 0, 0.05, 'square', 0.11); tone(659.3, 0.05, 0.05, 'square', 0.11); tone(1046.5, 0.1, 0.08, 'square', 0.11); },
    snd_space: () => { glide(500, 1300, 0, 0.22, 'sine', 0.2); glide(1000, 2600, 0.05, 0.22, 'sine', 0.08); },
    default: () => { tone(880, 0, 0.09, 'triangle', 0.18); tone(1318.5, 0.07, 0.12, 'triangle', 0.18); } },
  paper: { snd_retro: () => { [392, 523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, i * 0.07, 0.07, 'square', 0.12)); tone(1046.5, 0.4, 0.18, 'square', 0.1); },
    snd_space: () => { glide(400, 900, 0, 0.3, 'sine', 0.2); glide(600, 1400, 0.12, 0.3, 'sine', 0.16); glide(900, 2200, 0.24, 0.4, 'sine', 0.12); },
    default: () => { tone(659.3, 0, 0.1, 'triangle', 0.2); tone(830.6, 0.09, 0.1, 'triangle', 0.2); tone(987.8, 0.18, 0.12, 'triangle', 0.2); tone(1318.5, 0.28, 0.22, 'triangle', 0.22); } },
  kaching: { snd_retro: () => { tone(987.8, 0, 0.09, 'square', 0.14); tone(1318.5, 0.09, 0.5, 'square', 0.13); },
    snd_space: () => { tone(2093, 0, 0.5, 'sine', 0.12); tone(3135.9, 0.08, 0.6, 'sine', 0.08); glide(1568, 3520, 0.12, 0.5, 'sine', 0.07); },
    default: () => { tone(2093, 0, 0.28, 'square', 0.06); tone(2637, 0.05, 0.32, 'square', 0.06); tone(2093, 0.16, 0.24, 'sine', 0.14); tone(2637, 0.2, 0.34, 'sine', 0.14); tone(3135.9, 0.24, 0.4, 'sine', 0.1); } },
  wrong: { snd_retro: () => { tone(147, 0, 0.09, 'square', 0.07); tone(110, 0.09, 0.14, 'square', 0.07); },
    snd_space: () => glide(420, 160, 0, 0.28, 'sine', 0.14),
    default: () => tone(196, 0, 0.16, 'sawtooth', 0.06) },
};
function sound(kind) { const set = SOUNDS[kind]; if (set) lookup(set, gameModel?.wallet?.activeSnd, set.default)(); }
// a coin burst (MoneySplash 1479-1505): the equipped splash set's glyphs fly out — 9 when a paper closes, 16 on a pass, 26 on
// a big one. Each coin's flight is custom properties; one timer (never a loop) takes the burst away once it has flown.
function moneySplash(size = 'pass') {
  const set = lookup(FX_SETS, gameModel?.wallet?.activeFx, FX_SETS.default), mini = size === 'mini', burst = el('div', null, 'splash');
  burst.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < (mini ? 9 : size === 'big' ? 26 : 16); i++) {
    burst.append(decorPiece('coin', { '--dx': `${Math.round(rnd(-1, 1) * (mini ? 110 : 170))}px`, '--dy': `${-Math.round((mini ? 40 : 70) + Math.random() * (mini ? 70 : 150))}px`,
      '--rot': `${Math.round(rnd(-1, 1) * 320)}deg`, '--delay': `${rnd(0, 0.3).toFixed(2)}s`, '--fs': `${Math.round((20 + Math.random() * 12) * (mini ? 0.7 : 1))}px` }, anyOf(set)));
  }
  setTimeout(() => burst.remove?.(), 1500); // the last coin lands at 1.45 s
  return burst;
}
// read a Navigator question aloud (v2 199-207): the browser's own speech, nothing leaves the device
function speak(text) {
  try {
    const s = window.speechSynthesis; if (!s || !window.SpeechSynthesisUtterance) return; s.cancel();
    const u = new window.SpeechSynthesisUtterance(String(text).replace(/___/g, ' blank ').replace(/×/g, ' times ').replace(/÷/g, ' divided by ').replace(/–/g, ' to ')
      .replace(/m²/g, ' square metres').replace(/cm³/g, ' cubic centimetres').replace(/cm²/g, ' square centimetres'));
    u.rate = 0.92; s.speak(u);
  } catch { /* no speech */ }
}
const gameItem = (id) => gameModel?.catalog?.find((x) => x.id === id) || null;
// ---- the child's home (v2 2859-3073): the header above the card, the card, and the child's log below it ----
const LEVEL_IDS = 'ABCDEF', LAST_LEVEL = 5, EGG_PASSES = 5; // display mirrors of the server's six sectors and the egg's five passes
// v2's full-screen button (1095-1106, 1611-1613): only where the browser offers it, and not in an iPhone home-screen app
const fsOn = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);
const fsAble = () => Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !globalThis.navigator?.standalone;
function toggleFullscreen() {
  const d = document, e = d.documentElement;
  try { (fsOn() ? (d.exitFullscreen || d.webkitExitFullscreen)?.call(d) : (e?.requestFullscreen || e?.webkitRequestFullscreen)?.call(e))?.catch?.(() => {}); } catch { /* refused: the page stays as it is */ }
}
async function switchUser() { await api('/session/select', {}); channel?.postMessage('changed'); await refresh(); }
// one way into a run: a track (the server picks paper, check point or practice), the weekly scan, or the placement test
async function startRun(body) {
  playStreak = 0; const r = await api('/learn/session', body);
  if (r.settled) return summaryView({ mode: 'placement', track: 'engine' }, r.summary); // an abandoned placement test was graded as it stood
  playView(r.session, r.question);
}
// the header (2861-2886): avatar with its ring, the pet, a warming egg; the name, the sector(s) and the title; the level's name
function homeHeader(child, st, w) {
  const e = st.engine, n = st.nav, header = el('header', null, `home-header ${accClass(child)}`), who = el('div', null, 'home-who');
  who.append(avatarBadge(child, w, 40));
  const pet = petBadge(w, 26); if (pet) who.append(pet);
  if (w.egg && !w.egg.hatched) {
    const have = Math.max(0, Math.min(EGG_PASSES, st.stats.passes - (w.egg.passesAt || 0))), egg = el('span', '🥚', 'eggwrap');
    egg.setAttribute('aria-label', `Mystery Egg, ${have} of ${EGG_PASSES} passes`); egg.append(el('span', `${have}/${EGG_PASSES}`, 'eggcount')); who.append(egg);
  }
  const words = el('div', null, 'home-words'), kicker = el('p', null, 'kicker'), chip = titleChip(w);
  kicker.append(nameSpan(child.nickname, w), e.level === n.level ? ` · SECTOR ${e.levelId}` : ` · ⚙️ SECTOR ${e.levelId} · 🧭 SECTOR ${n.levelId}`); if (chip) kicker.append(chip);
  words.append(kicker, el('h1', e.level === n.level ? LEVEL_NAMES[e.level] : `${LEVEL_NAMES[e.level]} / ${LEVEL_NAMES[n.level]}`));
  who.append(words);
  const tools = el('span', null, 'home-tools');
  if (fsAble()) { const fs = el('button', fsOn() ? '⤢' : '⛶', 'tiny fs'); fs.type = 'button'; fs.setAttribute('aria-label', fsOn() ? 'Exit full screen' : 'Full screen'); fs.onclick = toggleFullscreen; tools.append(fs); }
  tools.append(button('Switch user', switchUser, 'tiny'));
  header.append(who, tools); return header;
}
// the card's opening lines (2892-2902)
function homeIntro(e, n) {
  const p = el('p', null, 'intro'), b = (text) => el('b', text);
  if (e.done && n.done && e.level === LAST_LEVEL && n.level === LAST_LEVEL) p.append('🏆 All sectors complete — both tracks! Incredible work. Tap a track below to practice any papers again.');
  else if (e.level === n.level) p.append('Sector ', b(e.levelId), ` · ${LEVEL_NAMES[e.level]}. Two tracks: `, b('⚙️ Engine'), ' drills the numbers, ', b('🧭 Navigator'), ' reads and reasons. Both to 100 to jump.');
  else p.append(b('⚙️ Engine'), ' is in Sector ', b(e.levelId), ' · ', b('🧭 Navigator'), ' is in Sector ', b(n.levelId), '. Each track jumps on when the other has finished that sector too.');
  return p;
}
// the day streak (2913-2920): three pass days in a row pay a bonus block. The run is the server's (S2); shields are held ones.
function streakNote(run, shields) {
  const left = 3 - (run % 3);
  const text = run > 0 && run % 3 === 0 ? `🔥 ${run}-day streak — bonus banked! Keep it going!`
    : run > 0 ? `🔗 Day ${run % 3} of 3 — ${left} more day${left > 1 ? 's' : ''} in a row for +⚡50 🏆100!` : 'Pass today to start a 3-day streak (+⚡50 🏆100 bonus)!';
  return el('p', `${text}${shields > 0 ? ` · 🛡️×${shields}` : ''}`, 'streak-note');
}
// a track card (2929-2957): the track's colour (mint once the sector is done), what comes next, the sector's five check
// points as v2's tier map (crowns and numbers, never colour alone), and the button that starts the run the server picks
function trackCard(t, p, canStart) {
  const T = TRACK[t], done = p.done, due = p.bossDue, passed = Math.min(p.paper - 1, 100), sp = Math.min(p.paper, 100);
  const live = Math.min(5, Math.floor(passed / 20) + (passed > 0 && passed % 20 === 0 ? 0 : 1));
  const card = el('div', null, `track-card ${done ? 'c-mint' : T.c}`), head = el('div', null, 'track-head'), status = el('p', null, 'track-status');
  head.append(el('span', `${T.emoji} ${T.name} · ${p.levelId}`, 'section-label'), el('span', done ? '✓ COMPLETE' : `${5 * T.qpp} q`, 'track-q'));
  if (done) status.append('Sector done — practise any papers while the other track catches up.');
  else if (due) status.append(el('b', `👑 CHECK POINT T${p.bossCleared + 1} is due`, 'due'));
  else status.append('Next: ', el('b', `papers ${sp}–${Math.min(sp + 4, 100)}`), ' · 100% to unlock');
  const map = el('div', null, 'tier-map'); map.setAttribute('aria-label', `${T.label} tier map`);
  for (let k = 1; k <= 5; k++) {
    const cleared = passed >= k * 20, beat = p.bossCleared >= k, here = k === live && !done, stop = el('span', null, 'tier-stop');
    stop.setAttribute('title', `Check point ${k} — papers ${k * 20 - 19}–${k * 20}`);
    stop.append(el('span', beat || cleared ? '👑' : '🔒', `tier-node${beat ? ' beat' : cleared ? ' boss' : here ? ' lit' : ''}`),
      el('span', here ? `${passed}/100` : done && k === 5 ? '100/100' : String(k * 20), `tier-label${here ? ' lit' : cleared ? ' passed' : ''}`));
    map.append(el('span', null, `tier-bar${cleared ? ' passed' : here ? ' lit' : ''}`), stop);
  }
  card.append(head, status, map);
  if (canStart) card.append(button(due ? `👑 CHECK POINT T${p.bossCleared + 1} ▶` : done ? '🔁 Practice ▶' : `${T.emoji} Start ${T.label} ▶`,
    () => startRun({ track: t }), `primary track-go${due || (!done && t === 'nav') ? ' gold' : done ? ' done' : ''}`));
  return card;
}
// a pending placement test stands where the track cards would (they wait for it)
function placementCard(st) {
  const card = el('div', null, 'track-card c-violet');
  card.append(el('span', `🎯 PLACEMENT TEST · SECTOR ${LEVEL_IDS[st.placement.level] || 'A'}`, 'section-label'),
    el('p', 'Engine and Navigator questions from the middle of the sector. Timed — answer as quickly as you can. Each track will start where you are ready.', 'track-status'));
  if (!st.active) card.append(button('Start the placement test', () => startRun({ track: 'engine', mode: 'placement' }), 'primary violet track-go'));
  return card;
}
// the jump line (2959-2976): both tracks to 100 and five crowns before the next sector, as progress.mjs canJump has it
function jumpBanner(e, n) {
  const can = (me, other) => me.done && me.level < LAST_LEVEL && (other.level > me.level || (other.level === me.level && other.done));
  const ready = [['engine', e, n], ['nav', n, e]].filter(([, me, other]) => can(me, other)).map(([t]) => `${TRACK[t].emoji} ${TRACK[t].label}`);
  let text;
  if (e.done && n.done && e.level === LAST_LEVEL && n.level === LAST_LEVEL) text = '🏆 ALL SECTORS COMPLETE';
  else if (ready.length) text = `⬆ ${ready.join(' and ')} ready to jump — pass any session to make the jump`;
  else if (e.level === n.level) text = `⬆ Jump to Sector ${LEVEL_IDS[Math.min(LAST_LEVEL, e.level + 1)]} needs ⚙️ Engine ${e.done ? '✓' : 'to 100 + 5 crowns'} and 🧭 Navigator ${n.done ? '✓' : 'to 100 + 5 crowns'}`;
  else {
    const [aheadT, A, behindT, B] = e.level > n.level ? ['engine', e, 'nav', n] : ['nav', n, 'engine', e], ahead = TRACK[aheadT], behind = TRACK[behindT];
    const aL = LEVEL_IDS[A.level], bL = LEVEL_IDS[B.level];
    text = `${behind.emoji} ${behind.label} jumps ahead as soon as Sector ${bL} is done · ${ahead.emoji} ${ahead.label} ${A.done ? 'has finished' : 'can\'t leave'} Sector ${aL} ${A.done ? 'and waits' : 'until'} ${behind.label} ${A.done ? 'for' : 'has finished'} ${behindT === 'nav' && B.level < A.level ? `Sectors ${bL}–${aL}` : `Sector ${aL}`}${A.done ? '' : ' too'}`;
  }
  return el('p', text, ready.length ? 'jump-banner ready' : 'jump-banner');
}
// the Family Rocket (2977-3015): the tank with the rocket riding its fill, each crew member's fuel (the server sends nicknames
// and amounts, no ids: the owner's choice, 11 Sep 2026), and a crew member's fuel buttons. The balance only greys a button
// out: the server decides every pour and the launch.
function rocketPanel(g) {
  const r = g.rocket; if (!r?.prize) return null;
  const launched = r.status === 'launched', rp = r.currency === 'rp', sym = rp ? '🏆' : '⚡', min = r.minEach || 0, bal = rp ? g.wallet.rp : g.wallet.gc;
  const box = el('div', null, launched ? 'rocket-panel launched' : 'rocket-panel'), head = el('div', null, 'rocket-head');
  head.append(el('span', '🚀 FAMILY ROCKET', 'section-label'), el('span', `${r.prize.emoji} ${r.prize.name}`, 'rocket-prize'));
  const tank = el('div', null, 'rocket-track'); setVar(tank, '--w', `${Math.min(100, Math.round((r.totalFuel / (r.goal || 1)) * 100))}%`);
  tank.setAttribute('aria-label', `rocket fuel ${r.totalFuel} of ${r.goal}`);
  const rider = el('span', '🚀', launched ? 'rocket-rider rocket-fly' : 'rocket-rider rocket-ride'); rider.setAttribute('aria-hidden', 'true');
  tank.append(el('span', null, 'rocket-fill'), rider);
  const crew = el('p', null, 'rocket-crew'); crew.append(el('span', `${sym}${r.totalFuel} / ${r.goal}`, 'rocket-total'));
  for (const c of Array.isArray(r.crew) ? r.crew : []) crew.append(el('span', `${c.nickname} ${sym}${c.fuel}${min ? (c.metMin ? ' ✓' : ` / ${min}`) : ''}`, min && c.metMin ? 'met' : ''));
  box.append(head, tank, crew);
  if (launched) box.append(el('p', `🎉 LIFT-OFF! ${r.prize.emoji} ${r.prize.name} is yours — ask your parent for it.`, 'rocket-note lift'));
  else if (!r.isCrew) box.append(el('p', 'you\'re not on this rocket\'s crew — ask your parent', 'rocket-note'));
  else {
    const pour = el('div', null, 'rocket-fuel'); pour.append(el('span', `⛽ fuel it with ${rp ? 'reward points' : 'grid coins'}:`, 'rocket-note'));
    for (const amount of rp ? [100, 200, 500] : [50, 100, 250]) {
      const b = button(`${sym}${amount}`, async () => {
        const res = await api('/game/rocket/fuel', { rocketId: r.id, amount, operationId: crypto.randomUUID() }); sound('kaching');
        await childScreen({ boom: res.rocket?.status === 'launched' }); // this pour filled the tank: lift-off, with v2's big burst (1702-1706)
      }, `tiny ${rp ? 'c-gold' : 'c-violet'}`);
      b.disabled = bal < amount; b.setAttribute('aria-label', `Fuel ${sym}${amount}`); pour.append(b);
    }
    if (min > 0 && (r.myFuel || 0) < min) pour.append(el('span', `everyone needs ${sym}${min} in for lift-off`, 'rocket-note due'));
    box.append(pour);
  }
  return box;
}
// the log below the card (3034-3071): one row per session, newest first; a quit row says where it stopped
const mmss = (secs) => (Number.isFinite(secs) ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '—');
const whenOf = (h) => (Number.isFinite(h.ts) ? `${new Date(h.ts).toLocaleDateString()} ${new Date(h.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : h.date || '—');
function homeLog(child, history) {
  if (!history?.length) return null;
  const box = el('div', null, 'logbox'), table = el('table', null, 'logtable'), thead = el('thead'), head = el('tr'), body = el('tbody');
  for (const th of ['Date & time', 'Papers', 'Score', '✓', '✗', '⏰', 'Time', 'Result']) head.append(el('th', th));
  thead.append(head);
  for (const h of history) {
    const row = el('tr'), td = (text, className) => { const c = el('td', text, className); row.append(c); return c; };
    td(whenOf(h)); td(`${h.levelId} · ${h.track === 'nav' ? '🧭 ' : ''}${h.papers}`);
    if (h.quit) td(`✕ quit at Q${(Number(h.atQ) || 0) + 1}`, 'log-quit').setAttribute('colspan', '6');
    else {
      const [word, tone] = h.mode === 'placement' ? ['🎯 PLACED', 'placed'] : !h.passed ? ['retry', 'retry'] : h.mode === 'boss' ? ['👑 CP', 'cp'] : h.mode === 'scan' ? ['🧠 SCAN', 'scan'] : ['PASS', 'pass'];
      td(`${h.correct}/${h.total}`, 'log-score'); td(String(h.correct), 'log-ok'); td(String(h.incorrect), 'log-bad'); td(String(h.timeout), 'log-late'); td(mmss(h.secs)); td(word, `log-result ${tone}`);
    }
    body.append(row);
  }
  table.append(thead, body); box.append(el('p', `${child.nickname}'s log`, 'log-title'), table); return box;
}
// The home: root.replaceChildren(header, card, log). The card wears the background's colours, the deck and the vehicle.
async function childScreen(after = {}) {
  stopTimer(); playStreak = 0; transientView = false; const child = model.child;
  const [st, g] = await Promise.all([api('/learn/state'), api('/game/state')]); gameModel = g;
  const w = g.wallet, e = st.engine, n = st.nav, deck = w.activeBase === 'base_deck', veh = gameItem(w.activeVehicle)?.kind === 'vehicle' ? gameItem(w.activeVehicle) : null;
  const pending = st.placement?.status === 'pending';
  const box = panel('', '', '', ['home', lookup(BGCARD_CLASS, w.activeBg), deck && 'base-deck', (veh || deck) && 'has-top'].filter(Boolean).join(' '));
  applyLook(w); box.replaceChildren();
  if (deck) { // the Command Deck's radar and ticker (2889-2890)
    const radar = el('span', null, 'deck-radar'), ticker = el('p', null, 'deck-ticker'); radar.setAttribute('aria-hidden', 'true');
    ticker.append(el('b', '◉'), ` COMMAND DECK ONLINE · ${child.nickname.toUpperCase()} · ⚙️ ${e.levelId} · 🧭 ${n.levelId} · ALL SYSTEMS GO`); box.append(radar, ticker);
  }
  if (veh) { const v = el('span', veh.emoji, 'vehicle'); v.setAttribute('aria-hidden', 'true'); box.append(v); }
  const tiles = el('div', null, 'wallet-row'); // the two wallet tiles (2903-2912)
  for (const [big, sub, c] of [[`⚡ ${w.gc.toLocaleString()}`, 'grid coins · spend in 🛒', 'c-cyan'], [`🏆 ${w.rp.toLocaleString()}`, 'reward points', 'c-gold']]) {
    const tile = el('div', null, `wallet-tile ${c}`); tile.append(el('span', big, 'yen'), el('span', sub, 'wallet-sub')); tiles.append(tile);
  }
  box.append(homeIntro(e, n), tiles, streakNote(g.liveRun || 0, w.shields || 0));
  if (st.active) { const s = st.active.session; box.append(el('p', `A ${s.mode === 'placement' ? 'placement test' : `${TRACK[s.track].name} session`} is open at question ${s.index + 1} of ${s.count}.`, 'notice'), button('Continue', () => playView(s, st.active.question), 'primary')); }
  const tracks = el('div', null, 'track-grid');
  if (pending) tracks.append(placementCard(st)); else for (const t of ['engine', 'nav']) tracks.append(trackCard(t, st[t], !st.active));
  box.append(tracks); if (!pending) box.append(jumpBanner(e, n));
  const rocket = rocketPanel(g); if (rocket) { if (after.boom === true) rocket.append(moneySplash('big')); box.append(rocket); }
  const nav = el('div', null, 'row-buttons home-nav'); nav.append(button('🛒 Shop', shopScreen, 'ghost'), button('🗺 Map', mapScreen, 'ghost')); box.append(nav);
  if (st.scan?.available && !st.active && !pending) box.append(button('🧠 SYSTEM SCAN — weekly ×2 loot ▶', () => startRun({ track: 'engine', mode: 'scan' }), 'ghost c-violet scan-go'));
  else if (st.scan?.doneThisWeek) box.append(el('p', '🧠 System Scan done this week · resets Monday', 'subtle'));
  box.append(button('Parent sign-in', () => signInScreen(), 'text-button'));
  const log = homeLog(child, st.history);
  root.replaceChildren(homeHeader(child, st, w), box, ...(log ? [log] : []));
}
// ---- the shop, which is also the wardrobe (v2 3211-3347): the balances, a Surprise Box's reveal, the fifteen sections in v2's
// order, the Reward Store and the purchase log. The page only asks: the server sells, rolls the box, equips and holds the
// points, and what it answers is what the shop shows next. Its lines go to #message, v2's shop line (3223) ----
// the device's date, for "done today" (the server keeps the family's date and enforces the daily cap itself)
const localDay = () => { const d = new Date(Date.now()); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function shopBuy(it, gc) {
  let r;
  try { r = await api('/game/shop/buy', { itemId: it.id, operationId: crypto.randomUUID() }); }
  catch (error) { if (error.code === 'INSUFFICIENT_GRID_COINS' && gc < it.cost) { note(`Need ⚡${it.cost - gc} more for ${it.name}`); return; } throw error; } // v2's words (1743)
  if (gameModel) gameModel.wallet = r.wallet; sound('kaching'); // a sound pack just bought rings in its own voice (v2 1769)
  const got = r.awarded; // v2's lines (1745-1764), told from what the server did
  note(it.kind === 'shield' ? `✓ 🛡️ Streak shield — holding ${r.wallet.shields}` : got ? `🎁 Surprise Box → ${got.emoji} ${got.name}!${CRATE_RARE.has(got.kind) ? ' ✨ RARE!' : ''}`
    : it.kind === 'egg' ? `🥚 Mystery Egg — keep it warm: it hatches after ${EGG_PASSES} passes` : `✓ ${it.emoji} ${it.name} — bought & equipped!`);
  await shopScreen({ awarded: got });
}
// EQUIP puts it on and ✓ EQUIPPED takes it off again (v2 1783-1796): the server takes itemId null as "nothing in this slot"
async function shopEquip(it, on) {
  const r = await api('/game/shop/equip', { kind: it.kind, itemId: on ? null : it.id }); if (gameModel) gameModel.wallet = r.wallet;
  note(on ? `${it.emoji} ${it.name} unequipped` : `✓ ${it.emoji} ${it.name} equipped`); await shopScreen();
}
// One card (3240-3276). Its colour says where it stands: equipped mint, owned violet, a big one gold, affordable, or out of
// reach and dimmed (all but the Box and the Egg); an earned pet is gold once earned and greyed until then, with the way to earn
// it and the progress. Then the one action that applies — BUY, OPEN, EQUIP or ✓ EQUIPPED — or a line saying why there is none.
// Every owned pet, earned or hatched ones too, can be worn and taken off.
function shopCard(it, g, passes) {
  const w = g.wallet, own = it.owned === true, afford = w.gc >= it.cost, slot = EQUIP_SLOT[it.kind], legend = lookup(LEGEND, it.id);
  const on = Boolean(slot) && w[slot] === it.id, tag = it.big ? 'SUPER RARE' : legend === 'legendary' ? 'LEGENDARY' : legend === 'semi' ? 'SEMI-LEGENDARY' : null;
  const tone = it.unlock ? (own ? 'earned' : 'locked') : on ? 'equipped' : own ? 'owned' : it.big ? 'rare' : afford ? 'afford' : 'broke';
  const dim = !own && !it.unlock && !afford && !CONSUMABLE.has(it.kind);
  const card = el('div', null, ['shopitem', tone, it.big && 'super', dim && 'dim', tag && 'tagged'].filter(Boolean).join(' '));
  if (tag) card.append(el('span', tag, legend === 'semi' ? 'tag semi' : 'tag'));
  const face = el('span', it.emoji, `item-emoji${it.big ? ' big' : ''}${it.unlock && !own ? ' item-locked' : legend ? ' legend-glow' : ''}`); face.setAttribute('aria-hidden', 'true');
  card.append(face, el('span', `${it.name}${it.kind === 'shield' && w.shields > 0 ? ` (×${w.shields})` : ''}`, 'item-name'));
  const blurb = lookup(BLURB, it.id); if (blurb) card.append(el('span', blurb, 'item-blurb'));
  const equipBtn = () => button(on ? '✓ EQUIPPED' : 'EQUIP', () => shopEquip(it, on), `tiny item-act ${on ? 'c-mint' : it.unlock ? 'c-gold' : 'c-violet'}`);
  const buyBtn = (words = 'BUY') => button(`⚡${it.cost} ${words}`, () => shopBuy(it, w.gc), `tiny item-act ${it.big || it.kind === 'crate' ? 'c-gold' : 'c-cyan'}${afford ? '' : ' short'}`);
  const says = (text, extra = '') => el('span', text, `item-state${extra}`);
  let act;
  if (it.unlock) {
    if (own) act = equipBtn();
    else { const u = it.unlockProgress || { have: 0, need: it.unlock.n }; act = says(`🔒 ${it.unlock.text}`); act.append(el('b', `${u.have}/${u.need}`)); }
  } else if (it.hatch) act = equipBtn(); // a hatched pet (the shop shows one only once it is owned)
  else if (it.kind === 'egg') {
    const egg = w.egg && !w.egg.hatched ? w.egg : null;
    act = egg ? says(`🥚 keeping warm · ${Math.max(0, Math.min(EGG_PASSES, passes - (egg.passesAt || 0)))}/${EGG_PASSES} passes`, ' warm')
      : g.catalog.filter((x) => x.hatch).every((x) => x.owned) ? says('NEST FULL — every egg pet hatched') : buyBtn();
  } else if (it.kind === 'crate') {
    const left = g.catalog.filter((x) => CRATE_KINDS.has(x.kind) && !x.owned && !x.unlock && !x.hatch).length;
    act = left ? buyBtn(`OPEN · ${left} left`) : says('ALL FOUND — you own every surprise');
  } else if (it.kind === 'shield') act = w.shields >= 2 ? says('MAX HELD') : buyBtn();
  else act = own ? equipBtn() : buyBtn();
  card.append(act); return card;
}
// the Reward Store (3282-3307): the parent's prizes this child may ask for (the server leaves a hidden one out until it is
// affordable), REDEEM when the points are there, "done today" at the daily cap, and every request still waiting for the parent
function rewardStore(g) {
  const w = g.wallet, wrap = el('section', null, 'shop-rewards'), title = el('p', '🎁 Reward Store', 'log-title c-gold'), list = el('div', null, 'reward-list'), today = localDay();
  title.append(el('span', ' · spend 🏆', 'lc'));
  for (const r of g.rewards) {
    const used = (w.redemptions || []).filter((x) => x.rewardId === r.id && x.date === today && x.status !== 'rejected').length;
    const afford = w.rp >= r.cost, capped = r.cap > 0 && used >= r.cap, row = el('div', null, afford && !capped ? 'reward-row ready' : 'reward-row'), end = el('span', null, 'reward-end');
    end.append(capped ? el('span', 'done today', 'reward-state') : afford ? button(`🏆${r.cost} REDEEM`, () => redeemReward(r), 'tiny c-gold') : el('span', `🏆${r.cost} · ${r.cost - w.rp} more`, 'reward-state mono'));
    const face = el('span', r.emoji, 'reward-emoji'); face.setAttribute('aria-hidden', 'true');
    row.append(face, el('span', r.name, afford ? 'reward-name' : 'reward-name short'), end); list.append(row);
  }
  for (const x of (w.redemptions || []).filter((x) => x.status === 'pending')) list.append(el('div', `⏳ Pending approval: ${x.emoji} ${x.name}`, 'reward-row pending'));
  if (!g.rewards.length) list.append(el('p', 'Your parent has not published any rewards yet.', 'subtle'));
  wrap.append(title, list); return wrap;
}
async function redeemReward(r) {
  await api('/game/rewards/redeem', { rewardId: r.id, operationId: crypto.randomUUID() });
  note(`✓ ${r.emoji} ${r.name} — sent to your parent to approve. The points are held while you wait.`); await shopScreen();
}
// the purchase log (3308-3341): what went out, newest first — every buy, then every reward asked for (a refused one was
// refunded, so it is left out). v2's balance check above it is not ported: /game/state sends the newest rows, not the ledger.
function buyRow(emoji, name, status, cost, date, points = false) {
  const row = el('div', null, 'buy-row'); row.append(el('span', emoji || '•', 'buy-emoji'), el('b', String(name).replace(' -> ', ' → ')));
  if (status) row.append(el('span', status[0], `buy-status ${status[1]}`));
  row.append(el('span', cost, points ? 'buy-cost rp' : 'buy-cost'), el('span', date && date !== '—' ? date : 'earlier', 'buy-date')); return row;
}
function purchaseLog(w) {
  const wrap = el('section', null, 'shop-log'), rows = el('div', null, 'buy-log');
  for (const p of w.purchases || []) rows.append(buyRow(p.emoji, p.name, null, `−⚡${p.cost}`, p.date));
  for (const x of (w.redemptions || []).filter((x) => x.status !== 'rejected')) rows.append(buyRow(x.emoji, x.name, x.status === 'approved' ? ['✓ approved', 'approved'] : ['⏳ pending', 'pending'], `−🏆${x.cost}`, x.date, true));
  if (!rows.children.length) rows.append(el('p', 'nothing bought yet', 'subtle'));
  wrap.append(el('p', '🧾 Purchase log', 'log-title c-cyan'), rows); return wrap;
}
async function shopScreen(after = {}) {
  transientView = true; const g = await api('/game/state'); gameModel = g;
  const w = g.wallet, passes = w.egg && !w.egg.hatched ? (await api('/learn/state')).stats?.passes || 0 : 0; // a warming egg counts passes, which the learning state holds
  const box = panel(`🛒 GRID SHOP · ${model.child.nickname.toUpperCase()}`, '', '', 'shop');
  onBack = childScreen; applyLook(w); root.setAttribute('aria-live', 'off'); // each buy repaints the shop: #message alone speaks
  const pills = el('div', null, 'balance-row'); pills.append(el('span', `⚡ ${w.gc}`, 'balance c-cyan'), el('span', `🏆 ${w.rp}`, 'balance c-gold')); box.append(pills);
  const got = after.awarded;
  if (got) { // the Surprise Box shakes open on what the server rolled (3224-3230)
    const reveal = el('div', null, 'crate-reveal'), shut = el('span', '🎁', 'crate-box'), item = el('span', got.emoji, 'crate-item');
    reveal.setAttribute('role', 'status'); shut.setAttribute('aria-hidden', 'true'); item.setAttribute('aria-hidden', 'true');
    reveal.append(shut, item, el('span', `${got.name}!${CRATE_RARE.has(got.kind) ? ' ✨ rare' : ''}`, 'crate-name')); box.append(reveal);
  }
  for (const [kinds, label, c, words] of SHOP_SECTIONS) {
    const items = g.catalog.filter((it) => kinds.includes(it.kind) && (!it.hatch || it.owned)); // an egg's pets stay a secret until one hatches (3232)
    if (!items.length) continue;
    const section = el('section', null, `shop-section ${c}`), head = el('p', label, 'section-label shop-head'), grid = el('div', null, items.some((it) => it.big) ? 'shop-grid has-big' : 'shop-grid');
    if (words) head.append(el('span', words, 'shop-note'));
    for (const it of items) grid.append(shopCard(it, g, passes));
    section.append(head, grid); box.append(section);
  }
  const row = el('div', null, 'row-buttons'); row.append(button('Back', childScreen, 'ghost'));
  box.append(rewardStore(g), purchaseLog(w), row);
}
async function mapScreen() {
  transientView = true; const [st, g] = await Promise.all([api('/learn/state'), api('/game/state')]); gameModel = g; const box = panel('MISSION MAP', 'Progress & fluency', 'Your map is calculated from server-recorded sessions. Accuracy and time cannot be edited by the browser.'); if (g.wallet.activeMap) box.className += ` ${g.wallet.activeMap}`;
  onBack = childScreen; applyLook(g.wallet);
  for (const t of ['engine', 'nav']) { const p = st[t], card = el('div', null, 'track'); card.append(el('strong', `${TRACK[t].emoji} ${TRACK[t].name} · Sector ${p.levelId}`), el('span', `${Math.min(100, p.paper - 1)} papers · ${p.bossCleared} crowns`, 'card-meta')); box.append(card); }
  if (!g.heatmap.length) box.append(el('p', 'Complete some sessions to light up the fluency grid.', 'muted'));
  for (const c of g.heatmap.sort((a,b) => a.track.localeCompare(b.track) || a.level-b.level || a.tier-b.tier)) { const row = el('div', null, 'heat-row'); row.append(el('strong', `${TRACK[c.track].emoji} ${c.levelId} · Tier ${c.tier}`), el('span', `${c.accuracy}% · ${c.avgSeconds ?? '—'} s avg · ${c.attempts} questions`, 'card-meta')); box.append(row); }
  box.append(button('Back to my grid', childScreen, 'primary'));
}
// ---- a session (v2 3110-3208): the status row, the timer bar, the flash, the question sheet, and v2's keypad beside Go,
// Restart and Quit. The browser only sends the answer: the server marks it, rules on the time and pays for it. ----
const STREAK_AT = [4, 9, 14, 18]; // v2's ladder (60-65): the combo shout, the sheet's heat and the pet's charge climb together
const streakTier = (s) => STREAK_AT.filter((at) => s >= at).length; // 0 cold, then 1-4
let playStart = { id: null, at: 0 }; // when this device first showed the session: the footer's minutes, display only
// the question on the sheet (QuestionView 1517-1554): a word problem with its blanks, a column sum, a line, or fractions
function questionView(d) {
  if (d.layout === 'word') { const box = el('div', null, 'q-word'); String(d.text).split('___').forEach((part, i) => { if (i) box.append(el('span', ' ', 'blank')); box.append(part); }); return box; }
  if (d.layout === 'stack') { // right-aligned digits, each row padded to the widest, the operator in cyan over v2's rule
    const top = String(d.top), bottom = String(d.bottom), width = Math.max(top.length, bottom.length), box = el('div', null, 'q-stack'), op = el('div', null, 'q-op');
    op.append(el('span', d.sym, 'q-sym'), bottom.padStart(width + 1, ' ')); box.append(el('div', top.padStart(width + 2, ' ')), op); return box;
  }
  if (d.layout === 'inline') return el('div', d.text, 'q-inline');
  const box = el('div', null, 'q-frac');
  if (d.pre) box.append(el('span', d.pre, 'q-pre'));
  for (const p of d.parts || []) {
    if (p.sym) { box.append(el('span', p.sym, 'q-sym')); continue; }
    const frac = el('span', null, 'frac'); frac.append(el('span', String(p.n)), el('span', null, 'frac-bar'), el('span', String(p.d))); box.append(frac);
  }
  box.append(el('span', '=', 'q-eq'), el('span', '?', 'q-ask')); return box;
}
// after: what the last answer left for this screen — the flash (or combo) to show, and whether a paper just closed (a burst)
function playView(session, q, after = {}) {
  transientView = true;
  const T = TRACK[q.track || session.track], w = gameModel?.wallet || {}, tier = streakTier(playStreak), choice = q.answerType === 'choice';
  const box = panel('', '', '', 'play'); box.replaceChildren();
  onBack = refresh; // to the child's home: the session stays open there under "Continue", nothing is quit or lost
  applyLook(w); root.setAttribute('aria-live', 'off'); // each question repaints the screen: the flash slot alone speaks
  if (playStart.id !== session.id) playStart = { id: session.id, at: Date.now() };
  const attemptId = crypto.randomUUID();
  const submit = async (answer) => {
    stopTimer(); try { window.speechSynthesis?.cancel(); } catch { /* no speech */ }
    const r = await api('/learn/answer', { sessionId: session.id, index: q.index, attemptId, answer });
    const paperDone = r.correct && session.mode !== 'placement' && (q.index + 1) % T.qpp === 0; // the last question of a paper
    playStreak = r.correct ? playStreak + 1 : 0;
    if (r.correct) sound(paperDone ? 'paper' : 'correct'); else if (r.result !== 'timeout') sound('wrong'); // a timeout plays nothing (v2 2164)
    if (r.done) { await summaryView(session, r.summary); return; }
    const flash = r.correct ? (streakTier(playStreak) ? { combo: playStreak } : { kind: 'ok', text: `⭐ Correct! ${r.expected}` })
      : r.result === 'timeout' ? { kind: 'late', text: `⏰ Time's up — it was ${r.expected}` } : { kind: 'bad', text: `✗ Not quite — it was ${r.expected}` };
    playView({ ...session, index: r.question.index }, r.question, { flash, burst: paperDone });
  };
  // ↺ Restart: this run is quit and the same one started again (no restart route: the log keeps the quit, port plan section 7)
  const restart = async () => { stopTimer(); await api('/learn/quit', { sessionId: session.id }); await startRun(session.mode === 'scan' ? { track: 'engine', mode: 'scan' } : { track: session.track }); };
  // the status row (3112-3125): the avatar in its ring, the track, where the run is, read-aloud, the pet charging, the clock
  const row = el('div', null, 'status-row'), where = el('span', null, 'q-count'), clock = el('span', null, 'clock');
  const place = session.mode === 'boss' ? `👑 CHECK POINT T${session.tierEnd / 20}` : session.mode === 'scan' ? '🧠 SCAN' : session.mode === 'placement' ? '🎯 PLACEMENT'
    : session.mode === 'practice' ? `Practice ${q.paper}` : `Paper ${q.paper}`;
  where.append(avatarBadge(model.child, w, 22), el('span', T.emoji, 'q-track'), el('span', ` ${T.name}`, 'sr-only'), ` ${place} · ${q.index + 1}/${session.count}`);
  if (q.read && window.speechSynthesis && window.SpeechSynthesisUtterance) { const tts = el('button', '🔊', 'tts'); tts.type = 'button'; tts.append(el('span', ' Read aloud', 'sr-only')); tts.onclick = () => speak(q.read); where.append(tts); }
  const pet = petBadge(w, 16, tier || 'sway'); if (pet) where.append(pet);
  row.append(where, clock);
  // the timer bar (3126-3128), in the equipped skin until red takes over at 8 s
  const bar = el('div', null, 'timer-track'), fill = el('div', null, 'timer-fill'), skin = lookup(TBAR_CLASS, w.activeTimer); bar.append(fill);
  // the flash slot (3131-3143): the last answer's result, or from four right in a row the combo shout in the pack's words
  const slot = el('div', null, 'flash-slot'), f = after.flash; slot.setAttribute('role', 'status');
  if (f?.combo) { const pack = lookup(SHOUT_PACKS, w.activeShout, SHOUT_PACKS.default), t = streakTier(f.combo); slot.append(el('span', `🔥 ${f.combo} ${pack.labels[t - 1]}`, `combo streak-${t}${pack.cls ? ` ${pack.cls}` : ''}`)); }
  else if (f) slot.append(el('div', f.text, `flash ${f.kind} fade`));
  // the sheet (3145-3172), warming with the streak; the answer box sits on it and is the one field on this screen
  const sheet = el('div', null, tier ? `sheet sheet-hot-${tier}` : 'sheet'), view = el('div', null, 'qin'); view.append(questionView(q.display)); sheet.append(view);
  const form = el('form', null, 'answer-form'), rtl = q.display?.layout === 'stack'; let input = null;
  if (choice) { const grid = el('div', null, 'choice-grid'); (q.display.choices || []).forEach((c, i) => grid.append(button(c, () => submit(String(i)), 'choicebtn'))); sheet.append(grid); }
  else {
    input = el('input', null, 'answer-box');
    Object.assign(input, { type: 'text', inputMode: coarse() ? 'none' : q.answerType === 'dec' ? 'decimal' : 'numeric', maxLength: 12, autocomplete: 'off', placeholder: 'answer…' });
    input.setAttribute('aria-label', 'Your answer'); sheet.append(input);
    if (rtl) sheet.append(el('p', 'start with the ones digit — the answer fills right to left', 'subtle'));
  }
  // the keypad (3174-3199): 7 8 9 / 4 5 6 / 1 2 3 / 0, the fraction bar for a fraction and the point for a decimal, ⌫. A
  // column sum is typed from the ones digit, as it is worked: each new digit goes in front (2353-2362).
  const pad = el('div', null, 'pad'), actions = el('div', null, 'action-col'), padRow = el('div', null, 'pad-row');
  if (choice) pad.append(el('p', 'tap your answer above 👆', 'pad-hint'));
  else {
    const put = (k) => { const v = input.value; if (v.length >= 12 || ((k === '/' || k === '.') && (!v || v.includes(k)))) return; input.value = rtl ? k + v : v + k; };
    const back = () => { input.value = rtl ? input.value.slice(1) : input.value.slice(0, -1); };
    for (const d of '7894561230') pad.append(padKey(d, () => put(d)));
    if (q.answerType === 'frac') pad.append(padKey('∕', () => put('/'), 'slash', 'fraction bar'), padKey('⌫', back, 'back', 'Delete'));
    else if (q.answerType === 'dec') pad.append(padKey('.', () => put('.'), 'slash', 'decimal point'), padKey('⌫', back, 'back', 'Delete'));
    else pad.append(padKey('⌫', back, 'back wide', 'Delete'));
  }
  // the action column (3200-3204): Go! is the form's submit; a placement test has no Restart (leaving it counts as a quit)
  const go = el('button', 'Go!', 'go-btn'); go.type = 'submit'; go.disabled = choice; actions.append(go);
  if (session.mode !== 'placement') actions.append(button('↺ Restart', restart, 'restart-btn'));
  actions.append(button('✕ Quit', async () => { stopTimer(); await api('/learn/quit', { sessionId: session.id }); await refresh(); }, 'quit-btn'));
  padRow.append(pad, actions); form.append(sheet, padRow);
  let left = q.seconds;
  form.onsubmit = (event) => {
    event.preventDefault(); if (choice) return;
    const v = input.value.trim(), [n, d = '1'] = v.split('/'); // a fraction goes as {n, d}; a whole number typed for one as n/1
    if (!v || (q.answerType === 'frac' && (!n.trim() || !d.trim()))) {
      input.className = 'answer-box'; void input.offsetWidth; input.className = 'answer-box shake';
      if (!left) note('Type an answer, then tap Go!'); return;
    }
    run(() => submit(q.answerType === 'frac' ? { n: n.trim(), d: d.trim() } : v));
  };
  // the clock is display only: at 0 it asks for the answer, and the server rules on the time when the answer arrives
  const paint = () => {
    const hurry = left <= 8; clock.textContent = `⏱ ${left}s`; clock.className = hurry ? 'clock hurry' : 'clock';
    fill.className = hurry ? 'timer-fill hurry' : `timer-fill${skin ? ` ${skin}` : ''}`; setVar(fill, '--w', `${Math.max(0, (left / q.seconds) * 100)}%`);
  };
  paint();
  timer = setInterval(() => {
    left = Math.max(0, left - 1); paint();
    if (!left) { stopTimer(); slot.replaceChildren(el('div', choice ? '⏰ Time\'s up — tap your answer!' : '⏰ Time\'s up — tap Go!', 'flash late fade')); }
  }, 1000);
  box.append(row, bar, ...(after.burst ? [moneySplash('mini')] : []), slot, form, el('p', `${Math.floor((Date.now() - playStart.at) / 60000)} min elapsed · target: under 20`, 'subtle play-foot'));
  if (input && !coarse()) input.focus();
}
// ---- the result (v2 3564-3640): a headline for what happened, the score and the tally, the time (S3), and on a pass the
// coins, the pet and the vehicle's lift-off; anything earned or hatched; then the next run on the same track, or home ----
async function summaryView(session, s) {
  transientView = true;
  if (gameModel && s.wallet) gameModel.wallet = s.wallet; // the server's wallet after this run: a pet earned or hatched is already worn
  const w = gameModel?.wallet || s.wallet || {};
  if (s.placement) { // the test is done: where each track begins
    const box = panel('🎯 PLACEMENT COMPLETE', 'Your grid is set.', `${s.correct} out of ${s.total} in the test. Coins start with your first real papers.`, 'summary');
    onBack = refresh; applyLook(w);
    const words = { ahead: 'ready for the next sector', 'on-level': 'right in the middle of the sector', building: 'building up through the sector', foundations: 'from the start of the sector', previous: 'a sector back, from the middle', 'previous-start': 'a sector back, from the start' };
    for (const tr of ['engine', 'nav']) { const p = s.placement[tr]; box.append(el('p', `${TRACK[tr].emoji} ${TRACK[tr].name}: starts at Sector ${p.levelId}, paper ${p.paper} — ${words[p.band] || p.band} (${p.correct}/${p.total} right).`, `box ${TRACK[tr].c}`)); }
    const row = el('div', null, 'row-buttons'); row.append(button('Go to my grid', refresh, 'primary')); box.append(row); return;
  }
  const T = TRACK[session.track] || TRACK.engine, other = session.track === 'nav' ? '⚙️ Engine' : '🧭 Navigator';
  let finishedAll = false; // both tracks through Sector F: the one outcome this summary cannot tell by itself, so it asks
  if (s.passed && s.newLevel === LAST_LEVEL && (s.trackNowDone || s.mode === 'practice')) {
    try { const st = await api('/learn/state'); finishedAll = st.engine.done && st.nav.done && st.engine.level === LAST_LEVEL && st.nav.level === LAST_LEVEL; } catch { /* the headline below says the rest */ }
  }
  // the headline, first match wins (3566-3586); gold, not v2's off-palette purple, for the last one of all
  const [head, tone] = finishedAll ? ['🏆 ALL LEVELS COMPLETE!', 'c-gold']
    : s.leveledUp ? [`⬆ JUMP! ${T.emoji} ${T.label} moves on — welcome to Sector ${s.newLevelId}${(s.jumped || []).length === 2 ? ' · both tracks!' : ''}`, 'c-gold']
    : s.trackNowDone ? [`✓ ${T.emoji} ${T.name} SECTOR ${s.newLevelId} COMPLETE — it jumps once ${other} has finished Sector ${s.newLevelId} too`, 'c-mint']
    : s.mode === 'practice' ? [`🔁 Practice run ${s.passed ? '— perfect!' : '— keep at it'}`, s.passed ? 'c-mint' : 'c-cyan']
    : s.mode === 'boss' && s.passed ? ['👑 CHECK POINT CLEARED! Tier complete', 'c-gold']
    : s.mode === 'scan' && s.passed ? ['🧠 SYSTEM SCAN COMPLETE — double loot!', 'c-violet']
    : s.mode === 'boss' ? ['👑 Check point not cleared — run it again!', 'c-cyan']
    : s.mode === 'scan' ? ['🧠 Scan done — retry any time this week', 'c-cyan']
    : s.passed ? ['PERFECT! Papers unlocked 🎉', 'c-mint'] : ['Session done — almost there!', 'c-cyan'];
  const box = panel('', '', '', 'summary'); box.replaceChildren();
  onBack = refresh; applyLook(w);
  const tally = el('div', null, 'tally'); tally.append(el('span', `✓ ${s.correct} correct`, 'ok'), el('span', `✗ ${s.incorrect} incorrect`, 'bad'), el('span', `⏰ ${s.timeout} out of time`, 'late'));
  box.append(el('h2', head, `summary-head ${tone}`), el('div', `${s.correct}/${s.total}`, 'big-score'), tally, el('p', `Papers ${s.papers}${Number.isFinite(s.secs) ? ` · ${mmss(s.secs)} min` : ''}`, 'subtle'));
  if (s.passed && s.rewarded) { // the loot (3594-3603): a streak block or a double shows in the amount
    const earn = el('div', null, 'earn-box pop2'); earn.append(`+⚡${s.gcEarned} `, el('span', `+🏆${s.rpEarned}`));
    if (s.gcEarned > 100) earn.append(el('span', ' DOUBLE LOOT!', 'earn-note')); else if (s.gcEarned > 50) earn.append(el('span', ' (incl. 🔥 streak block!)', 'earn-note'));
    box.append(moneySplash(s.gcEarned > 50 ? 'big' : 'pass'), earn); setTimeout(() => sound('kaching'), 350); // the till rings with the coins (v2 2184)
  } else if (s.passed) box.append(el('p', 'Practice runs keep you sharp but pay nothing — coins come back when the other track finishes the sector.', 'subtle'));
  if (s.passed) { // the pet pops up and the vehicle lifts off (3604-3609)
    const pet = petBadge(w, 44, 'pop'), veh = gameItem(w.activeVehicle);
    if (pet) box.append(pet);
    if (veh?.kind === 'vehicle') { const v = el('div', veh.emoji, 'launch'); v.setAttribute('aria-hidden', 'true'); box.append(v); }
  }
  for (const e of s.gameEvents || []) { // what this run earned or hatched (3610-3619); a shield that covered a day is said too
    if (e.type === 'earned' && e.item) box.append(el('div', `🌟 ${lookup(LEGEND, e.item.id) === 'semi' ? 'SEMI-LEGENDARY' : 'LEGENDARY'} UNLOCKED — ${e.item.emoji} ${e.item.name} joins you!`, 'unlock-box c-gold pop2'));
    else if (e.type === 'hatched' && e.item) box.append(el('div', `🐣 Your egg hatched — ${e.item.emoji} ${e.item.name}!`, 'unlock-box c-mint pop2'));
    else if (e.type === 'shield') box.append(el('p', `🛡️ A streak shield covered ${e.date} — chain protected`, 'subtle'));
  }
  if (s.bossNext) box.append(el('p', '👑 CHECK POINT unlocked — clear it to enter the next tier!', 'warn'));
  const mini = el('p', null, 'mini-wallet'); mini.append('⚡ ', el('b', String(s.wallet?.gc ?? 0)), ' · 🏆 ', el('b', String(s.wallet?.rp ?? 0))); box.append(mini);
  if (!s.passed) { const rule = el('p', null, 'intro'); rule.append('The 100% rule: ', el('b', 'perfect score unlocks the next papers'), '. Same papers again next session — you\'ve got this! 💪'); box.append(rule); }
  const row = el('div', null, 'row-buttons');
  row.append(button(s.passed ? 'Next session ▶' : 'Try again ▶', () => startRun({ track: session.track }), 'primary'), button('Home', refresh, 'ghost'));
  box.append(row);
}
// Launch and Scrap cannot be taken back: a launched rocket owes its prize, a scrapped one refunds nobody. Like deleting
// the family (deletionScreen), each opens its own screen first, and nothing is sent until the parent confirms there.
function rocketConfirmScreen(rocket, action) {
  transientView = true;
  const scrap = action === 'scrap';
  const box = panel('PARENT · FAMILY ROCKET', scrap ? 'Scrap this rocket?' : 'Launch this rocket now?', scrap
    ? 'Scrapping ends this rocket for good. The fuel already in it is not refunded to anyone, and the rocket cannot be brought back.'
    : 'Launching ends fuelling now, before the goal is reached, and the family owes the prize. It cannot be undone.');
  onBack = parentGameScreen; // its own Back button's step: nothing is launched or scrapped
  box.append(el('p', `${rocket.prize.emoji} ${rocket.prize.name} · ${rocket.totalFuel}/${rocket.goal}`, 'notice'),
    // Back comes first: the second tap of a double-tap on Launch or Scrap lands where the first button is.
    button('Back', parentGameScreen, 'ghost'),
    button(scrap ? 'Yes, scrap it' : 'Yes, launch now', async () => { await parentGameMutation('/game/parent/rocket', { action, rocketId: rocket.id }); }, 'primary'));
}
async function parentGameMutation(path, payload) {
  try { await api(path, payload); await parentGameScreen(); }
  catch (error) {
    if (error.code !== 'REAUTHENTICATE') throw error;
    reauthenticate(() => { parentGameScreen(); note('Parent verified. Repeat the action to confirm it.'); });
  }
}
async function parentGameScreen() {
  transientView = true; const g = await api('/game/parent'); const box = panel('PARENT · GAME & PROGRESS', 'Learning controls and family rewards', 'Only the parent session can change pace, rewards, credits or the Family Rocket.');
  onBack = refresh;
  const tz = field('Family time zone', 'text', { value: g.timeZone, maxLength: 64 }); box.append(tz.wrap, button('Save time zone', async () => { await parentGameMutation('/game/parent/settings', { timeZone: tz.input.value }); }, 'ghost'));
  for (const row of g.children) {
    const card = el('div', null, 'track'); card.append(el('strong', `${icons[row.child.icon] || '🤖'} ${row.child.nickname}`), el('span', `⚙️ ${row.engine.levelId} ${Math.min(100,row.engine.paper-1)}/100 · 🧭 ${row.nav.levelId} ${Math.min(100,row.nav.paper-1)}/100 · ⚡${row.wallet.gc} · 🏆${row.wallet.rp}`, 'card-meta'));
    const pace = field('Question-time pace % (10–200)', 'number', { value: row.pacePercent, min: 10, max: 200 }); card.append(pace.wrap, button('Set pace', async () => { await parentGameMutation('/game/parent/settings', { childId: row.child.id, pacePercent: Number(pace.input.value) }); }, 'ghost'), button('+⚡50 credit', async () => { await parentGameMutation('/game/parent/adjust', { childId: row.child.id, currency: 'gc', amount: 50, reason: 'Parent bonus credit', operationId: crypto.randomUUID() }); }, 'text-button'));
    const pending = row.wallet.redemptions.filter((r) => r.status === 'pending'); for (const r of pending) { const p = el('div', null, 'approval'); p.append(el('span', `${r.emoji} ${r.name} · 🏆${r.cost}`), button('Approve', async () => { await parentGameMutation('/game/parent/redemption', { childId: row.child.id, redemptionId: r.id, decision: 'approve' }); }, 'ghost'), button('Reject + refund', async () => { await parentGameMutation('/game/parent/redemption', { childId: row.child.id, redemptionId: r.id, decision: 'reject' }); }, 'text-button')); card.append(p); }
    box.append(card);
  }
  box.append(el('h2', 'Reward Store')); for (const r of g.rewards) box.append(el('p', `${r.emoji} ${r.name} · 🏆${r.cost}${r.cap ? ` · max ${r.cap}/day` : ''}`, 'small muted'));
  const re = field('New reward name', 'text', { maxLength: 40 }), rc = field('Cost in 🏆', 'number', { value: 100, min: 1, max: 100000 }); box.append(re.wrap, rc.wrap, button('Add reward for all children', async () => { const reward = { id: `rw-${crypto.randomUUID()}`, emoji: '🎁', name: re.input.value, cost: Number(rc.input.value), hidden: false, cap: 0, childIds: g.children.map((x) => x.child.id) }; await parentGameMutation('/game/parent/rewards', { rewards: [...g.rewards, reward] }); }, 'ghost'));
  box.append(el('h2', '🚀 Family Rocket'));
  if (!g.rocket) { const prize = field('Prize', 'text', { placeholder: 'Ice cream', maxLength: 50 }), goal = field('Goal in ⚡', 'number', { value: 2000, min: 50 }), min = field('Minimum each', 'number', { value: 300, min: 0 }); box.append(prize.wrap, goal.wrap, min.wrap, button('Build rocket', async () => { await parentGameMutation('/game/parent/rocket', { action: 'build', prize: { emoji: '🎁', name: prize.input.value }, currency: 'gc', goal: Number(goal.input.value), minEach: Number(min.input.value), crewChildIds: g.children.map((x) => x.child.id) }); }, 'primary')); }
  else { box.append(el('p', `${g.rocket.prize.emoji} ${g.rocket.prize.name} · ${g.rocket.totalFuel}/${g.rocket.goal} · ${g.rocket.status}`, 'notice')); if (g.rocket.status === 'fueling') box.append(button('Launch now', () => rocketConfirmScreen(g.rocket, 'launch'), 'ghost'), button('Scrap (no refund)', () => rocketConfirmScreen(g.rocket, 'scrap'), 'text-button')); else box.append(button('Prize delivered · clear', async () => { await parentGameMutation('/game/parent/rocket', { action: 'claim', rocketId: g.rocket.id }); }, 'primary')); }
  box.append(button('Back to family', refresh, 'ghost'));
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
// Back from a hosted checkout (Stage 4.1). The redirect proves nothing: the provider's signed webhook
// is what changes the plan, so tell the parent what to expect and look again shortly.
const returned = typeof location === 'object' && location?.search ? new URLSearchParams(location.search) : null;
// Support's reset for this device's SMS countdown: opening the app with ?resetsms removes every record the Send
// countdown keeps (auth.js), for when an operator has cleared the server's count after a delivery fault. The address is
// tidied at once, so a reload or a bookmark made now does not repeat it.
if (returned?.has('resetsms')) {
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('automathtics.sms.')) localStorage.removeItem(k); } } catch { /* no storage */ }
  if (typeof history === 'object' && history?.replaceState) history.replaceState(null, '', location.pathname);
  note('The SMS countdown on this device was reset.');
}
if (returned?.get('checkout')) {
  if (typeof history === 'object' && history?.replaceState) history.replaceState(null, '', location.pathname);
  if (returned.get('result') === 'success') { note('Payment received. Your plan updates as soon as the payment provider confirms it; this page checks again in a moment.'); setTimeout(() => { if (!working) run(refresh); }, 4000); }
  else note('Checkout cancelled. Nothing was charged.');
}
// Back stays inside v3, as far as a browser lets a page decide. The owner (11 Sep 2026) pressed Back on the kids' page and landed on the old v2 site: not a
// link — v3 has none — but the browser's own history, because that tab showed v2 before v3 was opened in it. So
// the page marks its own entry (after the query string above is dropped: the URL stays as it is now) and stands a
// guard entry on top. Back then lands on the marked entry without leaving the document; the app takes the step
// itself — a game screen, the shop, the map, play or a summary go to the child's home, a parent sub-screen to the
// workspace, a top-level screen stays put — and the guard goes back up, so every later Back is caught the same way.
// Only history traversal inside this document fires popstate: a navigation the app starts (the hosted checkout,
// the masthead link) is an ordinary navigation and is never held back. Browsers may skip an entry a page pushed
// before anyone touched it, and some skip entries pushed without a tap after repeated presses, so this is best effort:
// Back pressed before the first tap, or mashed, can still leave. The old v2 site is offline since 11 Sep 2026, so a Back
// that escapes lands on GitHub's 404 page, not the old game; opening v3 in a fresh tab leaves nothing behind it.
function guardBack() {
  if (typeof history !== 'object' || typeof history?.pushState !== 'function' || typeof window?.addEventListener !== 'function') return;
  try { history.replaceState({ automathtics: 'app' }, ''); history.pushState({ automathtics: 'guard' }, ''); } catch { return; }
  window.addEventListener('popstate', (event) => {
    if (event?.state?.automathtics !== 'app') return; // Forward onto the guard, or an entry this page did not make
    try { history.pushState({ automathtics: 'guard' }, ''); } catch { /* the step below still happens */ }
    if (onBack) run(onBack);
  });
}
guardBack();
