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
  FAMILY_DELETED: 'This family has been deleted.', NO_DELETION_PENDING: 'No deletion is scheduled.', FAMILY_STILL_EXISTS: 'Delete the family first; the sign-in account can go after that.', PLACEMENT_PENDING: 'The placement test comes first.', PLACEMENT_NOT_PENDING: 'There is no placement test to take.', ALREADY_STARTED: 'This child has already started playing; the starting point can no longer be changed.', INVALID_START: 'Choose a year level for that starting option.', RECOVERY_NOT_FOUND: 'No recovery request exists for that account.', ACCOUNT_DELETED: 'This sign-in account has been deleted.', MULTIPLE_PROVIDER_SUBSCRIPTIONS: 'Your payment account needs a check by support before this change can be made. Nothing has been charged.', PROVIDER_SUBSCRIPTION_LIVE: 'Your payment account already carries an active subscription. Support will sort this out before a new one can start.', CHECKOUT_COMPLETING: 'Your last payment is still being confirmed. Give it a minute, then refresh.', PROVIDER_SUBSCRIPTION_NOT_FOUND: 'Your previous subscription could not be found at the payment provider just now. Try again in a minute; if it keeps happening, contact support.', PROVIDER_SUBSCRIPTION_PAID: 'The payment provider shows your subscription as paid and current. Give it a minute and reload; if this keeps happening, contact support.', PAYMENT_PENDING: 'A plan change is still waiting for its payment. Complete that payment, or wait for it to lapse, before changing the plan again.', RECOVERY_NOT_PENDING: 'That recovery request is no longer pending.', IDENTITY_UNAVAILABLE: 'The sign-in service did not answer. Try again in a moment.',
  MANUAL_GRANT_ACTIVE: 'This family already has pilot access, so the free trial is not needed.', CHECKOUT_REQUIRED: 'Choose a plan to subscribe first; a trial cannot be changed.', PLAN_CHANGE_NOT_AUTHORIZED: 'That payment does not match the plan on record.', RENEWAL_REQUIRED: 'The renewal payment comes first; upgrade after it goes through.', CHANGE_IN_PROGRESS: 'A plan change is already in progress. Try again in a moment.', USE_PLAN_CHANGE: 'Your family is subscribed: change the plan from the subscription controls.', SUBSCRIPTION_CHANGED: 'The subscription changed while this was in progress. Refresh and try again.', LEDGER_REPLAYED: 'That was already done. Refresh to see the result.',
  SEATS_CANNOT_REMOVE: 'Seats can be added here, not taken away.', INVALID_PLAN: 'That plan is not available.', SELECT_CHILDREN_FOR_DOWNGRADE: 'Not enough seats for that many children.', IDEMPOTENCY_CONFLICT: 'That request was already made differently. Refresh and try again.',
  // Leaving (12 Sep 2026): the cancel-or-pause flow
  LEAVING_REASON_REQUIRED: 'Choose one reason first.', LEAVING_ACTION_REQUIRED: 'Choose what you would like to do.', OFFER_NOT_OFFERED: 'That option is not available for this family. Refresh and try again.',
  NOT_PAUSED: 'This subscription is not paused.', CANCEL_SCHEDULED: 'This subscription is already set to end at the period end. Keep it first if you would rather pause.',
  INVALID_MONTHS: 'A pause can be one, two or three months.', PROVIDER_UNAVAILABLE: 'That change needs the payment provider, which is not available here.', EMAIL_UNAVAILABLE: 'Email settings are not available just now.',
  INSUFFICIENT_GRID_COINS: 'Not enough Grid Coins yet.', INSUFFICIENT_REWARD_POINTS: 'Not enough Reward Points yet.',
  ITEM_ALREADY_OWNED: 'You already own that item.', SHIELD_LIMIT: 'You can hold at most two streak shields.',
  EGG_ALREADY_WARMING: 'Your Mystery Egg is already warming.', REWARD_DAILY_LIMIT: 'That reward has reached its daily limit.',
  CRATE_EMPTY: '🎁 Nothing left to find — you own every surprise!', EGG_COLLECTION_COMPLETE: '🥚 Your nest is full — every egg pet is already yours!', // v2's words (1754, 1762)
  ITEM_NOT_OWNED: 'That item is not in your collection.', REWARD_NOT_FOUND: 'That reward is no longer in the store.',
  SCAN_ALREADY_DONE: 'System Scan is already complete this week.', SCAN_LOCKED: 'System Scan unlocks in Sector B after the first tier.',
  INVALID_ANSWER: 'The grid could not read that answer. Check it, then tap Go again.',
  LINK_INVALID: 'This link does not work. Nothing was changed.', LINK_EXPIRED: 'This link has expired; the next weekly email brings fresh ones. Nothing was changed.', LINK_GONE: 'The family or child this link was for is no longer there. Nothing was changed.',
  FEEDBACK_TEXT: 'Write your feedback first (up to 2000 characters).', FEEDBACK_CONTACT: 'That email address does not look right. Fix it, or leave it empty.',
  // Game & progress: what the server refuses in the parent's own words
  INSUFFICIENT_BALANCE: 'That would take the balance below zero. Nothing was changed.', INVALID_REWARDS: 'The Reward Store could not take that list: check each reward’s name, its cost (1 to 100000) and its daily limit (0 to 20).',
  INVALID_TIME_ZONE: 'That is not a time zone name the server knows. Try one such as Asia/Jakarta.', INVALID_PACE: 'The pace goes from 10% to 200%.',
  ROCKET_ALREADY_FUELING: 'A rocket is already fuelling. Launch, scrap or clear it first.',
  FEEDBACK_BUSY: 'Many notes have come in today. Please try again tomorrow, or sign in to send yours now.',
  SESSION_REVOKED: 'Your sign-in has ended: the password or the mobile number changed. Please sign in again.',
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
// v2's row of buttons (the centred flex row under every card, 2839): a screen's actions stand in one, never loose in the card
function actionRow(...buttons) { const r = el('div', null, 'row-buttons'); r.append(...buttons.filter(Boolean)); return r; }
// one block of v2's admin panel (2614-2856): left-aligned under a title in the section's colour, written mixed-case and drawn in
// capitals (.log-title), so the words a test reads are the words on the screen
function adminSection(title, tone = 'c-cyan', extra = '') {
  const s = el('section', null, `admin-sec ${tone}${extra ? ` ${extra}` : ''}`); s.append(el('h2', title, 'log-title')); return s;
}
// the admin panel's compact field (ADMIN_INP 1191), named by its aria-label; the sign-in forms keep their 52px .field instead
function adminInput(type, aria, options = {}, extra = '') {
  const i = el('input', null, extra ? `admin-inp ${extra}` : 'admin-inp'); Object.assign(i, { type, autocomplete: 'off', ...options }); i.setAttribute('aria-label', aria); return i;
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
// variant: one of v2's narrower cards (narrow 420px, w460, w520) or a screen's own class; play: a question session is on screen,
// so a newer release's bar waits for its end (Update now); page: the name a note from this screen reports (Send feedback)
function panel(kicker, title, subtitle, variant = '', { play = false, page = null, back = true } = {}) {
  authModule?.resetCaptcha?.(); // the robot check belongs to the screen that built it; one left behind strands its frame
  stopSendClock(); stopTimer(); screenId++; onBack = null; // the same for the Send countdown and a question's clock, and Back is each screen's to set again
  root.replaceChildren(); setMode(); root.setAttribute('aria-live', 'polite'); // a session turns it off while it plays
  const box = el('section', null, variant ? `panel ${variant}` : 'panel');
  box.append(el('p', kicker, 'kicker'), el('h1', title), el('p', subtitle, 'intro muted'));
  // Every adult screen carries the way out the browser's Back already takes: the screen's own onBack, set the moment
  // this returns, so the button reads it when it is pressed rather than now. Only the two screens with nothing above
  // them opt out (back: false) — the sign-in screen and Mission Control. A parent on a phone whose browser hides its
  // chrome, or inside a home-screen shortcut that has none, had no way back at all: the owner's report of 12 Sep 2026.
  if (back && !kidMode) putFirst(box, backRow());
  root.append(box);
  if (!kidMode) root.append(feedbackFoot(page || kicker)); // under the sign-in screen and every parent screen; never in kid mode
  inPlay = play; showUpdate(); // a newer release's bar goes on every screen but a running question session (playView)
  return box;
}
// The DOM a test runs this page in has no prepend or insertBefore: a node goes first by rebuilding the list.
const putFirst = (box, node) => box.replaceChildren(node, ...box.children);
// The adult screens' Back, above the kicker. It runs whatever the screen gave the browser's Back; a screen that gave it
// nothing falls back to the workspace, so the button is never a dead end.
function backRow() {
  const row = el('div', null, 'panel-back');
  row.append(button('← Back', () => (onBack || refresh)(), 'ghost')); // button() already runs it: a second run() inside would be dropped as re-entry
  return row;
}
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
  // This line lives under #app, and a child's home is far taller than a tablet: a refusal written down there while the
  // child is looking at a track card half a page above never reaches them, and the tap reads as nothing happening at
  // all — the owner's report of 12 Sep 2026, where one child could start a paper and the other silently could not.
  if (text) { try { status.scrollIntoView?.({ block: 'nearest' }); } catch { /* a DOM that cannot scroll: the words are set all the same */ } }
}
// ---- Send feedback (the owner's request of 12 Sep 2026): under the sign-in screen and every parent screen, never in kid mode.
// The browser sends the words, the screen, an operation id and, signed out, an address to be answered at if the sender wants one;
// the server decides who sent it (server/feedback.mjs). Kid mode is remembered on the device (automathtics.kidmode, PRIVACY.md):
// set when the launch pad or a child's screen opens, cleared only when a parent's session opens (renderModel), so neither a reload
// nor an expired launch pad brings the button back on the kids' tablet. With no storage it is this page's memory alone.
const KID_MODE = 'automathtics.kidmode';
let kidMode = (() => { try { return localStorage.getItem(KID_MODE) === '1'; } catch { return false; } })();
function setKidMode(on) { kidMode = on; try { if (on) localStorage.setItem(KID_MODE, '1'); else localStorage.removeItem(KID_MODE); } catch { /* no storage: this page's memory only */ } }
// parentLive: a parent's session is open on this page (renderModel), through a re-verification too, which clears the page's model
// but not the session (signInScreen): the panel then offers no reply address, since the server answers at the account's own.
let parentLive = false;
const EMAIL_ADDRESS = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/;
function feedbackFoot(where) { // `where`: the screen's own name (sign-in, sign-up…) or else its heading, as the page the note reports
  const foot = el('div', null, 'feedback'), page = String(where || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'screen';
  const closed = () => { foot.className = 'feedback'; foot.replaceChildren(button('Send feedback', () => open(), 'text-button')); };
  function open(draft = '') { // opened, it is a small card of its own under the screen's card
    const operationId = crypto.randomUUID(), words = el('textarea'); Object.assign(words, { maxLength: 2000, rows: 4, required: true }); // one id per note: Send again after a lost answer is the same note
    if (draft) words.value = String(draft).slice(0, 2000); // the leaving flow's "technical problems": the reason, already typed in
    const label = el('label', null, 'field'); label.append(el('span', 'Your feedback (up to 2000 characters)'), words);
    const reply = model || parentLive ? null : field('Your email, if you would like an answer (optional)', 'email', { required: false, maxLength: 254, autocomplete: 'email' });
    foot.className = 'feedback open';
    foot.replaceChildren(label, reply ? reply.wrap : el('p', 'Any answer goes to your account’s email address.', 'small muted'), actionRow(button('Send', async () => {
      const text = words.value.trim(), contact = reply ? reply.input.value.trim() : '';
      if (!text || text.length > 2000) { note(messages.FEEDBACK_TEXT); return; }
      if (contact && (contact.length > 254 || !EMAIL_ADDRESS.test(contact))) { note(messages.FEEDBACK_CONTACT); return; }
      if (!model) csrf = (await bootstrap()).csrf; // no page model (signed out, or re-verifying): a token that matches the cookie now
      try { await api('/feedback', { text, page, operationId, ...(contact ? { contact } : {}) }); }
      catch (error) { // the session was revoked or superseded meanwhile: to sign-in, as refresh() goes, with the reason in words
        if (error.code !== 'SESSION_REVOKED' && error.code !== 'SIGN_IN_REQUIRED') throw error;
        model = null; signInScreen(); note(messages[error.code]); return;
      }
      closed(); note('Thank you: your feedback was sent.');
    }, 'primary'), button('Cancel', closed, 'ghost')));
  }
  closed(); openFeedbackHere = open; return foot; // the screen's own panel, for the leaving flow to open with the reason filled in
}
let openFeedbackHere = null; // the Send feedback panel of the screen now on show (panel() builds one for every parent screen)
// ---- Update now (the owner's request of 12 Sep 2026): every bootstrap names the release the server runs (RELEASE_SHA, else the
// version). The first one this page saw is its own; any other means a newer app is live, and a bar offers Update now. It never
// reloads by itself, and in kid mode it waits for the end of a question session (panel's `play`). Asked on every bootstrap (so on
// every refresh), when the tab comes back into view, and every five minutes while it is in view (releaseTick, at the end). A page
// opened before this checker existed cannot know: it needs one manual reload.
const RELEASE_CHECK_MS = 5 * 60_000, updateBar = el('div', null, 'update-bar');
let firstRelease = null, newRelease = false, inPlay = false;
function sawRelease(release) {
  if (typeof release !== 'string' || !release) return;
  if (firstRelease === null) firstRelease = release;
  if (release !== firstRelease && !newRelease) { newRelease = true; showUpdate(); }
}
function showUpdate() {
  if (!newRelease || inPlay || [...root.children].includes(updateBar)) return;
  if (!updateBar.children.length) { const go = el('button', 'Update now', 'primary'); go.type = 'button'; go.onclick = () => { if (typeof location === 'object' && location) location.reload(); }; updateBar.append(el('span', 'A new version of AutoMathtics is ready.'), go); }
  root.append(updateBar);
}
async function bootstrap() { const b = await api('/bootstrap'); sawRelease(b.release); return b; }
// In the background (the five-minute tick, and a tab coming back into view) the page asks GET /api/health, which
// reads no cookie and sets none, and asks nothing while a request is in flight (`working`): /api/bootstrap could hand out a fresh
// pre-authentication cookie over the session cookie a hand-over, a PIN, Switch child or a sign-in has just set (review of 12 Sep
// 2026). Health names the deployed commit, or null with the version beside it: bootstrap's value either way. Never an error shown.
const checkRelease = () => (working ? Promise.resolve() : api('/health').then((h) => sawRelease(h.release || h.version), () => {}));
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
  csrf = (await bootstrap()).csrf;
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
      csrf = (await bootstrap()).csrf;
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
    box.append(rail(1), actionRow(button('I have verified my email', async () => authStep(await (await auth()).checkEmail(), afterReady), 'primary'),
      button('Resend verification email', async () => { await (await auth()).resendEmail(); note('Verification email requested.'); }, 'ghost')));
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
  box.append(actionRow(send.button), captchaBox(), otp.wrap, ...(rememberLabel ? [rememberLabel] : []),
    actionRow(button('Verify code', async () => {
      if (remember) { rememberChoice = remember.checked; const tag = await accountTag(result.email); try { if (remember.checked && tag) localStorage.setItem(REMEMBER_PREF, tag); else localStorage.removeItem(REMEMBER_PREF); } catch { /* no storage */ } }
      return authStep(await (await auth()).confirmCode(otp.input.value), afterReady);
    }, 'primary')));
  armCaptcha();
  if (!enrolling && result.email) box.append(actionRow(button('I can\u2019t receive the code', () => recoveryScreen(result.email), 'text-button'))); // Stage 4.4
}
// Stage 4.4: the lost-phone ceremony (RECOVERY.md). No session exists here; the server answers the same for any email.
function recoveryScreen(email) {
  reauthEpoch++; model = null;
  const box = panel('ACCOUNT RECOVERY', 'Lost your phone?', 'Recovery takes seven days and needs your email inbox. Nobody can shorten it. Your family and children stay exactly as they are.', 'w460');
  onBack = () => signInScreen();
  box.append(el('p', `1. Start recovery for ${email}.  2. Reset your password from the emailed link \u2014 that proves the inbox is yours.  3. After the waiting period, complete recovery here, then sign in and verify your new mobile.`, 'notice'));
  const when = (ms) => new Date(ms).toLocaleString();
  const steps = el('div', null, 'stack'); // the three steps in their order, one under the other
  steps.append(button('1. Start recovery', async () => { const r = await api('/auth/recovery/start', { email }); note(`Recovery requested. If this account exists, it can be completed from ${when(r.readyAt)} at the earliest. Now reset your password from the email link.`); }, 'primary'),
    button('2. Send password reset email', async () => { await (await auth()).resetPassword(email); note('If this email can receive a reset link, one has been requested. Set a new password, then come back after the waiting period.'); }, 'ghost'),
    button('3. Complete recovery', async () => {
      const r = await api('/auth/recovery/complete', { email });
      if (r.completed) { signInScreen(); note('Recovery complete. Sign in with your password, then verify your new mobile number.'); return; }
      note('Not completed yet. Recovery needs a request for this email, the password reset from the emailed link, and the waiting period to have passed. Try again later.');
    }, 'ghost'));
  box.append(steps, actionRow(button('Back to sign-in', () => signInScreen(), 'text-button')));
}
// the three steps a parent walks to the grid: lit = here, done = behind
function rail(current) {
  const steps = el('div', null, 'steps');
  ['01  PARENT SIGN-IN', '02  YOUR CREW', '03  KIDS\u2019 MODE'].forEach((t, i) => steps.append(el('span', t, i + 1 < current ? 'done' : i + 1 === current ? 'lit' : '')));
  return steps;
}
function signInScreen(signup = false, afterReady = null, reauth = false) {
  if (!reauth) { reauthEpoch++; parentLive = false; } // a re-verification keeps the parent's session open; any other sign-in screen has none
  model = null;
  const box = panel(reauth ? 'PARENT VERIFICATION' : 'MISSION CONTROL',
    reauth ? 'Confirm it\u2019s you.' : (signup ? 'A new crew starts here.' : 'Big futures. Small steps.'),
    reauth ? 'This sensitive parent action needs a fresh password and SMS check.' :
      (signup ? 'Create your adult account first. Then build a private grid for your explorers.' : 'One secure parent account. A personal learning grid for every child.'), 'w460',
    // the page a note sent from here reports; the plain sign-in screen is the bottom of the stack, so it shows no Back
    { page: reauth ? 'parent-verification' : signup ? 'sign-up' : 'sign-in', back: reauth || signup });
  if (!reauth) box.append(rail(1));
  if (reauth) onBack = cancelVerification; else if (signup) onBack = () => signInScreen();
  const form = el('form', null, 'auth-form');
  const email = field('Parent email', 'email', { autocomplete: 'email', maxLength: 254 });
  const password = field('Password', 'password', { autocomplete: signup ? 'new-password' : 'current-password', minLength: signup ? 12 : 1, maxLength: 128 });
  // A new password is typed twice: one slip in a masked box would lock the parent out of the account made a minute before.
  const again = signup ? field('Type the password again', 'password', { autocomplete: 'new-password', minLength: 12, maxLength: 128 }) : null;
  const submit = el('button', signup ? 'Create parent account' : 'Sign in as parent', 'primary'); submit.type = 'submit';
  const consent = signup ? consentBoxes() : null; // email-v1: the two sign-up boxes
  form.append(email.wrap, password.wrap, ...(again ? [again.wrap] : []), ...(consent ? consent.labels : []), submit);
  form.onsubmit = (event) => { event.preventDefault(); run(async () => {
    if (again && again.input.value !== password.input.value) { note('The two passwords don’t match. Type the same password in both boxes; nothing has been sent.'); return; }
    if (consent && !consent.agreed()) { note('Tick the first box to create the account: account and progress emails are part of the service. News and offers stay optional.'); return; }
    const a = await auth(); const value = password.input.value; password.input.value = ''; if (again) again.input.value = '';
    const result = await (signup ? a.signUp(email.input.value, value) : a.signIn(email.input.value, value));
    if (consent) await recordConsent(a, consent.agreed(), consent.news());
    await authStep(result, afterReady);
  }); };
  box.append(form);
  if (reauth) box.append(actionRow(button('Cancel verification', cancelVerification, 'ghost')));
  else box.append(actionRow(button(signup ? 'Already registered? Sign in' : 'New here? Create a parent account', () => signInScreen(!signup), 'ghost'),
    signup ? null : button('Forgot password?', async () => { if (!email.input.checkValidity()) { email.input.reportValidity(); return; }
      await (await auth()).resetPassword(email.input.value); note('If this email can receive a reset link, one has been requested. Mobile verification is still required.'); }, 'text-button')));
  box.append(el('p', 'EMAIL VERIFIED  //  MOBILE VERIFIED  //  FAMILY-ONLY ACCESS', 'trust'));
}
// email-v1: the sign-up boxes. The first (account, progress and service emails) is required; the second (news and offers) is
// optional and starts unticked, because consent made a condition of sign-up is not consent. The server records both.
function consentBoxes() {
  const box = (words) => { const l = el('label', null, 'check'), i = el('input'); i.type = 'checkbox'; l.append(i, el('span', words)); return { l, i }; };
  const need = box('Send me emails about my account and my children’s progress: a weekly progress report, security notices and service updates. I can turn the weekly report off at any time.');
  const news = box('Also send me news and offers from AutoMathtics. Optional; unsubscribe at any time.');
  return { labels: [need.l, news.l], agreed: () => need.i.checked === true, news: () => news.i.checked === true };
}
// Both boxes are recorded by the server, from the new account's own ID token, the moment the account exists. A failure never
// blocks the sign-up: the defaults then apply (the weekly report on, news off), and Mission Control can change both later.
async function recordConsent(a, progress, news) {
  try { const idToken = await a.idToken?.(); if (!idToken) return; csrf = (await bootstrap()).csrf; await api('/auth/consent', { idToken, progress, news }); }
  catch { /* the defaults apply */ }
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
  setKidMode(model.role !== 'parent'); // the launch pad or a child: no Send feedback on this device until a parent's session opens here
  parentLive = model.role === 'parent';
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
  const leave = el('div', null, 'row-buttons');
  const accountOp = crypto.randomUUID();
  leave.append(button('Delete my sign-in account', async () => {
    if (!window.confirm('Delete your AutoMathtics sign-in account? Your email and mobile number are removed from sign-in. A used free trial stays used.')) return;
    await api('/account/deletion', { operationId: accountOp }); if (authModule) await authModule.clear(); note('Your sign-in account has been deleted.'); await refresh();
  }, 'tiny c-red'));
  box.append(label.wrap, wrap, el('p', 'Pilot acknowledgement only. Final privacy and parental-consent terms must be reviewed before public launch.', 'small muted'),
    actionRow(button('Create family workspace', async () => {
      if (!check.checked) { note('Please acknowledge the pilot notice.'); return; }
      try {
        await api('/family', { label: label.input.value, adultAttestation: true, consentVersion: 'pilot-v1' }); await refresh();
      } catch (error) {
        if (error.code !== 'REAUTHENTICATE') throw error;
        const saved = { label: label.input.value, attested: check.checked };
        reauthenticate(() => familySetup(saved));
      }
    }, 'primary'), button('Sign out', signOut, 'ghost')));
  box.append(el('p', 'No family? You can also remove this sign-in account entirely.', 'small muted'), leave);
}
// A child in Mission Control's crew: v2's PLAYER DATA row (2658-2667) with the player card's look (S1 sends what each child
// wears, never a balance): the face in its ring, the name in its effect and colour, the title, pet and vehicle, the seat and
// the year, and the parent's two actions for this child in the child's colour at the right edge.
function kidRow(child) {
  const a = child.appearance || {}, row = el('div', null, `row kid-row ${accClass(child)}`), words = el('div', null, 'kid-words'), acts = el('div', null, 'kid-acts');
  words.append(el('b', child.nickname, `kid-name ${lookup(NAMEFX_CLASS, a.nameFx)}`.trim()),
    el('span', `${a.title?.name || 'MISSION READY'}${a.pet ? ` · ${a.pet.emoji}${a.outfit?.emoji || ''}` : ''}${a.vehicle ? ` ${a.vehicle.emoji}` : ''}`, 'kid-meta'),
    el('span', `${child.status === 'active' ? 'READY FOR THE GRID' : 'PROFILE INACTIVE'}${child.yearLevel ? ` · Year ${child.yearLevel}${child.start === 'test' ? ' · placement test' : ''}` : ''}`, child.status === 'active' ? 'kid-seat' : 'kid-seat off'));
  acts.append(button(`Reset ${child.nickname}’s PIN`, () => resetPinScreen(child), 'tiny'), button(`Change ${child.nickname}’s starting point`, () => startScreen(child), 'tiny'));
  row.append(avatarBadge(child, { ring: a.ring }, 40), words, acts); return row;
}
// Stage 3.3: a plan choice starts a checkout on the server. With the pilot's fake provider no money
// moves: the server returns a payment reference the operator completes; a real provider (Stage 4)
// returns a URL to go to. Nothing about the plan or the family is decided in the browser.
function planButtons(box, billing) {
  if (!billing?.plans?.length) return;
  const row = el('div', null, 'row-buttons plan-acts');
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
      actionRow(button('Keep my current plan instead', async () => { await api('/billing/plan', { plan: e.plan, operationId: keepOp }); await refresh(); }, 'tiny c-mint')));
  }
  const row = el('div', null, 'row-buttons plan-acts');
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
  box.append(actionRow(button(`Switch to ${plan.name} at renewal`, async () => {
    const seatChildIds = [...picks].filter(([, i]) => i.checked).map(([id]) => id);
    await api('/billing/plan', { plan: plan.id, ...(choose ? { seatChildIds } : {}), operationId: op }); note('Plan change scheduled for the next renewal.'); await refresh();
  }, 'primary'), button('Back', refresh, 'ghost')));
}
// Leaving (the owner's request of 12 Sep 2026): one page, two doors — "Cancel or pause" in Mission Control, and the unsubscribe
// link in an email. It always names what will and will not change, asks why, offers the alternative the server decided on (never
// one the browser invented), and only then does what the parent asked. Nothing is sent until a tap: the first screen writes
// nothing at all, and cancelling goes through its own confirmation screen and the existing /api/billing/cancel route.
const LEAVING_REASONS = [
  ['too_expensive', 'It costs too much'],
  ['not_using', 'We are not using it'],
  ['lost_interest', 'My child lost interest'],
  ['too_many_emails', 'Too many emails'],
  ['technical', 'Technical problems'],
  ['taking_a_break', 'We are taking a break'],
  ['something_else', 'Something else'],
];
/** What will and will not change, in the parent's words, before anything is chosen. */
function leavingFacts(box, e) {
  const when = e?.accessUntil ? new Date(e.accessUntil).toLocaleDateString() : null;
  box.append(el('p', 'Your children keep their profiles, their progress and their coins whatever you choose here. Nothing is charged today, and nothing changes until you tap one of the buttons.', 'notice'));
  if (e?.state === 'trial') box.append(el('p', `The free trial ends ${when}. Cancelling now means it simply is not followed by a subscription.`, 'notice'));
  else if (when && ['active', 'grace'].includes(e?.state)) box.append(el('p', `${e.planName} plan, ${e.seatLimit} child slots, paid to ${when}. Cancelling keeps the grid open until then and does not renew it after that.`, 'notice'));
  else if (e?.state === 'paused') box.append(el('p', 'This subscription is paused: nothing is being collected, and the grid is closed until it starts again.', 'notice'));
}
function leavingScreen(family, e, source = 'app') {
  transientView = true;
  const box = panel('CANCEL OR PAUSE', family.label, 'Before anything changes: tell us why you are thinking of leaving. There may be an easier answer than cancelling.', 'w520');
  onBack = refresh;
  leavingFacts(box, e);
  const picks = new Map();
  for (const [value, words] of LEAVING_REASONS) {
    const label = el('label', null, 'check'), input = document.createElement('input');
    input.type = 'radio'; input.name = 'leaving-reason'; input.value = value;
    label.append(input, el('span', ` ${words}`)); picks.set(value, input); box.append(label);
  }
  const words = el('textarea'); Object.assign(words, { maxLength: 500, rows: 3 });
  const note500 = el('label', null, 'field'); note500.append(el('span', 'Anything else you would like to tell us (optional, up to 500 characters)'), words);
  box.append(note500);
  box.append(actionRow(button('Continue', async () => {
    const reason = [...picks].find(([, i]) => i.checked)?.[0] || null;
    if (!reason) { note(messages.LEAVING_REASON_REQUIRED); return; }
    const offers = await api('/leaving/offers', { reason });
    leavingOffersScreen(family, e, { ...offers, freeText: words.value.trim(), source });
  }, 'primary'), button('Back', refresh, 'ghost')));
}
/** One submit for every action: the reason and the free text travel with it, and one operation id makes a retried tap one record. */
function leavingSend(view, body, told) {
  const operationId = crypto.randomUUID();
  const send = async () => {
    const r = await api('/leaving', { reason: view.reason, ...(view.freeText ? { freeText: view.freeText } : {}), source: view.source, operationId, ...body });
    await refresh(); note(told(r));
  };
  return async () => {
    try { await send(); }
    catch (error) {
      if (error.code !== 'REAUTHENTICATE') throw error;
      reauthenticate(async () => { await refresh(); note('Parent verified. Open Cancel or pause again to finish.'); });
    }
  };
}
function leavingOffersScreen(family, e, view) {
  transientView = true;
  const hold = view.hold === true; // technical problems: the feedback panel first, and nothing cancelled yet
  const box = panel('CANCEL OR PAUSE', hold ? 'Let us fix it first' : 'What would you like to do?',
    hold ? 'Tell us what went wrong and we will look into it. Nothing is cancelled by doing that.'
      : view.offers.length ? 'One of these may suit you better than leaving. Or carry on below.' : 'Here is what you can do.', 'w520');
  onBack = refresh;
  leavingFacts(box, e);
  // the offers stand in one of v2's rows of buttons, the notice that explains a pause above it; never loose in the card
  const offers = el('div', null, 'row-buttons');
  for (const offer of view.offers) {
    if (offer.kind === 'email_monthly') offers.append(button('Send the progress report monthly instead of weekly', leavingSend(view, { action: 'reduce_email', cadence: 'monthly', offerAccepted: 'email_monthly' }, () => 'The progress report now comes once a month, on the first Monday. Your subscription is unchanged.'), 'primary'));
    if (offer.kind === 'email_off') offers.append(button('Turn the progress report off, keep the subscription', leavingSend(view, { action: 'reduce_email', cadence: 'off', offerAccepted: 'email_off' }, () => 'The progress report is off. Your subscription is unchanged.'), 'ghost'));
    if (offer.kind === 'pause') {
      box.append(el('p', 'A pause keeps everything as it is and collects nothing: the months you have paid for run to their end, then the grid closes until the pause is over. Your children lose nothing.', 'notice'));
      for (const months of offer.months) offers.append(button(`Pause for ${months} month${months === 1 ? '' : 's'}`, leavingSend(view, { action: 'pause', months, offerAccepted: 'pause' }, () => `Paused for ${months} month${months === 1 ? '' : 's'}. Nothing more will be charged until it is over, and you can start again any time.`), 'ghost'));
    }
    if (offer.kind === 'downgrade' || offer.kind === 'seats') {
      const name = offer.plan === 'starter' ? 'Starter' : offer.plan === 'family' ? 'Family' : offer.plan === 'big' ? 'Big family' : offer.plan;
      offers.append(button(offer.kind === 'downgrade' ? `Switch to the smaller ${name} plan at renewal (${offer.seats} slots)` : `Fewer seats at renewal: ${name}, ${offer.seats} slots`,
        leavingSend(view, { action: 'downgrade', plan: offer.plan, offerAccepted: offer.kind }, () => `Scheduled: ${name} from the next renewal. Nobody loses a seat before then.`), 'ghost'));
    }
    if (offer.kind === 'feedback') offers.append(button('Tell us what went wrong', () => {
      if (openFeedbackHere) openFeedbackHere(`Technical problems.${view.freeText ? ` ${view.freeText}` : ''}`);
      note('Nothing has been cancelled. Tell us below and we will look into it.');
    }, 'primary'));
  }
  if (view.offers.length) box.append(offers);
  if (view.capped) box.append(el('p', 'We offered you alternatives not long ago, so here are the plain choices.', 'small muted'));
  box.append(actionRow(
    button('Keep everything as it is', leavingSend(view, { action: 'keep' }, () => 'Nothing was changed. Thank you for telling us.'), 'ghost'),
    hold ? button('I still want to cancel', () => leavingOffersScreen(family, e, { ...view, hold: false, offers: [] }), 'text-button')
      : ['trial', 'active', 'grace', 'paused'].includes(e?.state) ? button('Cancel my subscription', () => leavingCancelScreen(family, e, view), 'text-button') : null,
    button('Back', refresh, 'ghost')));
}
// Cancelling goes through its own screen, like deleting the family and scrapping a rocket: one tap on the button above sends
// nothing. The route is the existing /api/billing/cancel (through the leaving record), which tells the provider first.
function leavingCancelScreen(family, e, view) {
  transientView = true;
  const paused = e?.state === 'paused', when = e?.accessUntil ? new Date(e.accessUntil).toLocaleDateString() : null;
  const box = panel('CANCEL OR PAUSE', 'Cancel the subscription?', paused
    ? 'This subscription is paused, so cancelling ends it now. Nothing more will ever be collected for it. Your children keep their profiles and progress.'
    : `The grid stays open until ${when || 'the end of the period you have paid for'} and is not renewed after that. Your children keep their profiles, their progress and their coins. You can subscribe again whenever you like.`, 'w460');
  onBack = refresh;
  box.append(actionRow(button('Back', () => leavingOffersScreen(family, e, view), 'ghost'), // Back first: the second tap of a double-tap lands here, not on Cancel
    button(paused ? 'Yes, end it now' : 'Yes, cancel at the period end', leavingSend(view, { action: 'cancel' }, () => (paused ? 'The subscription has ended. Nothing more will be charged.' : `Cancelled. The grid stays open until ${when || 'the end of this period'}, and you can keep it any time before then.`)), 'primary')));
}
function deletionScreen(family) {
  transientView = true;
  const box = panel('DELETE FAMILY', family.label, 'The children\u2019s profiles, progress, coins and this family\u2019s settings will be removed after 14 days. Payment records and the security audit trail are kept as required. A used free trial stays used. Your sign-in account itself is separate and is not deleted here.', 'w460');
  const op = crypto.randomUUID(); onBack = refresh;
  box.append(el('p', 'You can cancel any time in the next 14 days from the parent workspace. Download your data first if you want to keep it.', 'notice'),
    actionRow(button('Delete after 14 days', async () => { await api('/family/deletion', { operationId: op }); note('Deletion scheduled.'); await refresh(); }, 'primary'), button('Back', refresh, 'ghost')));
}
// Mission Control as v2's admin panel (2614-2856): one card, a block per concern under its title in the block's colour, each
// child's actions in the child's own row, and v2's footer with Hand over to kids where v2 had Done. Every label is v3's, and
// every change is the server's to make.
async function parentScreen() {
  const family = model.family, e = family.entitlement || { status: 'inactive', seatLimit: 0, accessUntil: 0 };
  const billing = await api('/billing'); // plans, trial eligibility and the payment reference come from the server, never guessed from /me
  const active = e.status === 'active' && e.accessUntil > Date.now(); // Display only; API is authoritative.
  const box = panel('MISSION CONTROL', family.label, 'Your explorers, your grid. Hand the device over when it’s time to play; parent access stays locked until you sign in again.', 'admin',
    { back: false }); // the workspace every other parent screen goes back TO
  // 🔐 Account & security, as v2's ADMIN GATE block (2617-2627): red while a finished recovery request waits for the parent (Stage 4.4)
  const r = model.recovery, alert = Boolean(r && r.status !== 'pending' && !r.acknowledgedAt);
  const account = adminSection('🔐 Account & security', alert ? 'c-red' : 'c-dim'), gate = el('div', null, alert ? 'gate alert' : 'gate');
  if (alert) { // shown until the parent acknowledges it, and only after a fresh sign-in: a remembered device must not let anyone hide it
    const when = new Date(r.requestedAt).toLocaleDateString();
    gate.append(el('p', r.status === 'completed' ? `Account recovery requested on ${when} was completed and a new mobile was verified. If that wasn’t you, reset your password now and contact support.`
      : `Account recovery was requested on ${when} and ${r.status === 'cancelled_by_operator' ? 'cancelled by support' : 'cancelled by your sign-in'}. If you didn’t request it, reset your password now.`, 'gate-alert'),
    actionRow(button('It was me', async () => { try { await api('/auth/recovery/ack', {}); } catch (error) { if (error.code !== 'REAUTHENTICATE') throw error; reauthenticate(async () => { await api('/auth/recovery/ack', {}); await refresh(); }); return; } await refresh(); }, 'tiny c-mint')));
  }
  if (model?.rememberedUntil) gate.append(el('p', `This device stays signed in until ${new Date(model.rememberedUntil).toLocaleDateString()}. Sign out to forget it.`, 'gate-line')); // Remember this device
  const gateActs = el('div', null, 'gate-acts'); // Stage 4 review: the old phone still works, the number is changing
  gateActs.append(button('Change my mobile number', changeMobileScreen, 'tiny c-cyan'), button('Sign out', signOut, 'tiny c-dim'));
  gate.append(gateActs); account.append(gate); box.append(account);
  // 👥 Your crew: the slots in use and the plan's state, a row per child, and a dashed row to add one while a slot is free
  const crew = adminSection('👥 Your crew', 'c-cyan'), seats = el('div', null, 'seat-line');
  const STATE = { trial: 'FREE TRIAL', active: 'SUBSCRIBED', grace: 'RENEWAL DUE', past_due: 'PAYMENT OVERDUE', cancelled: 'CANCELLED', expired: 'EXPIRED' };
  seats.append(el('b', `${family.activeCount} / ${e.seatLimit}`, 'seat-count'), el('span', 'child slots in use', 'seat-words'),
    el('span', e.state ? STATE[e.state] || e.state : (active ? 'PILOT ACCESS ACTIVE' : 'AWAITING ACTIVATION'), active ? 'state-chip' : 'state-chip due'));
  crew.append(seats, ...family.children.map(kidRow));
  if (active && family.activeCount < e.seatLimit) {
    const free = e.seatLimit - family.activeCount, add = el('div', null, 'row dashed add-row'), plus = el('span', '➕', 'add-icon'); plus.setAttribute('aria-hidden', 'true');
    add.append(plus, el('span', `${free} free child slot${free === 1 ? '' : 's'}`, 'row-words'), button('Add a child', addChildScreen, 'tiny c-mint')); crew.append(add);
  }
  box.append(crew);
  // 💳 Plan & seats in v2's featured box (the rocket's, 2786): the plan and when it turns, cancel or keep, a free seat, a change of
  // plan, checkout or the trial (Stages 3.3-3.5). The dates are the server's; the browser only shows them.
  const plan = el('section', null, 'admin-sec feature-box'); plan.append(el('h2', '💳 Plan & seats', 'log-title'));
  if (e.state) { // a subscription: what it is and when it turns
    const when = e.accessUntil ? new Date(e.accessUntil).toLocaleDateString() : null;
    const line = e.state === 'trial' ? `${e.planName}${e.cancelAtPeriodEnd ? ', ending' : ', ends'} ${when}. Subscribe before then to keep going.`
      : e.state === 'active' ? `${e.planName} plan, ${e.seatLimit} child slots. ${e.cancelAtPeriodEnd ? `Ends ${when}.` : `Renews ${when}.`}`
      : e.state === 'grace' ? `${e.planName} plan. The renewal payment has not arrived; access continues until ${when}.`
      : e.state === 'past_due' ? `${e.planName} plan. Access is paused until a payment goes through.`
      : e.state === 'paused' ? `${e.planName} plan, paused.${e.pause?.resumesAt ? ` Collection starts again on ${new Date(e.pause.resumesAt).toLocaleDateString()}.` : ''} The grid is closed until then; every profile and all progress is kept.`
      : e.state === 'cancelled' ? 'The subscription has ended. Subscribe again to reopen the grid.' : 'The subscription expired. Subscribe again to reopen the grid.';
    plan.append(el('p', line, 'plan-line'));
    // Leaving (12 Sep 2026): a pause the parent asked for, said plainly, with the way out of it
    if (e.pause && e.state !== 'paused') plan.append(el('p', `Paused: the period you have paid for runs to ${e.accessUntil ? new Date(e.accessUntil).toLocaleDateString() : 'its end'}${e.pause.resumesAt ? `, then nothing is collected until ${new Date(e.pause.resumesAt).toLocaleDateString()}` : ''}.`, 'plan-line'));
    if (e.pause) {
      const resumeOp = crypto.randomUUID();
      plan.append(actionRow(button('Start my subscription again now', async () => { await api('/billing/resume', { operationId: resumeOp }); note('The pause is over. Your next invoice comes as usual.'); await refresh(); }, 'tiny c-mint')));
    }
    if (['trial', 'active', 'grace'].includes(e.state)) {
      const cancelOp = crypto.randomUUID(), acts = el('div', null, 'plan-acts'); // one id per rendered button: a retried click is the same event
      if (e.cancelAtPeriodEnd) acts.append(button('Keep my subscription', async () => { await api('/billing/cancel', { undo: true, operationId: cancelOp }); await refresh(); }, 'tiny c-mint'));
      else if (!e.pause) acts.append(button('Cancel or pause', () => leavingScreen(family, e), 'tiny c-red')); // the leaving flow: a reason, an offer, and only then the action
      // a child without a seat can be given a free one (adding only; a downgrade is the only way a seat is taken away)
      const seated = family.children.filter((c) => c.status === 'active').map((c) => c.id);
      if (active && seated.length < e.seatLimit) for (const c of family.children.filter((c) => c.status !== 'active')) {
        const seatOp = crypto.randomUUID();
        acts.append(button(`Give ${c.nickname} a seat`, async () => { await api('/billing/seats', { childIds: [...seated, c.id], operationId: seatOp }); await refresh(); }, 'tiny'));
      }
      plan.append(acts);
      if (['active', 'grace'].includes(e.state)) planChangeControls(plan, billing, e, family);
    }
    // a paused family cancels (or ends the pause) through the same flow; it never starts a fresh checkout, because its
    // subscription is still there, waiting (CHECKOUT_STATES in payments.mjs would refuse one)
    if (e.state === 'paused') plan.append(actionRow(button('Cancel or pause', () => leavingScreen(family, e), 'tiny c-red')));
    if (!['active', 'grace', 'paused'].includes(e.state)) planButtons(plan, billing);
  } else if (!active) {
    planButtons(plan, billing);
    if (billing?.trial?.eligible) {
      const trialOp = crypto.randomUUID();
      plan.append(el('p', 'Your parent account is ready. Start the free trial to open two child slots for seven days.', 'notice'),
        actionRow(button('Start the 7-day free trial', async () => { await api('/billing/trial', { operationId: trialOp }); note('Trial started.'); await refresh(); }, 'primary')));
    } else {
      plan.append(el('p', `${messages[billing?.trial?.reason] || 'The free trial is not available for this family.'} Ask the pilot operator to activate child slots.`, 'notice'));
    }
  } else plan.append(el('p', `Pilot access: ${e.seatLimit} child slot${e.seatLimit === 1 ? '' : 's'} until ${new Date(e.accessUntil).toLocaleDateString()}.`, 'plan-line')); // an operator's grant: no plan to change
  box.append(plan);
  // 🎮 Game & progress: pace and scan focus, approvals, the Reward Store, the Family Rocket, coins and the logs, on their own screen
  if (family.children.length) {
    const game = adminSection('🎮 Game & progress', 'c-gold'), go = el('div', null, 'row');
    go.append(el('span', 'Pace and scan focus, approvals, the Reward Store, the Family Rocket, coins and each explorer’s log.', 'row-words'), button('Game & progress', parentGameScreen, 'tiny'));
    game.append(go); box.append(game);
  }
  box.append(emailBlock(model.emailPrefs)); // email-v1: the weekly report and news switches
  // 🗄 Data & deletion (Stage 3.5): the family's own data to keep, and the way to leave — 14 days to change your mind
  const leave = adminSection('🗄 Data & deletion', 'c-red'), keep = el('div', null, 'data-acts');
  keep.append(button('Download my family’s data', async () => {
    const data = await api('/family/export'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `automathtics-family-${family.id.slice(0, 8)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }, 'tiny c-cyan'));
  if (family.deletion) {
    const cancelOp = crypto.randomUUID();
    leave.append(el('p', `This family is scheduled for deletion on ${new Date(family.deletion.effectiveAt).toLocaleDateString()}. Everything except the payment records and the security audit trail will be removed.`, 'notice'));
    keep.append(button('Keep my family', async () => { await api('/family/deletion/cancel', { operationId: cancelOp }); note('Deletion cancelled.'); await refresh(); }, 'tiny c-mint'));
  } else keep.append(button('Delete this family', () => deletionScreen(family), 'tiny c-red'));
  leave.append(keep, el('p', `Family reference: ${family.id}`, 'reference')); box.append(leave);
  // v2's footer (2839-2853): Hand over to kids in Done's place, and Sign out
  const foot = actionRow(family.children.length ? button('Hand over to kids', async () => {
    if (authModule) await authModule.clear(); await api('/session/lock', {}); channel?.postMessage('changed'); await refresh();
  }, 'primary') : null, button('Sign out', signOut, 'ghost'));
  foot.className = 'row-buttons admin-foot'; box.append(foot);
}
// email-v1: Mission Control's Email updates block, the switches as the server holds them (/api/me). Saving needs a recent sign-in
// (a child at a remembered, open Mission Control must not switch the report off); after one the parent sets the switches again,
// because a change is never sent by itself.
function emailBlock(prefs) {
  const wrap = adminSection('📧 Email updates', 'c-violet');
  const sw = (words, detail, on) => { const l = el('label', null, 'check'), i = el('input'), s = el('span', words); i.type = 'checkbox'; i.checked = on; s.append(el('small', detail)); l.append(i, s); wrap.append(l); return i; };
  const progress = sw('Weekly progress report', 'Every Monday: what each child got right and fast, right but slow, and wrong again and again, with a suggested pace.', prefs?.progress !== false);
  // Leaving (12 Sep 2026): monthly instead of weekly, for a parent who finds it too much but does not want to lose it
  const monthly = sw('Send it monthly instead', 'One email on the first Monday of the month, covering four weeks.', prefs?.cadence === 'monthly');
  const news = sw('News and offers', 'Occasional news and offers from AutoMathtics.', prefs?.news === true);
  const save = el('div', null, 'row email-save');
  save.append(el('span', 'Account and security emails always come.', 'row-words'), button('Save email settings', async () => {
    // one switch, sent as the cadence it means: off, weekly, or monthly — never both a boolean and a cadence that disagree
    const cadence = progress.checked !== true ? 'off' : monthly.checked === true ? 'monthly' : 'weekly';
    try { await api('/account/email', { cadence, news: news.checked === true }); await refresh(); note('Email settings saved.'); }
    catch (error) { if (error.code !== 'REAUTHENTICATE') throw error; reauthenticate(async () => { await refresh(); note('Parent verified. Set the switches again, then save.'); }); }
  }, 'tiny'));
  wrap.append(save); return wrap;
}
// email-v1: a button in the weekly email opens the app with its signed token (#email=). Link scanners and mail previews open it
// too, so nothing changes on arrival: the server says what the button does, and only Confirm sends it. Works signed in or not.
async function emailScreen(token) {
  const d = await api('/email/describe', { t: token });
  transientView = true;
  if (!d.valid) {
    const box = panel('EMAIL BUTTON', 'This link no longer works.', d.reason === 'expired' ? 'Buttons in the weekly email work for 14 days (a year to stop the report); the next email brings fresh ones. Nothing was changed.' : 'The family or child it was for may be gone, or the link was changed on the way. Nothing was changed.', 'w460');
    onBack = refresh; box.append(actionRow(button('Close', refresh, 'ghost'))); return;
  }
  const what = d.action === 'pace' ? `Set ${d.nickname}’s question time to ${d.value}% (now ${d.current}%).`
    : d.action === 'focus' ? (d.value ? `Focus ${d.nickname}’s weekly System Scan on the weak spots: about 75% of its questions on what ${d.nickname} gets wrong or slow, 25% recap.` : `Switch ${d.nickname}’s System Scan focus off: back to the normal mix.`)
    : `Stop the ${d.cadence === 'monthly' ? 'monthly' : 'weekly'} progress report for ${d.email || 'this account'}. Account and security emails still come.`;
  const box = panel('EMAIL BUTTON', 'Confirm this change', '', 'w460'); onBack = refresh;
  const apply = (body, told) => async () => { const r = await api('/email/apply', { t: token, ...body }); await refresh(); note(told || r.message); };
  // Leaving (12 Sep 2026): the unsubscribe link offers monthly before off — the least a parent who says "too many emails" is
  // asking for — and, with Mission Control open, the way through to the whole cancel-or-pause flow.
  const monthlyFirst = d.action === 'unsub' && d.cadence === 'weekly';
  box.append(el('p', what, 'box c-gold email-what'));
  if (monthlyFirst) box.append(el('p', 'Once a month may be enough: one email on the first Monday, covering four weeks.', 'notice'));
  box.append(actionRow(
    monthlyFirst ? button('Send it monthly instead', apply({ cadence: 'monthly' }), 'primary') : button('Confirm', apply({}), 'primary'),
    monthlyFirst ? button('No, stop the report', apply({ cadence: 'off' }), 'ghost') : null,
    button('Cancel', async () => { await refresh(); note('Nothing was changed.'); }, 'ghost')));
  if (d.action === 'unsub' && model?.role === 'parent' && model.family) { // signed in on this device: the whole flow is one tap away
    box.append(actionRow(button('It is not just the email — cancel or pause', () => leavingScreen(model.family, model.family.entitlement, 'email'), 'text-button')));
  }
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
    box.append(phone.wrap, consentLabel, actionRow(send.button), captchaBox(), otp.wrap,
      actionRow(button('Verify new number', async () => {
        const r = await (await auth()).changeMobileConfirm(otp.input.value); keepSdkSession = false;
        await api('/auth/logout', {}); channel?.postMessage('changed'); model = null; signInScreen(); note(r.notice); // the next sign-in carries the new factor
      }, 'primary'),
      button('Cancel', cancel, 'ghost')));
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
  const iconWrap = el('label', null, 'field'); iconWrap.append(el('span', 'Profile icon'), select);
  box.append(name.wrap, iconWrap, first.wrap, repeat.wrap, age.wrap, start.wrap, start.options, actionRow(button('Create child profile', async () => {
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
  }, 'primary'), button('Back to family', refresh, 'ghost')));
}
function startScreen(child) {
  transientView = true;
  const box = panel('LAUNCH POINT', child.nickname, 'Only possible before the child has played anything. A recent parent sign-in is required.', 'w460');
  onBack = refresh;
  const start = startChooser({ yearLevel: child.yearLevel, start: child.start });
  box.append(start.wrap, start.options, actionRow(button('Save starting point', async () => {
    try { await api(`/children/${child.id}/start`, { start: start.value(), yearLevel: Number(start.year.value) }); note('Starting point saved.'); await refresh(); }
    catch (error) { if (error.code === 'ALREADY_STARTED') { note(messages.ALREADY_STARTED); return; } throw error; }
  }, 'primary'), button('Back', refresh, 'ghost')));
}
function resetPinScreen(child) {
  transientView = true;
  const box = panel('PARENT ACTION', `Reset ${child.nickname}\u2019s PIN`, 'This invalidates existing child sessions. A recent parent sign-in is required.', 'narrow');
  onBack = refresh;
  const { first, repeat, valid } = pinFields();
  box.append(first.wrap, repeat.wrap, actionRow(button('Set new PIN', async () => {
    if (!valid()) { note('Enter the same six-digit PIN twice.'); return; }
    try {
      await api(`/children/${child.id}/pin`, { pin: first.input.value }); await refresh(); note('Child PIN changed.');
    } catch (error) {
      if (error.code !== 'REAUTHENTICATE') throw error;
      first.input.value = repeat.input.value = '';
      reauthenticate(() => { resetPinScreen(child); note('Parent verified. Enter the new child PIN again.'); });
    }
  }, 'primary'), button('Back', refresh, 'ghost')), actionRow(button('Reauthenticate parent', () => reauthenticate(() => resetPinScreen(child)), 'text-button')));
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
  try { const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return null; audioCtx ||= new Ctx(); if (audioCtx.state === 'suspended') audioCtx.resume?.()?.catch?.(() => {}); return audioCtx; } catch { return null; }
}
// iPad Safari lets WebAudio start only inside a tap, and a sound here plays once the server has answered, when the tap is long over
// (QA, 12 Sep 2026). So on a kid's device a tap — the PIN pad's first — makes the context, or wakes one the system has suspended, and
// plays one silent sample inside the tap itself; the sounds after it then play. A parent's screens make no audio at all, and a click a
// script made (untrusted) is no tap: a context made then could not start.
function unlockAudio(event) {
  if (!kidMode || event?.isTrusted === false || audioCtx?.state === 'running') return;
  const c = ac(); if (!c) return;
  try { const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0); } catch { /* silence */ }
}
for (const type of ['touchend', 'click', 'keydown']) document.addEventListener?.(type, unlockAudio, true);
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
function trackCard(t, p, start) {
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
  if (start) card.append(button(due ? `👑 CHECK POINT T${p.bossCleared + 1} ▶` : done ? '🔁 Practice ▶' : `${T.emoji} Start ${T.label} ▶`,
    start, `primary track-go${due || (!done && t === 'nav') ? ' gold' : done ? ' done' : ''}`));
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
  if (st.active) { const s = st.active.session; box.append(el('p', `A ${s.mode === 'placement' ? 'placement test' : `${TRACK[s.track].name} session`} is open at question ${s.index + 1} of ${s.count}.`, 'notice'), actionRow(button('Continue', () => playView(s, st.active.question), 'primary'))); }
  const tracks = el('div', null, 'track-grid');
  if (pending) tracks.append(placementCard(st)); else for (const t of ['engine', 'nav']) tracks.append(trackCard(t, st[t], st.active ? null : () => beginRun(t, st)));
  box.append(tracks); if (!pending) box.append(jumpBanner(e, n));
  const rocket = rocketPanel(g); if (rocket) { if (after.boom === true) rocket.append(moneySplash('big')); box.append(rocket); }
  const nav = el('div', null, 'row-buttons home-nav'); // v2's four (3016-3021); How to opens on Engine, with a tab for Navigator
  nav.append(button('🛒 Shop', shopScreen, 'ghost'), button('🗺 Map', mapScreen, 'ghost'), button('📖 How to', () => howToScreen('engine', { engine: e.level, nav: n.level }), 'ghost'), button('🎓 Guide', guideScreen, 'ghost'));
  box.append(nav);
  if (st.scan?.available && !st.active && !pending) { const scan = actionRow(button('🧠 SYSTEM SCAN — weekly ×2 loot ▶', () => startRun({ track: 'engine', mode: 'scan' }), 'ghost c-violet')); scan.className = 'row-buttons scan-row'; box.append(scan); }
  else if (st.scan?.doneThisWeek) box.append(el('p', '🧠 System Scan done this week · resets Monday', 'subtle'));
  box.append(actionRow(button('Parent sign-in', () => signInScreen(), 'text-button')));
  const log = homeLog(child, st.history);
  root.replaceChildren(homeHeader(child, st, w), box, ...(log ? [log] : [])); showUpdate(); // the page was rebuilt after panel(): a newer release's bar goes back on
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
// ---- the map (v2 3350-3515): the sector's route drawn as its letter, the check-point strip, the fluency heatmap, the trophy
// case and the weekly scan. All of it is the learning state the server keeps; nothing on this screen can move it ----
// the route through each sector's letter (LETTER_ROUTES 220-227): one polyline in a 200×240 box. The five check points ride it
// at 1/6…5/6 of its length, or where `at` puts them on a lopsided letter; the 🔓 exit is its end; `extra` finishes the letter
const LETTER_ROUTES = {
  A: { route: [[36, 226], [68, 128], [100, 16], [132, 128], [164, 226]], extra: [[[59, 156], [141, 156]]] },
  B: { route: [[56, 226], [56, 14], [110, 14], [136, 26], [146, 50], [138, 82], [112, 100], [56, 100], [122, 100], [156, 116], [168, 152], [160, 196], [126, 226], [56, 226]], extra: [], at: [0.09, 0.33, 0.44, 0.66, 0.85] },
  C: { route: [[156, 54], [136, 28], [108, 16], [76, 22], [52, 44], [40, 80], [38, 120], [44, 164], [62, 198], [92, 222], [124, 224], [150, 206], [158, 186]], extra: [] },
  D: { route: [[56, 226], [56, 14], [104, 14], [136, 28], [156, 60], [162, 120], [156, 180], [136, 212], [104, 226], [56, 226]], extra: [] },
  E: { route: [[158, 16], [56, 16], [56, 226], [158, 226]], extra: [[[56, 121], [140, 121]]] },
  F: { route: [[158, 16], [56, 16], [56, 226]], extra: [[[56, 126], [138, 126]]], at: [0.05, 0.26, 0.48, 0.7, 0.91] },
};
const CP_COLORS = ['#35E0FF', '#2DFFB3', '#FFB020', '#FF2DA8', '#8A5CFF']; // each check point's own neon (229) where no map theme recolours them
const cpAt = (g, t) => (g.at ? g.at[t - 1] : t / 6);
// how much of the route is lit (233-240): check point t is reached at paper t×20, the last stretch only once all five are cleared
function energyFor(g, papers, allCleared) {
  if (allCleared) return 1;
  const p = Math.max(0, Math.min(100, papers)), i = Math.floor(p / 20), a = i === 0 ? 0 : cpAt(g, i), b = i >= 5 ? 1 : cpAt(g, i + 1);
  return a + (b - a) * ((p % 20) / 20);
}
const routeLen = (r) => r.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) : 0), 0);
const routeD = (r) => r.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
// the point at fraction f of a polyline's length (244-256)
function pointAt(r, f) {
  const segs = r.slice(1).map((p, i) => Math.hypot(p[0] - r[i][0], p[1] - r[i][1]));
  let want = Math.max(0, Math.min(1, f)) * segs.reduce((a, b) => a + b, 0);
  for (let i = 0; i < segs.length; i++) {
    if (want <= segs[i] || i === segs.length - 1) { const k = segs[i] ? Math.min(1, want / segs[i]) : 0; return [r[i][0] + (r[i + 1][0] - r[i][0]) * k, r[i][1] + (r[i + 1][1] - r[i][1]) * k]; }
    want -= segs[i];
  }
  return r[r.length - 1];
}
// a check point as v2 draws it (3415-3425): 👑 once cleared, ⚡ once its tier is reached, 🔒 ahead
const cpState = (p, t) => { const cleared = p.bossCleared >= t, due = !cleared && p.paper > (t - 1) * 20; return { cleared, due, open: cleared || due, icon: cleared ? '👑' : due ? '⚡' : '🔒', word: cleared ? 'cleared' : due ? 'reached' : 'locked' }; };
const SVG_NS = 'http://www.w3.org/2000/svg', r1 = (x) => Math.round(x * 10) / 10;
const canDraw = () => typeof document.createElementNS === 'function'; // the test harness has no SVG: the map then says the route in words
const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
// an SVG node: its attributes are the drawing (a colour here is an attribute or a class, never a style)
function svgEl(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text; return n;
}
// the route (3384-3431): the whole letter unlit, the stretch driven so far lit in the child's colour or the map theme's (.route-lit
// reads --lit), a white core, a packet of light running it, the exit, the five check points in their colours, and the vehicle
function routeSvg(glyph, p, energy, cps, veh, label) {
  const len = routeLen(glyph.route), d = routeD(glyph.route), lit = `${r1(len * energy)} ${r1(len)}`, line = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const svg = svgEl('svg', { viewBox: '-18 -18 236 276', role: 'img', 'aria-label': label, class: 'route-svg' }), defs = svgEl('defs'), merge = svgEl('feMerge');
  const neon = svgEl('filter', { id: 'amNeon', x: '-70%', y: '-70%', width: '240%', height: '240%' });
  merge.append(svgEl('feMergeNode', { in: 'b' }), svgEl('feMergeNode', { in: 'b' }), svgEl('feMergeNode', { in: 'SourceGraphic' }));
  neon.append(svgEl('feGaussianBlur', { stdDeviation: 4.5, result: 'b' }), merge); defs.append(neon); svg.append(defs);
  for (const s of glyph.extra) svg.append(svgEl('path', { d: routeD(s), stroke: '#161C42', 'stroke-width': 9, ...line }));
  svg.append(svgEl('path', { d, stroke: '#161C42', 'stroke-width': 9, ...line }),
    svgEl('path', { d, class: 'route-lit', 'stroke-width': 9, filter: 'url(#amNeon)', opacity: 0.55, 'stroke-dasharray': lit, ...line }),
    svgEl('path', { d, stroke: '#EAF2FF', 'stroke-width': 2.4, 'stroke-dasharray': lit, ...line }));
  if (energy > 0.03 && !reducedMotion()) { // no running light for someone who asked for no motion (CSS cannot stop an SVG animate)
    const packet = svgEl('path', { d, stroke: '#FFFFFF', 'stroke-width': 4, filter: 'url(#amNeon)', 'stroke-dasharray': `8 ${r1(len)}`, ...line });
    packet.append(svgEl('animate', { attributeName: 'stroke-dashoffset', from: 0, to: r1(-len * energy), dur: `${Math.max(1.8, (len * energy) / 60).toFixed(1)}s`, repeatCount: 'indefinite' }));
    svg.append(packet);
  }
  const [ex, ey] = pointAt(glyph.route, 1), exit = svgEl('g'), through = energy >= 1;
  exit.append(svgEl('circle', { cx: r1(ex), cy: r1(ey), r: 12, fill: '#0B0E23', stroke: '#8A5CFF', 'stroke-width': 2, opacity: through ? 1 : 0.7, ...(through ? { filter: 'url(#amNeon)' } : {}) }),
    svgEl('text', { x: r1(ex), y: r1(ey + 4), 'text-anchor': 'middle', 'font-size': 11 }, through ? '🔓' : '🔒'), svgEl('title', {}, 'next level'));
  svg.append(exit);
  for (let t = 1; t <= 5; t++) {
    const [cx, cy] = pointAt(glyph.route, cpAt(glyph, t)), s = cpState(p, t), g = svgEl('g', s.due ? { class: 'cpdue' } : {});
    g.append(svgEl('circle', { cx: r1(cx), cy: r1(cy), r: 14.5, fill: '#0B0E23', stroke: s.open ? cps[t - 1] : '#2A3170', 'stroke-width': s.open ? 2.5 : 2, ...(s.open ? { filter: 'url(#amNeon)' } : {}) }),
      svgEl('text', { x: r1(cx), y: r1(cy + 5), 'text-anchor': 'middle', 'font-size': 14 }, s.icon), svgEl('title', {}, `Check point ${t} — papers ${t * 20 - 19}–${t * 20}`));
    svg.append(g);
  }
  if (veh) { // it rides a touch ahead of the lit tip, so it never sits on a check point's crown
    const [vx, vy] = pointAt(glyph.route, Math.min(0.985, Math.max(0.03, energy) + 0.04));
    svg.append(svgEl('text', { x: r1(vx), y: r1(vy + 8), 'text-anchor': 'middle', 'font-size': 22, class: 'mapveh', filter: 'url(#amNeon)', 'aria-hidden': 'true' }, veh.emoji));
  }
  return svg;
}
// the fluency heatmap (3453-3471), a cell per tier of the track's sector from the server's heatmap: grey under five answers, red
// under 90% right, gold when the answers took more than ¾ of the time they were allowed, mint otherwise. Each cell says it in
// numbers and in a word as well, never by colour alone.
const HEAT_WORD = { mint: '✓ fast', gold: '⏳ slow', red: '✗ practise', grey: 'play more' };
function heatCell(c, t, levelId) {
  const n = c?.attempts || 0, tone = n < 5 ? 'grey' : c.accuracy < 90 ? 'red' : c.pace > 0.75 ? 'gold' : 'mint', each = c?.timed ? Math.round(c.allowed / c.timed) : null;
  const cell = el('div', null, `heat-cell ${tone}`);
  cell.setAttribute('title', n ? `Tier ${t} · ${n} question${n === 1 ? '' : 's'} logged in Sector ${levelId}${each ? ` · ${each}s allowed each, aiming under ${Math.round(each * 0.75)}s` : ''}` : `Tier ${t} · nothing logged yet in Sector ${levelId}`);
  cell.append(el('b', `T${t}`), el('span', n >= 5 ? `${Math.round(c.accuracy)}% · ${Math.round(c.avgSeconds)}s` : 'no data', 'heat-nums'),
    el('span', n >= 5 && each ? `${n}q / ${each}s` : n ? `${n}q` : '—', 'heat-sub'), el('span', HEAT_WORD[tone], 'heat-word'));
  return cell;
}
// the trophy case (3472-3496): a trophy for each sector both tracks have left behind (the last one once both have finished it),
// and each track's marker where it is now, in the child's colour
function trophyCase(st, child) {
  const e = st.engine, n = st.nav, finished = e.done && n.done && e.level === LAST_LEVEL && n.level === LAST_LEVEL, cleared = finished ? LAST_LEVEL + 1 : Math.min(e.level, n.level);
  const wrap = el('div', null, `trophies ${accClass(child)}`);
  for (let i = 0; i <= LAST_LEVEL; i++) {
    const done = i < cleared, here = `${i === e.level ? '⚙️' : ''}${i === n.level ? '🧭' : ''}`, now = !done && here !== '', id = LEVEL_IDS[i];
    const tile = el('div', null, `trophy${done ? ' done' : now ? ' cur' : ''}`);
    tile.setAttribute('title', `Sector ${id} — ${LEVEL_NAMES[i]}${done ? ' · cleared by both tracks' : now ? ` · in progress (${here})` : ' · locked'}`);
    tile.append(el('span', done ? '🏆' : now ? here : '🔒', 'trophy-icon'), el('span', id, 'trophy-id'), el('span', done ? ' cleared' : now ? ' in progress' : ' locked', 'sr-only'));
    wrap.append(tile);
  }
  return [wrap, el('p', cleared ? `${cleared} of ${LAST_LEVEL + 1} sectors cleared · ${[...LEVEL_IDS].slice(0, cleared).join(' ')} banked`
    : `no trophies yet — take both tracks through all 5 check points of Sector ${LEVEL_IDS[0]} to win your first`, 'subtle')];
}
// the weekly System Scan (3497-3509), once Engine has left Sector A; whether it is open, and when, is the server's (scanState)
function scanCard(st) {
  if (st.engine.level < 1) return null;
  const s = st.scan || {}, card = el('div', null, 'box c-violet scan-card');
  card.append(el('p', '🧠 SYSTEM SCAN · WEEKLY', 'section-label'), el('p', '25 questions from everything learnt so far. Double loot: ⚡100 + 🏆200.', 'scan-text'));
  if (!s.unlocked) card.append(el('p', `🔒 unlocks after ${st.engine.levelId} 16–20 — clear the first tier of this sector first`, 'scan-state'));
  else if (s.doneThisWeek) card.append(el('p', '✓ done this week — resets Monday', 'scan-state'));
  else if (st.active) card.append(el('p', 'a session is open — finish it from your home screen first', 'scan-state'));
  else if (s.available) card.append(button('START SCAN ▶', () => startRun({ track: 'engine', mode: 'scan' }), 'primary violet'));
  return card;
}
async function mapScreen(track = 'engine') {
  transientView = true; const [st, g] = await Promise.all([api('/learn/state'), api('/game/state')]); gameModel = g;
  drawMap(st, g, track === 'nav' ? 'nav' : 'engine');
}
// the map of one track (a tab switches it, from what was fetched): the route, the strip, the heatmap, the trophies, the scan
function drawMap(st, g, mt) {
  const child = model.child, w = g.wallet, p = st[mt], glyph = lookup(LETTER_ROUTES, p.levelId, LETTER_ROUTES.A), passed = Math.min(p.paper - 1, 100);
  const theme = lookup(MAP_THEMES, w.activeMap, null), cps = theme ? theme.cps : CP_COLORS, veh = gameItem(w.activeVehicle)?.kind === 'vehicle' ? gameItem(w.activeVehicle) : null;
  const box = panel(`🗺 SECTOR ${p.levelId} ROUTE · ${child.nickname.toUpperCase()}`, '', '', 'map');
  onBack = childScreen; applyLook(w);
  box.append(trackTabs(mt, (t) => drawMap(st, g, t), (t) => `${TRACK[t].emoji} ${TRACK[t].name}${st[t].done ? ' ✓' : ''}`));
  const label = `Sector ${p.levelId} route: ${p.bossCleared} of 5 check points cleared, ${passed} of 100 papers passed`;
  if (canDraw()) {
    const map = el('div', null, `tronmap ${accClass(child)}`);
    if (theme) { setVar(map, '--lit', theme.lit); setVar(map, '--grid', theme.grid); }
    map.append(routeSvg(glyph, p, energyFor(glyph, passed, p.bossCleared >= 5), cps, veh, label)); box.append(map);
  } else box.append(el('p', `🗺 ${label}`, 'route-text'));
  const strip = el('div', null, 'cp-strip'); // the check points again in a row (3434-3451), with their paper ranges
  for (let t = 1; t <= 5; t++) {
    const s = cpState(p, t), col = cps[t - 1], cell = el('div', null, s.open ? 'cp-cell open' : 'cp-cell');
    cell.setAttribute('title', `Check point ${t} — papers ${t * 20 - 19}–${t * 20}`);
    if (s.open) { setVar(cell, '--c', col); setVar(cell, '--c-soft', `${col}18`); setVar(cell, '--c-glow', `${col}44`); }
    cell.append(el('span', s.icon, 'cp-icon'), `${t * 20 - 19}–${t * 20}`, el('span', ` ${s.word}`, 'sr-only')); strip.append(cell);
  }
  box.append(strip, el('p', `paper ${Math.min(p.paper, 100)} of 100 · the route is the letter ${p.levelId} · 👑 check point every 20 papers gates the next tier · 🔓 next level`, 'subtle'));
  const heat = el('div', null, 'heat-grid');
  for (let t = 1; t <= 5; t++) heat.append(heatCell((st.heatmap || []).find((c) => c.track === mt && c.level === p.level && c.tier === t), t, p.levelId));
  box.append(el('p', 'FLUENCY HEATMAP', 'log-title map-title'), heat, el('p', '✓ fast + right · ⏳ right but slow · ✗ under 90% right · play more: under 5 answers yet', 'subtle'),
    el('p', '🏆 TROPHY CASE', 'log-title map-title'), ...trophyCase(st, child));
  const scan = scanCard(st); if (scan) box.append(scan);
  const row = el('div', null, 'row-buttons'); row.append(button('Back', childScreen, 'ghost')); box.append(row);
}
// ---- How to (v2 3076-3107) and the Guide (2550-2575): v2's static pages. How to explains the track's sector a line at a
// time, then its tips, and opens by itself before a new sector's first paper; the Guide walks the loot, the shop, the rewards
// and the map in seven slides. Nothing on either is sent anywhere. ----
// Engine's How to for each sector (HOWTO 434-556): the idea, a worked example, the tips and hacks
const HOWTO = [
  { title: 'Addition with carrying', slides: [
    { title: 'The idea', lines: ['Add column by column, starting from the RIGHT (the ones).', 'If a column adds to 10 or more, write the ones digit…', '…and CARRY the 1 to the next column on the left.'] },
    { title: 'Example: 478 + 256', lines: ['Ones: 8 + 6 = 14 → write 4, carry 1', 'Tens: 7 + 5 + 1(carry) = 13 → write 3, carry 1', 'Hundreds: 4 + 2 + 1(carry) = 7 → write 7', 'Answer: 734 ✓'] }],
    tips: ['HACK — Make tens: 9 + 7? Take 1 from the 7 → 10 + 6 = 16. Instant.', "Always whisper the carry: 'fourteen — write 4, carry 1'.", 'Check with estimation: 478+256 ≈ 480+260 = 740. Your answer should be close.'] },
  { title: 'Subtraction with borrowing', slides: [
    { title: 'The idea', lines: ['Subtract column by column from the RIGHT.', 'If the top digit is smaller, BORROW 10 from the left neighbour.', 'The neighbour goes down by 1; your digit goes up by 10.'] },
    { title: 'Example: 402 − 178', lines: ["Ones: 2 − 8 can't do → borrow. But tens is 0!", 'Borrow chain: 4 becomes 3, the 0 becomes 10, then 10 becomes 9 and ones becomes 12.', 'Ones: 12 − 8 = 4 · Tens: 9 − 7 = 2 · Hundreds: 3 − 1 = 2', 'Answer: 224 ✓'] }],
    tips: ['HACK — Count UP instead: 178 → 200 is 22, 200 → 402 is 202. 22+202 = 224.', 'Zeros in the middle mean a borrow chain — slow down there.', 'Check by adding back: 224 + 178 must equal 402.'] },
  { title: 'Multiplication', slides: [
    { title: 'The idea', lines: ['Know your tables 2–9 cold — everything is built on them.', 'Big × small: multiply each digit from the right, carry like addition.', 'Big × big: multiply by ones, then by tens (shift one place left), then ADD.'] },
    { title: 'Example: 46 × 27', lines: ['46 × 7 = 322', '46 × 20 = 920', '322 + 920 = 1,242 ✓'] }],
    tips: ['HACK — ×9 finger trick: fold the finger of the number; fingers left/right are the answer.', 'HACK — ×5 is ×10 halved: 46×5 = 460÷2 = 230.', 'Break numbers up: 46×27 = 46×25 + 46×2 if 25s are easier for you.'] },
  { title: 'Division', slides: [
    { title: 'The idea', lines: ["Division is multiplication backwards: 72 ÷ 8 asks '8 × ? = 72'.", 'For long numbers, work left to right: how many times does it fit? Multiply, subtract, bring down.'] },
    { title: 'Example: 852 ÷ 4', lines: ['8 ÷ 4 = 2 → write 2', '5 ÷ 4 = 1 remainder 1 → write 1, keep the 1', '12 ÷ 4 = 3 → write 3', 'Answer: 213 ✓ (check: 213 × 4 = 852)'] }],
    tips: ['Estimate first: 852 ÷ 4 ≈ 800 ÷ 4 = 200-ish.', 'HACK — Halving: ÷4 is halve twice, ÷8 is halve three times.', 'Always check with the times table going backwards.'] },
  { title: 'Fractions I — same denominator', slides: [
    { title: 'The idea', lines: ['The bottom number (denominator) is the SIZE of the pieces.', 'Same size pieces? Just add or subtract the TOP numbers.', "Then SIMPLIFY: divide top and bottom by the same number until you can't."] },
    { title: 'Example: 5/12 + 1/12', lines: ['Same pieces (twelfths): 5 + 1 = 6 → 6/12', 'Simplify: divide both by 6 → 1/2 ✓'] }],
    tips: ['Type fractions with the ∕ key: 1∕2.', 'HACK — To simplify fast, try dividing by 2, then 3, then 5.', "If top = bottom, the answer is just 1. If the bottom is 1, it's a whole number."] },
  { title: 'Fractions II — different denominators', slides: [
    { title: 'The idea', lines: ["Different size pieces can't be added directly — make them the SAME first.", "Multiply each fraction's top & bottom to reach a common denominator.", 'Multiplying fractions: top × top, bottom × bottom. Dividing: flip the second, then multiply.'] },
    { title: 'Example: 1/3 + 1/4 (butterfly)', lines: ['Cross-multiply: 1×4 = 4 and 1×3 = 3 → tops', 'Multiply bottoms: 3 × 4 = 12', '(4 + 3) / 12 = 7/12 ✓'] }],
    tips: ['HACK — The butterfly method above works for + and − every time.', "HACK — Dividing? 'Keep, Change, Flip': keep first, change ÷ to ×, flip second.", 'Simplify BEFORE multiplying when you can — smaller numbers, fewer mistakes.'] },
];
// what each sector's Navigator papers cover (server/questions/navigator.mjs NAV_TOPICS, as in v2's navigator.js; tests/ui-howto
// holds the two equal)
const NAV_TOPICS = [
  { title: 'Sector A · Navigator', lines: ['Numbers to 1,000 — more than, less than, fill the blank.', 'Easy multiplication in stories: rows of eggs, bags of sweets, legs on animals — 2s, 3s, 5s and 10s. No dividing yet. The counts grow as the papers go on.', 'Halves and quarters first; thirds from paper 41; eighths and tenths from paper 61 — which is bigger, how many make a whole, a quarter of 20.', 'Trip times: same hour first, then across the hour, then 24-hour clock with hours AND minutes from paper 61.', 'Metres and centimetres, kilograms, litres, dollars and cents. Which is heavier, longer, holds more, takes longer — think about the real thing.'] },
  { title: 'Sector B · Navigator', lines: ['Numbers to 10,000. Tables 6, 7, 8, 9 in two-step stories.', 'Two kinds of animal at once — 5 spiders and 7 ants, how many legs altogether?', 'Fractions: equivalent pairs, same top or same bottom — which is bigger, which is smaller? Perimeter of rectangles and squares.', 'Kilometres and millilitres. The 24-hour clock and trips that last hours and minutes. Reading a graph in words.', 'Times as many, how many more, order who is tallest.'] },
  { title: 'Sector C · Navigator', lines: ['Numbers to 100,000. Factors and multiples.', "Decimals: money and measures with a decimal point (there's a . key).", 'Area of squares and rectangles. Angles bigger or smaller than a right angle.', 'Time across the hour. Multi-step money.'] },
  { title: 'Sector D · Navigator', lines: ['Percentages of a number. Ratio. Average.', 'Rate — litres per minute, km per hour. Volume of a box.', 'Fraction of a set. Discounts: more or less than?', 'Area of a triangle.'] },
  { title: 'Sector E · Navigator', lines: ['Speed, distance and time. Simple algebra with n and x.', 'Percentage increase and decrease. Pie charts in words.', "Work backwards from what's left. Circles with π = 22/7.", 'Sharing in a ratio. Dividing fractions.'] },
  { title: 'Sector F · Navigator', lines: ['PSLE heuristics: guess and check, before–after, remainders, supposition.', 'Chickens and cows. Ages in the future. Meeting in the middle.', 'Unitary method, number patterns, averages that change.', 'Read twice. Draw the model in your head. Then answer.'] },
];
// Navigator's How to (2122-2129): how the track works, then what this sector covers
const navHowTo = (lv) => ({ title: NAV_TOPICS[lv].title, slides: [
  { title: 'How Navigator works', lines: ['Read the question. Tap 🔊 any time to hear it read out.', 'Type a number on the keypad and tap Go — or tap the answer button if there are choices.', '3 questions make a paper, 5 papers make a session: 15 questions, about ten minutes.', '100% unlocks the next papers. A 👑 check point every 20 papers, just like Engine.'] },
  { title: "What's in this sector", lines: NAV_TOPICS[lv].lines }],
  tips: ['Read it twice before you answer.', 'Ask: what do I have, what do I need to find?', 'For which-is-heavier questions, picture the real things.', 'Both tracks to 100 to jump to the next sector.'] });
// v2's quick guide (122-159), in v3's words where v3 differs: a parent (not Dad) sets up the rewards and the Rocket, a reward's
// points are held from the request and come back if it is refused, and a child starts wherever the parent set the grid
const GUIDE_SLIDES = [
  { emoji: '⚡🏆', title: 'Two kinds of loot', lines: ['⚡ Grid Coins — spend them in the 🛒 Shop on pets, looks, surprise boxes and vehicles.', '🏆 Reward Points — save them for real-life prizes in the 🎁 Reward Store.', 'You earn both at the same time. Every time.'] },
  { emoji: '📝', title: 'How you earn', lines: ['A session is 5 papers on a timer, one question at a time. ⚙️ Engine: 25 sums. 🧭 Navigator: 15 word problems.', 'Score 100% and you pass: +⚡50 +🏆100, and the next papers unlock. Both tracks to 100 to jump to the next sector.', "Miss one? No loot — same papers again next time. You've got this."] },
  { emoji: '👑🧠', title: 'Double loot', lines: ["Every 20 papers there's a 👑 CHECK POINT: 25 questions from that whole tier (15 on Navigator). Clear it → ×2 loot and the next tier opens.", "From Sector B, once a week, a 🧠 SYSTEM SCAN mixes everything you've learnt → ×2 loot.", 'Practise 3 days in a row → bonus +⚡50 +🏆100. Keep the chain alive!'] },
  { emoji: '🛒', title: 'Spending ⚡ Grid Coins', lines: ['Tap 🛒 Shop on your home screen.', 'Pets ride along with you, outfits dress them, backgrounds and rings change your look.', '🎁 Surprise Box = a random new thing. 🥚 Mystery Egg = hatches after 5 passes.', '🚀 Family Rocket — when your parent builds one, fuel it together. Full tank = a prize you all share.'] },
  { emoji: '🎁', title: 'Cashing in 🏆 Reward Points', lines: ['The 🎁 Reward Store is at the bottom of the Shop — real prizes your parent sets up.', 'Tap REDEEM → it goes to your parent to approve. The points are held while you wait, and come back if the answer is no.', 'Some prizes have a daily limit. Big ones take a while to save for — worth it.'] },
  { emoji: '🗺', title: "See how you're doing", lines: ['🗺 Map — your sector is drawn as its letter: check points, your route so far, trophies for finished sectors.', 'Your home screen shows the papers passed on each check point and your log at the bottom.', 'The heatmap on the map shows which tiers are fast and right, and which need practice.'] },
  { emoji: '🚀', title: 'Ready?', lines: ["You start where your parent set up your grid. A new sector's first paper shows you how its questions work — or tap 📖 How to any time.", 'Your PIN keeps your progress yours. Your parent can reset it if you forget.', "Progress saves to the cloud — any device, same you. Go get 'em!"] },
];
// Engine and Navigator as tabs (v2 3378-3381), the one shown filled in its colour
function trackTabs(current, pick, label = (t) => `${TRACK[t].emoji} ${TRACK[t].name}`) {
  const tabs = el('div', null, 'map-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'track');
  for (const t of ['engine', 'nav']) {
    const on = t === current, tab = button(label(t), () => pick(t), `tiny map-tab ${TRACK[t].c}${on ? ' on' : ''}`);
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(on)); tabs.append(tab);
  }
  return tabs;
}
// A new sector's first paper opens its How to first (v2 2036-2039): paper 1 with nothing logged in that sector on that track, and
// not yet seen on this device — "seen" is kept per child in this device's storage. A device that keeps nothing (a browser that
// blocks site data) goes straight to the paper rather than showing the How to on every start.
const HOWTO_SEEN = 'automathtics.howto.';
function howToDue(childId, t, levelId) {
  try {
    const key = `${HOWTO_SEEN}${childId}`, seen = String(localStorage.getItem(key) || '').split(' ').filter(Boolean);
    if (seen.includes(`${t}:${levelId}`)) return false;
    localStorage.setItem(key, [...seen, `${t}:${levelId}`].join(' ')); return true;
  } catch { return false; }
}
// a track's start button, and Next session or Try again on a result: the How to first when it is due, then the run the server picks
async function beginRun(t, st = null) {
  const s = st || await api('/learn/state'), p = s[t];
  if (!s.active && !p.bossDue && !p.done && p.paper === 1 && !(s.history || []).some((h) => h.track === t && h.level === p.level) && howToDue(model.child.id, t, p.levelId))
    return howToScreen(t, { engine: s.engine.level, nav: s.nav.level }, true);
  return startRun({ track: t });
}
// How to: the slide's lines revealed one per Next step in the violet box, then the tips in the gold one. Opened before a first
// paper it ends in "Got it — start practicing", from the home in Back (with a tab for the other track); ↺ Replay goes round
// again. The card stays put while it reveals: only the box and what is under it change, and the box reads each new line out.
function howToScreen(track, levels, thenStart = false) {
  transientView = true;
  const T = TRACK[track], lv = Math.max(0, Math.min(LAST_LEVEL, Number(levels?.[track]) || 0)), how = track === 'nav' ? navHowTo(lv) : HOWTO[lv];
  const box = panel(`${T.emoji} ${T.name} · SECTOR ${LEVEL_IDS[lv]} · HOW TO`, how.title, '', 'howto');
  onBack = childScreen; applyLook(gameModel?.wallet); root.setAttribute('aria-live', 'off');
  if (!thenStart) box.append(trackTabs(track, (t) => howToScreen(t, levels)));
  const steps = el('div', null, 'box c-violet how-box'), tail = el('div', null, 'how-tail'); steps.setAttribute('aria-live', 'polite');
  let slide = 0, line = 1;
  const show = () => {
    const s = how.slides[slide], atEnd = slide === how.slides.length - 1 && line >= s.lines.length, row = el('div', null, 'row-buttons');
    steps.replaceChildren(el('p', s.title, 'how-title'), ...s.lines.slice(0, line).map((L, i) => el('p', `• ${L}`, i === line - 1 ? 'how-line fade' : 'how-line')));
    // Back is there from the first line on (QA, 12 Sep 2026: opened from the home, Next step was the only way out)
    if (!atEnd) { row.append(button('Next step →', () => { if (line < s.lines.length) line++; else { slide++; line = 1; } show(); }, 'primary'), button('Back', childScreen, 'ghost')); tail.replaceChildren(row); return; }
    const tips = el('div', null, 'box c-gold how-box tips'); tips.append(el('p', '💡 Tips & hacks', 'how-title'), ...how.tips.map((tip) => el('p', `★ ${tip}`, 'how-line')));
    row.append(thenStart ? button('Got it — start practicing ▶', () => startRun({ track }), 'primary') : button('Back', childScreen, 'primary'), button('↺ Replay', () => { slide = 0; line = 1; show(); }, 'ghost'),
      ...(thenStart ? [button('Back', childScreen, 'ghost')] : []));
    tail.replaceChildren(tips, row);
  };
  show(); box.append(steps, tail);
}
// the Guide: seven slides under step dots in the child's colour; Next and ← Back walk them, skip and Let's go go home
function guideScreen() {
  transientView = true;
  const n = GUIDE_SLIDES.length, box = panel(`🎓 QUICK GUIDE · ${model.child.nickname.toUpperCase()}`, '', '', 'w520 guide');
  onBack = childScreen; applyLook(gameModel?.wallet); root.setAttribute('aria-live', 'off');
  const dots = el('div', null, `guide-dots ${accClass(model.child)}`), stage = el('div', null, 'guide-stage'), row = el('div', null, 'row-buttons');
  dots.setAttribute('role', 'img'); stage.setAttribute('aria-live', 'polite');
  const show = (at) => {
    const g = GUIDE_SLIDES[at], last = at === n - 1, slide = el('div', null, 'qin'), face = el('p', g.emoji, 'guide-emoji'), lines = el('div', null, 'box c-violet how-box');
    dots.setAttribute('aria-label', `step ${at + 1} of ${n}`); dots.replaceChildren(...GUIDE_SLIDES.map((_, k) => el('span', null, k === at ? 'dot on' : k < at ? 'dot seen' : 'dot')));
    face.setAttribute('aria-hidden', 'true');
    g.lines.forEach((L, k) => { const p = el('p', `• ${L}`, 'how-line fade'); setVar(p, '--delay', `${(k * 0.12).toFixed(2)}s`); lines.append(p); });
    slide.append(face, el('h2', g.title, 'guide-title'), lines); stage.replaceChildren(slide);
    row.replaceChildren(...(at > 0 ? [button('← Back', () => show(at - 1), 'ghost')] : []), last ? button("Let's go ▶", childScreen, 'primary') : button('Next →', () => show(at + 1), 'primary'),
      ...(last ? [] : [button('skip', childScreen, 'tiny')]));
  };
  show(0); box.append(dots, stage, row);
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
  const box = panel('', '', '', 'play', { play: true }); box.replaceChildren();
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
  row.append(button(s.passed ? 'Next session ▶' : 'Try again ▶', () => beginRun(session.track), 'primary'), button('Home', refresh, 'ghost')); // after a jump, the new sector's How to first (v2 2031-2039)
  box.append(row);
}
// Launch and Scrap cannot be taken back: a launched rocket owes its prize, a scrapped one refunds nobody. Like deleting
// the family (deletionScreen), each opens its own screen first, and nothing is sent until the parent confirms there.
function rocketConfirmScreen(rocket, action) {
  transientView = true;
  const scrap = action === 'scrap';
  const box = panel('PARENT · FAMILY ROCKET', scrap ? 'Scrap this rocket?' : 'Launch this rocket now?', scrap
    ? 'Scrapping ends this rocket for good. The fuel already in it is not refunded to anyone, and the rocket cannot be brought back.'
    : 'Launching ends fuelling now, before the goal is reached, and the family owes the prize. It cannot be undone.', 'w460');
  onBack = parentGameScreen; // its own Back button's step: nothing is launched or scrapped
  box.append(el('p', `${rocket.prize.emoji} ${rocket.prize.name} · ${rocket.totalFuel}/${rocket.goal}`, 'notice'),
    // Back comes first: the second tap of a double-tap on Launch or Scrap lands where the first button is.
    actionRow(button('Back', parentGameScreen, 'ghost'),
      button(scrap ? 'Yes, scrap it' : 'Yes, launch now', async () => { await parentGameMutation('/game/parent/rocket', { action, rocketId: rocket.id }); }, 'primary')));
}
// done: what the screen may forget once the server has taken the change (a draft it has just published)
async function parentGameMutation(path, payload, done = null) {
  try { await api(path, payload); done?.(); await parentGameScreen(); }
  catch (error) {
    if (error.code !== 'REAUTHENTICATE') throw error;
    reauthenticate(() => { parentGameScreen(); note('Parent verified. Repeat the action to confirm it.'); });
  }
}
// The Reward Store's edits and the rocket's build form outlive the game screen's repaints and a parent verification, until they are
// published or discarded or the page reloads — and only for the account and family that typed them.
let gameDrafts = null;
function gameDraft() {
  const key = `${model?.parent?.uid || ''}:${model?.family?.id || ''}`;
  if (gameDrafts?.key !== key) gameDrafts = { key, rewards: null, rocket: null };
  return gameDrafts;
}
// a number field with its short label in front (v2's "goal ⚡", "min each ⚡")
function inlineNum(words, input) { const l = el('label', null, 'inline-num'); l.append(el('span', words), input); return l; }
// Game & progress as v2's admin panel (2628-2830): the family's time zone, each child's time control and scan focus, one list of the
// requests waiting, the Reward Store editor, the Family Rocket, coins and each child's log. Every change goes through
// parentGameMutation, which asks for a fresh parent sign-in whenever the server wants one (game.mjs parent(…, true)).
async function parentGameScreen() {
  transientView = true; const g = await api('/game/parent');
  const box = panel('PARENT · GAME & PROGRESS', 'Learning controls and family rewards', 'Only the parent session can change pace, rewards, credits or the Family Rocket.', 'admin');
  onBack = refresh;
  // each child with the colour and ring /me gives it (S1): the game state names children, it does not dress them
  const meta = (id) => model?.family?.children?.find((c) => c.id === id) || null;
  const kids = g.children.map((row, i) => ({ ...row, kid: { ...row.child, accent: meta(row.child.id)?.accent ?? i }, look: { ring: meta(row.child.id)?.appearance?.ring || null } }));
  // 🌐 the family's time zone (v3's own; v2 had none)
  const zone = adminSection('🌐 Family time zone', 'c-cyan'), zoneRow = el('div', null, 'row');
  const tz = adminInput('text', 'Family time zone', { value: g.timeZone, maxLength: 64 }, 'grow');
  zoneRow.append(tz, button('Save time zone', async () => { await parentGameMutation('/game/parent/settings', { timeZone: tz.value }); }, 'tiny'));
  zone.append(zoneRow, el('p', 'A time zone name, for example Asia/Jakarta or Asia/Singapore.', 'subtle')); box.append(zone);
  // ⏱ Time control (2628-2655): a card per child in the child's colour
  const time = adminSection('⏱ Time control', 'c-magenta');
  time.append(el('p', '100% is the built-in time per question: at 70% a 50-second question gets 35 seconds, at 150% it gets 75. No question gets under 5 seconds.', 'admin-intro'), ...kids.map(paceCard));
  box.append(time);
  // ⏳ Approvals (2768-2784): every request still waiting, from every child, in one list; a refusal refunds the points held
  const approvals = adminSection('⏳ Approvals', 'c-mint'); let waiting = 0;
  for (const row of kids) for (const r of row.wallet.redemptions.filter((x) => x.status === 'pending')) {
    const line = el('div', null, 'row dashed wait-row'), acts = el('div', null, 'row-acts'); waiting++;
    acts.append(button('Approve', async () => { await parentGameMutation('/game/parent/redemption', { childId: row.child.id, redemptionId: r.id, decision: 'approve' }); }, 'tiny c-mint'),
      button('Reject + refund', async () => { await parentGameMutation('/game/parent/redemption', { childId: row.child.id, redemptionId: r.id, decision: 'reject' }); }, 'tiny c-red'));
    line.append(avatarBadge(row.kid, null, 22), el('span', `${row.child.nickname}: ${r.emoji} ${r.name}`, 'row-words'), el('span', `🏆${r.cost}`, 'row-cost'), acts); approvals.append(line);
  }
  if (!waiting) approvals.append(el('p', 'no pending redemptions', 'subtle'));
  box.append(approvals, rewardEditor(g, kids, gameDraft()), rocketSection(g, kids, gameDraft()), coinsSection(kids));
  // 📄 Logs: each child's last sessions, read-only, drawn as the child's own log (homeLog)
  const logs = adminSection('📄 Logs', 'c-cyan');
  for (const row of kids) logs.append(homeLog(row.child, row.history) || el('p', `${row.child.nickname}: no sessions yet.`, 'subtle'));
  const foot = actionRow(button('Back to family', refresh, 'ghost')); foot.className = 'row-buttons admin-foot';
  box.append(logs, foot);
}
// a child's time control (2638-2653): v2's slider over v3's 10-200%, the value and an example moving with it, Set pace to send it;
// under it the System Scan focus, the child's other learning setting (email-v1)
function paceCard(row) {
  const card = el('div', null, `pace-card ${accClass(row.kid)}`), head = el('div', null, 'pace-head'), val = el('span', `${row.pacePercent}%`, 'pace-val');
  head.append(avatarBadge(row.kid, row.look, 40), el('b', row.child.nickname, 'pace-name'), val);
  const label = el('label', null, 'pace-label'), range = el('input', null, 'pace-range'), example = el('p', null, 'pace-example');
  Object.assign(range, { type: 'range', min: 10, max: 200, step: 1, value: String(row.pacePercent) }); // step 1: a pace an email button set (say 73) stays as it is
  const show = () => { const v = Number(range.value) || row.pacePercent; val.textContent = `${v}%`; example.replaceChildren('example: a 50s question gets ', el('b', `${Math.max(5, Math.round((50 * v) / 100))}s`)); };
  range.addEventListener('input', show); show();
  label.append(el('span', 'Question-time pace % (10–200)'), range);
  const acts = el('div', null, 'pace-acts');
  acts.append(button('Set pace', async () => { await parentGameMutation('/game/parent/settings', { childId: row.child.id, pacePercent: Number(range.value) }); }, 'tiny acc-tint'),
    button(row.scanFocus ? 'Switch scan focus off' : 'Focus System Scan on weak spots', async () => { await parentGameMutation('/game/parent/settings', { childId: row.child.id, scanFocus: !row.scanFocus }); }, 'tiny c-violet'));
  card.append(head, el('p', `⚙️ ${row.engine.levelId} ${Math.min(100, row.engine.paper - 1)}/100 · 🧭 ${row.nav.levelId} ${Math.min(100, row.nav.paper - 1)}/100`, 'pace-meta'), label, example,
    el('p', row.scanFocus ? '🧠 System Scan focus is on: about 75% on the styles this child gets wrong or slow, 25% recap.' : '🧠 System Scan: the normal mix of this sector and earlier ones.', 'pace-note'), acts);
  return card;
}
// 🎁 the Reward Store editor (2732-2766): each reward with its emoji, cost, hidden-until-affordable and daily limit, who may ask for it,
// and ✕; a new one from the dashed row. Edits stay in the draft until Save rewards publishes the whole list, which the server checks.
function rewardEditor(g, kids, d) {
  const sec = adminSection('🎁 Reward Store', 'c-gold'), list = el('div', null, 'rw-list'), saveRow = el('div', null, 'rw-save'), all = kids.map((k) => k.child.id);
  // a reward ticked for nobody is offered to every child (game.mjs state): the editor shows it ticked for everyone
  const shape = (r) => ({ id: r.id, emoji: r.emoji, name: r.name, cost: r.cost, hidden: r.hidden === true, cap: Number(r.cap) || 0, childIds: r.childIds?.length ? all.filter((id) => r.childIds.includes(id)) : [...all] });
  const published = JSON.stringify(g.rewards.map(shape));
  d.rewards ||= g.rewards.map(shape);
  const save = button('Save rewards', async () => {
    if (d.rewards.some((r) => !r.childIds.length)) { note('Tick at least one explorer for each reward, or delete it.'); return; }
    await parentGameMutation('/game/parent/rewards', { rewards: d.rewards.map((r) => ({ ...r, childIds: [...r.childIds] })) }, () => { d.rewards = null; });
  }, 'primary gold');
  const discard = button('Discard changes', () => { d.rewards = null; return parentGameScreen(); }, 'tiny c-dim');
  const draw = () => {
    list.replaceChildren(...d.rewards.map(rewardRow), ...(d.rewards.length ? [] : [el('p', 'No rewards yet: add the first one below.', 'subtle')]));
    const dirty = JSON.stringify(d.rewards) !== published; save.disabled = !dirty;
    saveRow.replaceChildren(save, ...(dirty ? [discard, el('span', 'Unsaved changes: Save rewards publishes them to the Reward Store.', 'warn')] : []));
  };
  function rewardRow(r) {
    const row = el('div', null, 'row rw-row'), face = el('span', r.emoji, 'rw-emoji'), ticks = el('span', null, 'rw-ticks'); face.setAttribute('aria-hidden', 'true');
    row.append(face, el('span', r.name, 'rw-name'), el('span', `🏆${r.cost}`, 'rw-cost'), ...(r.hidden ? [el('span', 'hidden until affordable', 'rw-tag')] : []), ...(r.cap > 0 ? [el('span', `max ${r.cap}/day`, 'rw-tag')] : []));
    for (const k of kids) {
      const on = r.childIds.includes(k.child.id), tick = el('label', null, `rw-tick ${accClass(k.kid)}${on ? ' on' : ''}`), t = el('input'); t.type = 'checkbox'; t.checked = on;
      t.addEventListener('change', () => { r.childIds = all.filter((id) => (id === k.child.id ? t.checked : r.childIds.includes(id))); draw(); });
      tick.append(t, el('span', k.child.nickname)); ticks.append(tick);
    }
    const del = button('✕', () => { d.rewards = d.rewards.filter((x) => x !== r); draw(); }, 'tiny c-red'); del.setAttribute('aria-label', `Delete ${r.name}`);
    row.append(ticks, del); return row;
  }
  const add = el('div', null, 'row dashed rw-add');
  const emoji = adminInput('text', 'reward emoji', { value: '🎁', maxLength: 12 }, 'emoji-in'), name = adminInput('text', 'reward name', { placeholder: 'reward name', maxLength: 40 }, 'grow');
  const cost = adminInput('text', 'cost in reward points', { value: '100', inputMode: 'numeric', maxLength: 6 }, 'num-in'), cap = adminInput('text', 'daily limit, 0 for none', { value: '0', inputMode: 'numeric', maxLength: 2 }, 'cap-in');
  cap.setAttribute('title', 'max redemptions a day (0 = no limit)');
  const hideWrap = el('label', null, 'rw-check'), hide = el('input'); hide.type = 'checkbox'; hideWrap.append(hide, el('span', 'hide til afford'));
  add.append(emoji, name, inlineNum('🏆', cost), hideWrap, inlineNum('max/day', cap), button('+ ADD', () => {
    const n = name.value.trim(), c = Number(cost.value), k = Number(cap.value || 0);
    if (!n) { note('Give the reward a name first.'); return; }
    if (!Number.isInteger(c) || c < 1 || c > 100000) { note('A reward costs 1 to 100000 🏆.'); return; }
    if (!Number.isInteger(k) || k < 0 || k > 20) { note('The daily limit is 0 (none) to 20.'); return; }
    if (d.rewards.length >= 30) { note('The Reward Store holds up to 30 rewards.'); return; }
    d.rewards.push({ id: `rw-${crypto.randomUUID()}`, emoji: emoji.value.trim() || '🎁', name: n, cost: c, hidden: hide.checked === true, cap: k, childIds: [...all] });
    name.value = ''; emoji.value = '🎁'; cost.value = '100'; cap.value = '0'; hide.checked = false; draw();
  }, 'tiny c-mint'));
  sec.append(list, add, el('p', '100 🏆 is one passed session. Tick who may ask for each reward; a hidden one shows once the child can afford it.', 'subtle'), saveRow);
  draw(); return sec;
}
// 🚀 the Family Rocket (2786-2830) in v2's featured box: fuelling, launched, or the build form — the prize, the fuel with v2's goal
// and minimum for each (2809), and the crew, which only children with a seat may join (game.mjs rocket)
function rocketSection(g, kids, d) {
  const r = g.rocket, sec = el('section', null, `admin-sec feature-box${r?.status === 'launched' ? ' launched' : ''}`);
  const nick = (id) => kids.find((k) => k.child.id === id)?.child.nickname || '—', day = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleDateString() : '—');
  const draw = (...body) => sec.replaceChildren(el('h2', '🚀 Family Rocket', 'log-title'), ...body);
  const past = (g.rocketHistory || []).slice(-3).map((h) => `${h?.prize?.emoji || '🚀'} ${h?.prize?.name || 'a rocket'} (${h?.status === 'claimed' ? `launched ${day(h.launchedAt)}` : 'scrapped'})`);
  const history = past.length ? [el('p', `past rockets: ${past.join(' · ')}`, 'subtle')] : [];
  if (r) {
    const sym = r.currency === 'rp' ? '🏆' : '⚡', launched = r.status === 'launched', tank = el('div', null, 'rocket-track'), acts = el('div', null, 'row-acts');
    setVar(tank, '--w', `${Math.min(100, Math.round((r.totalFuel / (r.goal || 1)) * 100))}%`); tank.setAttribute('aria-label', `rocket fuel ${r.totalFuel} of ${r.goal}`); tank.append(el('span', null, 'rocket-fill'));
    if (launched) acts.append(button('Prize delivered · clear', async () => { await parentGameMutation('/game/parent/rocket', { action: 'claim', rocketId: r.id }); }, 'tiny c-mint'));
    else acts.append(button('Launch now', () => rocketConfirmScreen(r, 'launch'), 'tiny c-gold'), button('Scrap (no refund)', () => rocketConfirmScreen(r, 'scrap'), 'tiny c-red'));
    draw(el('p', launched ? `🎉 LAUNCHED ${day(r.launchedAt)} — ${r.prize.emoji} ${r.prize.name} is owed to the crew` : `${r.prize.emoji} ${r.prize.name} · goal ${sym}${r.goal}${r.minEach ? ` · at least ${sym}${r.minEach} each` : ''} · since ${day(r.createdAt)}`, launched ? 'rk-line lift' : 'rk-line'),
      tank, el('p', `fuel ${sym}${r.totalFuel} / ${r.goal} — ${(r.crewChildIds || []).map((id) => `${nick(id)} ${sym}${r.fuel?.[id] || 0}`).join(' · ')}`, 'rk-fuel'), acts, ...history);
    return sec;
  }
  const seated = kids.filter((k) => k.child.status === 'active');
  const f = (d.rocket ||= { emoji: '🎬', name: '', currency: 'gc', goal: '2000', minEach: '300', crew: seated.map((k) => k.child.id) });
  const build = () => {
    const sym = f.currency === 'rp' ? '🏆' : '⚡', form = el('div', null, 'rk-form'), crew = el('div', null, 'rk-crew');
    const emoji = adminInput('text', 'prize emoji', { value: f.emoji, maxLength: 12 }, 'emoji-in'), name = adminInput('text', 'prize name', { value: f.name, placeholder: 'prize, e.g. Movie night', maxLength: 50 }, 'grow');
    const fuel = el('select', null, 'admin-inp'); fuel.setAttribute('aria-label', 'fuel type');
    for (const [v, words] of [['gc', '⚡ grid coins'], ['rp', '🏆 reward points']]) { const o = el('option', words); o.value = v; fuel.append(o); }
    fuel.value = f.currency;
    const goal = adminInput('text', 'goal', { value: f.goal, inputMode: 'numeric', maxLength: 7 }, 'num-in'), min = adminInput('text', 'minimum each, 0 for none', { value: f.minEach, inputMode: 'numeric', maxLength: 7 }, 'num-in');
    const keep = () => { f.emoji = emoji.value; f.name = name.value; f.goal = goal.value; f.minEach = min.value; };
    for (const i of [emoji, name, goal, min]) i.addEventListener('input', keep);
    fuel.addEventListener('change', () => { keep(); f.currency = fuel.value === 'rp' ? 'rp' : 'gc'; [f.goal, f.minEach] = f.currency === 'rp' ? ['4000', '600'] : ['2000', '300']; build(); });
    form.append(emoji, name, fuel, inlineNum(`goal ${sym}`, goal), inlineNum(`min each ${sym}`, min));
    crew.append(el('span', 'crew:', 'rk-crew-label'));
    for (const k of seated) {
      const on = f.crew.includes(k.child.id), tick = el('label', null, `rw-tick ${accClass(k.kid)}${on ? ' on' : ''}`), t = el('input'); t.type = 'checkbox'; t.checked = on;
      t.addEventListener('change', () => { keep(); f.crew = seated.map((x) => x.child.id).filter((id) => (id === k.child.id ? t.checked : f.crew.includes(id))); build(); });
      tick.append(t, el('span', k.child.nickname)); crew.append(tick);
    }
    if (seated.length < kids.length) crew.append(el('span', 'only an explorer with a seat can join the crew', 'rw-tag'));
    draw(el('p', 'One shared goal the explorers fuel from their own ⚡ or 🏆, on every home screen. When the tank is full, and everyone on the crew has put in the minimum, it launches for all of them and the prize is theirs. Fuel is spent, never refunded.', 'subtle rk-about'),
      form, crew, actionRow(button('Build rocket', async () => {
        keep(); const goalN = Number(f.goal), minN = Number(f.minEach || 0), crewIds = seated.map((k) => k.child.id).filter((id) => f.crew.includes(id));
        if (!f.name.trim()) { note('Name the prize first.'); return; }
        if (!Number.isInteger(goalN) || goalN < 50 || goalN > 1000000) { note('The goal is 50 to 1000000.'); return; }
        if (!Number.isInteger(minN) || minN < 0 || minN > goalN) { note('The minimum each is 0 up to the goal.'); return; }
        if (!crewIds.length) { note('Tick at least one explorer for the crew.'); return; }
        await parentGameMutation('/game/parent/rocket', { action: 'build', prize: { emoji: f.emoji.trim() || '🚀', name: f.name.trim() }, currency: f.currency, goal: goalN, minEach: minN, crewChildIds: crewIds }, () => { d.rocket = null; });
      }, 'tiny c-violet')), ...history);
  };
  build(); return sec;
}
// ✍️ Coins (v2's manual update, 2679-2718, as far as v3's server allows it: coins, never a pass): a quick +⚡50 for each child, and any
// amount added or taken away in either currency with the reason the child's ledger keeps (game.mjs adjust)
function coinsSection(kids) {
  const sec = adminSection('✍️ Coins', 'c-mint');
  for (const row of kids) {
    const line = el('div', null, `row ${accClass(row.kid)}`);
    line.append(avatarBadge(row.kid, row.look, 22), el('b', row.child.nickname, 'row-name'), el('span', `⚡${row.wallet.gc} · 🏆${row.wallet.rp}`, 'row-cost row-words'),
      button('+⚡50 credit', async () => { await parentGameMutation('/game/parent/adjust', { childId: row.child.id, currency: 'gc', amount: 50, reason: 'Parent bonus credit', operationId: crypto.randomUUID() }); }, 'tiny c-mint'));
    sec.append(line);
  }
  if (!kids.length) return sec;
  const op = crypto.randomUUID(), form = el('div', null, 'row dashed adj-row'), pick = (aria, pairs) => {
    const s = el('select', null, 'admin-inp'); s.setAttribute('aria-label', aria);
    for (const [v, words] of pairs) { const o = el('option', words); o.value = v; s.append(o); }
    return s;
  };
  const who = pick('explorer', kids.map((k) => [k.child.id, k.child.nickname])), way = pick('add or take away', [['add', '+ add'], ['take', '− take away']]), cur = pick('currency', [['gc', '⚡ grid coins'], ['rp', '🏆 reward points']]);
  const amount = adminInput('text', 'amount', { placeholder: 'amount', inputMode: 'numeric', maxLength: 5 }, 'num-in'), reason = adminInput('text', 'reason', { placeholder: 'reason, e.g. helped with the shopping', maxLength: 120 }, 'grow');
  form.append(who, way, amount, cur, reason, button('Apply', async () => {
    const n = Number(amount.value), why = reason.value.trim();
    if (!Number.isInteger(n) || n < 1 || n > 10000) { note('The amount is 1 to 10000.'); return; }
    if (why.length < 3) { note('Give a reason of three characters or more: the ledger keeps it.'); return; }
    await parentGameMutation('/game/parent/adjust', { childId: who.value, currency: cur.value === 'rp' ? 'rp' : 'gc', amount: way.value === 'take' ? -n : n, reason: why, operationId: op });
  }, 'tiny c-mint'));
  sec.append(form, el('p', 'A balance never goes below zero. Each change is kept in the child’s ledger with its reason.', 'subtle'));
  return sec;
}

channel?.addEventListener('message', () => {
  reauthEpoch++; // Cancel old drafts even if a request is currently in flight.
  if (working) { sessionRefreshPending = true; return; }
  run(async () => { if (authModule) await authModule.clear(); await refresh(); });
});
// A tab back in view asks /api/health about the release and refreshes nothing: a refresh bootstraps, and a bootstrap could hand out
// a cookie over the one another tab has just rotated (a hand-over, a PIN, Switch child, a sign-in). A change of session reaches this
// tab by the tabs' own signal above, sent once the change is done (review of 12 Sep 2026).
document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? checkRelease() : undefined));
await run(refresh);
setInterval(function releaseTick() { return document.visibilityState === 'visible' ? checkRelease() : undefined; }, RELEASE_CHECK_MS); // Update now: every five minutes in view
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
// email-v1: a button in the weekly email carries its token in the fragment (#email=…), which the browser never sends to a server,
// so no request log holds it. The address is tidied at once, so a reload or a bookmark made now does not reopen it; the panel
// asks before anything changes (emailScreen).
const fragment = typeof location === 'object' && location?.hash ? new URLSearchParams(String(location.hash).replace(/^#/, '')) : null;
if (fragment?.get('email')) {
  const token = fragment.get('email');
  if (typeof history === 'object' && history?.replaceState) history.replaceState(null, '', location.pathname);
  await run(() => emailScreen(token));
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
