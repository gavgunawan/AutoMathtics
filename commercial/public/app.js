const root = document.querySelector('#app'), status = document.querySelector('#message');
const icons = { fox: '\u{1f98a}', panda: '\u{1f43c}', tiger: '\u{1f42f}', wolf: '\u{1f43a}', robot: '\u{1f916}', rocket: '\u{1f680}' };
let csrf = '', model = null, authModule = null, working = false, transientView = false;
let reauthEpoch = 0, sessionRefreshPending = false, keepSdkSession = false; // keepSdkSession: a change of mobile needs the provider's fresh sign-in kept open
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
  FAMILY_DELETED: 'This family has been deleted.', NO_DELETION_PENDING: 'No deletion is scheduled.', FAMILY_STILL_EXISTS: 'Delete the family first; the sign-in account can go after that.', PLACEMENT_PENDING: 'The placement test comes first.', PLACEMENT_NOT_PENDING: 'There is no placement test to take.', ALREADY_STARTED: 'This child has already started playing; the starting point can no longer be changed.', INVALID_START: 'Choose a year level for that starting option.', RECOVERY_NOT_FOUND: 'No recovery request exists for that account.', ACCOUNT_DELETED: 'This sign-in account has been deleted.', PAYMENT_PENDING: 'A plan change is still waiting for its payment. Complete that payment, or wait for it to lapse, before changing the plan again.', RECOVERY_NOT_PENDING: 'That recovery request is no longer pending.', IDENTITY_UNAVAILABLE: 'The sign-in service did not answer. Try again in a moment.',
  MANUAL_GRANT_ACTIVE: 'This family already has pilot access, so the free trial is not needed.', CHECKOUT_REQUIRED: 'Choose a plan to subscribe first; a trial cannot be changed.', PLAN_CHANGE_NOT_AUTHORIZED: 'That payment does not match the plan on record.', RENEWAL_REQUIRED: 'The renewal payment comes first; upgrade after it goes through.', CHANGE_IN_PROGRESS: 'A plan change is already in progress. Try again in a moment.', USE_PLAN_CHANGE: 'Your family is subscribed: change the plan from the subscription controls.', SUBSCRIPTION_CHANGED: 'The subscription changed while this was in progress. Refresh and try again.', LEDGER_REPLAYED: 'That was already done. Refresh to see the result.',
  SEATS_CANNOT_REMOVE: 'Seats can be added here, not taken away.', INVALID_PLAN: 'That plan is not available.', SELECT_CHILDREN_FOR_DOWNGRADE: 'Not enough seats for that many children.', IDEMPOTENCY_CONFLICT: 'That request was already made differently. Refresh and try again.',
  INSUFFICIENT_GRID_COINS: 'Not enough Grid Coins yet.', INSUFFICIENT_REWARD_POINTS: 'Not enough Reward Points yet.',
  ITEM_ALREADY_OWNED: 'You already own that item.', SHIELD_LIMIT: 'You can hold at most two streak shields.',
  EGG_ALREADY_WARMING: 'Your Mystery Egg is already warming.', REWARD_DAILY_LIMIT: 'That reward has reached its daily limit.',
  SCAN_ALREADY_DONE: 'System Scan is already complete this week.', SCAN_LOCKED: 'System Scan unlocks in Sector B after the first tier.',
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
  const box = el('section', null, 'panel'); box.setAttribute('data-deck', model?.role === 'child' ? 'GRID // ONLINE' : 'MISSION CONTROL // ONLINE'); // the corner tag every deck carries
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
  catch (error) {
    if (error.code === 'SIGN_IN_REQUIRED' || error.code === 'SESSION_REVOKED') { model = null; signInScreen(); return; }
    // a child whose seat, PIN or subscription changed under the device goes back to the launch pad — never a dead screen (Stage 4 review, third round)
    if (['CHILD_INACTIVE', 'CHILD_SESSION_REVOKED', 'SUBSCRIPTION_INACTIVE'].includes(error.code)) {
      try { await api('/session/select', {}); model = await api('/me'); csrf = model.csrf; await renderModel(); }
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
      await api('/auth/session', { idToken: result.idToken });
    }
    finally { if (!keepSdkSession) await (await auth()).clear(); result.idToken = ''; }
    await refresh(); channel?.postMessage('changed');
    if (afterReady) await afterReady();
    return;
  }
  if (result.stage === 'signin') { signInScreen(false, afterReady, Boolean(afterReady)); note(result.notice); return; }
  if (result.stage === 'verify') {
    const box = panel('STEP 1 OF 3 · EMAIL', 'Check your inbox.', 'Open the verification email, then come back here. Nothing about your family exists until this is done.');
    box.append(rail(1), button('I have verified my email', async () => authStep(await (await auth()).checkEmail(), afterReady), 'primary'),
      button('Resend verification email', async () => { await (await auth()).resendEmail(); note('Verification email requested.'); }, 'ghost'));
    return;
  }
  const enrolling = result.stage === 'enroll';
  const box = panel(enrolling ? 'STEP 1 OF 3 · MOBILE' : 'SECOND CHECK', enrolling ? 'Protect the command deck.' : 'Your second security check',
    enrolling ? 'Verify your own mobile number. Children never need a phone or an email address.' : `Send a code to ${result.phone || 'your verified mobile'} to finish signing in.`);
  if (enrolling) box.append(rail(1));
  const phone = field('Mobile number, including country code', 'tel', { placeholder: '+62...', autocomplete: 'tel' });
  const consent = el('input'); consent.type = 'checkbox';
  const consentLabel = el('label', null, 'check');
  consentLabel.append(consent, el('span', 'I agree to receive a verification SMS. Google processes this number for authentication and abuse prevention; carrier charges may apply.'));
  if (enrolling) box.append(phone.wrap, consentLabel);
  const otp = field('SMS verification code', 'text', { inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6, autocomplete: 'one-time-code' });
  box.append(button('Send verification code', async () => { await (await auth()).sendCode(phone.input.value, consent.checked); note('Code sent. Enter it below.'); }, 'ghost'), otp.wrap,
    button('Verify code', async () => authStep(await (await auth()).confirmCode(otp.input.value), afterReady), 'primary'));
  if (!enrolling && result.email) box.append(button('I can\u2019t receive the code', () => recoveryScreen(result.email), 'text-button')); // Stage 4.4
}
// Stage 4.4: the lost-phone ceremony (RECOVERY.md). No session exists here; the server answers the same for any email.
function recoveryScreen(email) {
  reauthEpoch++; model = null;
  const box = panel('ACCOUNT RECOVERY', 'Lost your phone?', 'Recovery takes seven days and needs your email inbox. Nobody can shorten it. Your family and children stay exactly as they are.');
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
      (signup ? 'Create your adult account first. Then build a private grid for your explorers.' : 'One secure parent account. A personal learning grid for every child.'));
  if (!reauth) box.append(rail(1));
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
    reauthEpoch++; keepSdkSession = false;
    if (authModule) await authModule.clear();
    await refresh(); note('Verification cancelled. The unfinished action was discarded.');
  }, 'ghost'));
  if (!reauth) box.append(button(signup ? 'Already registered? Sign in' : 'New here? Create a parent account', () => signInScreen(!signup), 'ghost'));
  if (!signup && !reauth) box.append(button('Forgot password?', async () => { if (!email.input.checkValidity()) { email.input.reportValidity(); return; }
    await (await auth()).resetPassword(email.input.value); note('If this email can receive a reset link, one has been requested. Mobile verification is still required.'); }, 'text-button'));
  box.append(el('p', 'EMAIL VERIFIED  //  MOBILE VERIFIED  //  FAMILY-ONLY ACCESS', 'trust'));
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
function cards(children, action) {
  const grid = el('div', null, 'player-grid');
  for (const child of children) {
    const card = el(action ? 'button' : 'div', null, 'player-card');
    if (action) { card.type = 'button'; card.onclick = () => run(() => action(child)); }
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
  const box = panel('CHANGE PLAN', `${plan.name}: ${plan.seats} child slots`, choose ? `Choose who keeps a seat from the next renewal (up to ${plan.seats}). The others keep all their progress and can be given a seat again later.` : 'The change takes effect at the next renewal. Nobody loses a seat before then.');
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
  const box = panel('DELETE FAMILY', family.label, 'The children\u2019s profiles, progress, coins and this family\u2019s settings will be removed after 14 days. Payment records and the security audit trail are kept as required. A used free trial stays used. Your sign-in account itself is separate and is not deleted here.');
  const op = crypto.randomUUID();
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
      button('It was me', async () => { await api('/auth/recovery/ack', {}); await refresh(); }, 'ghost'));
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
    const box = panel('CHANGE MOBILE', 'Your new number.', 'A code goes to the new number. The old one stops working for sign-in the moment the new one is verified.');
    const phone = field('New mobile number, including country code', 'tel', { placeholder: '+62...', autocomplete: 'tel' });
    const consent = el('input'); consent.type = 'checkbox'; const consentLabel = el('label', null, 'check');
    consentLabel.append(consent, el('span', 'I agree to receive a verification SMS on this number. Google processes it for authentication and abuse prevention; carrier charges may apply.'));
    const otp = field('SMS verification code', 'text', { inputMode: 'numeric', pattern: '[0-9]{6}', maxLength: 6, autocomplete: 'one-time-code' });
    box.append(phone.wrap, consentLabel,
      button('Send code to the new number', async () => { await (await auth()).changeMobileSend(phone.input.value, consent.checked); note('Code sent to the new number. Enter it below.'); }, 'ghost'), otp.wrap,
      button('Verify new number', async () => {
        const r = await (await auth()).changeMobileConfirm(otp.input.value); keepSdkSession = false;
        await api('/auth/logout', {}); channel?.postMessage('changed'); model = null; signInScreen(); note(r.notice); // the next sign-in carries the new factor
      }, 'primary'),
      button('Cancel', async () => { keepSdkSession = false; if (authModule) await authModule.clear(); await refresh(); }, 'ghost'));
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
  const box = panel('NEW CHILD PROFILE', 'Meet your next explorer.', 'A nickname and an icon are all the grid needs. Age and year level help us place the explorer. No child email, phone number, photo or full birth date \u2014 ever.');
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
  const box = panel('LAUNCH POINT', child.nickname, 'Only possible before the child has played anything. A recent parent sign-in is required.');
  const start = startChooser({ yearLevel: child.yearLevel, start: child.start });
  box.append(start.wrap, start.options, button('Save starting point', async () => {
    try { await api(`/children/${child.id}/start`, { start: start.value(), yearLevel: Number(start.year.value) }); note('Starting point saved.'); await refresh(); }
    catch (error) { if (error.code === 'ALREADY_STARTED') { note(messages.ALREADY_STARTED); return; } throw error; }
  }, 'primary'), button('Back', refresh, 'ghost'));
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
  const box = panel('LAUNCH PAD · PARENT ACCESS LOCKED', 'Who is on a mission today?', 'Pick your explorer and enter your PIN. Parent settings stay locked until a parent signs in again.');
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
// ---- secure learning + migrated v2 game layer ----
const TRACK = { engine: { name: 'ENGINE', emoji: '⚙️' }, nav: { name: 'NAVIGATOR', emoji: '🧭' } };
const EQUIP_SLOT = { pet: 'activePet', fx: 'activeFx', snd: 'activeSnd', bg: 'activeBg', ring: 'ring', outfit: 'activeOutfit', shout: 'activeShout', timer: 'activeTimer', title: 'activeTitle', namefx: 'activeNameFx', map: 'activeMap', vehicle: 'activeVehicle', base: 'activeBase' };
const SHOUTS = { shout_kapow: ['POW!', 'KAPOW!', 'BOOM!!', 'KA-BLAMMO!!!'], shout_turbo: ['TURBO!', 'OVERDRIVE!', 'HYPERDRIVE!', 'WARP SPEED!!'], shout_robot: ['NICE.HUMAN', 'IMPRESSIVE', 'MAXIMUM.POWER', 'LEGENDARY.EXE'], shout_dino: ['RAWR!', 'MEGA RAWR!', 'ULTRA RAWR!', 'T-REX MODE!!'] };
const FX = { fx_confetti: '🎊', fx_lightning: '🌩️', fx_goldrain: '💰' };
let timer = null, gameModel = null, playStreak = 0, audioCtx = null;
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
function gameSound(kind) {
  const pack = gameModel?.wallet?.activeSnd; if (!pack) return;
  try { const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return; audioCtx ||= new Ctx();
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain(), now = audioCtx.currentTime; osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = pack === 'snd_retro' ? 'square' : 'sine'; const good = kind === 'correct' || kind === 'buy';
    osc.frequency.setValueAtTime(good ? (pack === 'snd_retro' ? 660 : 880) : 190, now); if (pack === 'snd_space') osc.frequency.exponentialRampToValueAtTime(good ? 1320 : 120, now + .12);
    gain.gain.setValueAtTime(.04, now); gain.gain.exponentialRampToValueAtTime(.0001, now + .15); osc.start(now); osc.stop(now + .16);
  } catch {}
}
const runLabel = (s) => s.mode === 'boss' ? `👑 Check point T${s.tierEnd / 20}` : s.mode === 'scan' ? '🧠 SYSTEM SCAN · ×2 LOOT' : s.mode === 'placement' ? '🎯 Placement test' : s.mode === 'practice' ? 'Practice run' : `Papers ${s.startPaper}–${s.startPaper + 4}`;
const gameItem = (id) => gameModel?.catalog?.find((x) => x.id === id) || null;
function gameHero(box, child, g) {
  const w = g.wallet, pet = gameItem(w.activePet), outfit = gameItem(w.activeOutfit), title = gameItem(w.activeTitle), vehicle = gameItem(w.activeVehicle);
  const hero = el('div', null, 'game-hero');
  const petWrap = el('span', null, `game-pet-wrap ${w.ring || ''}`); petWrap.append(el('span', pet?.emoji || icons[child.icon] || '🤖', 'game-pet'));
  if (outfit) petWrap.append(el('span', outfit.emoji, 'game-outfit')); hero.append(petWrap);
  const info = el('div'); info.append(el('strong', child.nickname, `game-name ${w.activeNameFx || ''}`));
  if (title) info.append(el('span', `${title.emoji} ${title.name}`, 'game-title'));
  if (vehicle) info.append(el('span', `${vehicle.emoji} ${vehicle.name}`, 'card-meta'));
  hero.append(info); box.append(hero);
  if (w.activeBg) box.className += ` game-${w.activeBg}`; if (w.activeBase) box.className += ` ${w.activeBase}`;
}
async function childScreen() {
  stopTimer(); playStreak = 0; const child = model.child;
  const [st, g] = await Promise.all([api('/learn/state'), api('/game/state')]); gameModel = g;
  const box = panel('YOUR GRID', `Welcome, ${child.nickname}.`, 'Pick a track and go. Every mark, coin and crown is kept safe by the grid.');
  gameHero(box, child, g);
  const wallet = el('div', null, 'allowance'); wallet.append(el('strong', `⚡ ${g.wallet.gc}`, 'count'), el('span', 'grid coins'), el('strong', `🏆 ${g.wallet.rp}`, 'count'), el('span', 'reward points'), el('span', `🛡️ ${g.wallet.shields}`, 'badge')); box.append(wallet);
  if (g.wallet.egg && !g.wallet.egg.hatched) box.append(el('p', `🥚 Mystery Egg warming · ${Math.max(0, st.stats.passes - g.wallet.egg.passesAt)} / 5 passes`, 'notice'));
  if (st.active) box.append(el('p', `A ${st.active.session.mode === 'placement' ? 'placement test' : `${TRACK[st.active.session.track].name} session`} is open at question ${st.active.session.index + 1} of ${st.active.session.count}.`, 'notice'), button('Continue', () => playView(st.active.session, st.active.question), 'primary'));
  if (st.placement?.status === 'pending') { // the test comes first; the track cards wait
    const card = el('div', null, 'track');
    card.append(el('strong', `🎯 PLACEMENT TEST · SECTOR ${'ABCDEF'[st.placement.level]}`), el('span', 'Engine and Navigator questions from the middle of the sector. Timed — answer as quickly as you can. Each track will start where you are ready.', 'card-meta'));
    if (!st.active) card.append(button('Start the placement test', async () => { playStreak = 0; const r = await api('/learn/session', { track: 'engine', mode: 'placement' }); if (r.settled) return summaryView({ mode: 'placement', track: 'engine' }, r.summary); playView(r.session, r.question); }, 'primary')); // settled: an abandoned test was graded as it stood
    box.append(card);
  }
  for (const t of st.placement?.status === 'pending' ? [] : ['engine', 'nav']) {
    const p = st[t], card = el('div', null, 'track');
    const next = p.next.mode === 'boss' ? `👑 Check point T${p.next.tierEnd / 20} is due` : p.next.mode === 'practice' ? 'Sector done — practice until the other track catches up' : `Next: papers ${p.next.startPaper}–${p.next.startPaper + 4}`;
    card.append(el('strong', `${TRACK[t].emoji} ${TRACK[t].name} · SECTOR ${p.levelId}`), el('span', `${Math.min(p.paper - 1, 100)} / 100 papers · ${p.bossCleared} / 5 crowns`, 'card-meta'), el('span', next, 'card-meta'));
    if (!st.active) card.append(button(`Start ${TRACK[t].name}`, async () => { playStreak = 0; const r = await api('/learn/session', { track: t }); playView(r.session, r.question); }, 'primary')); box.append(card);
  }
  if (st.scan?.available && !st.active) box.append(button('🧠 SYSTEM SCAN · WEEKLY ×2 LOOT', async () => { playStreak = 0; const r = await api('/learn/session', { track: 'engine', mode: 'scan' }); playView(r.session, r.question); }, 'scan-button'));
  else if (st.scan?.unlocked) box.append(el('p', '🧠 System Scan done this week · resets Monday', 'small muted'));
  if (g.rocket) {
    const r = g.rocket, mine = r.myFuel || 0, rocket = el('div', null, 'rocket-card');
    rocket.append(el('strong', `🚀 FAMILY ROCKET · ${r.prize.emoji} ${r.prize.name}`), el('span', `${r.totalFuel} / ${r.goal} ${r.currency === 'rp' ? '🏆' : '⚡'} · you: ${mine}${r.minEach ? ` / ${r.minEach} min` : ''}`, 'card-meta'));
    if (r.status === 'fueling' && r.isCrew) for (const amt of (r.currency === 'rp' ? [100, 200, 500] : [50, 100, 250])) rocket.append(button(`Fuel ${r.currency === 'rp' ? '🏆' : '⚡'}${amt}`, async () => { await api('/game/rocket/fuel', { rocketId: r.id, amount: amt, operationId: crypto.randomUUID() }); await childScreen(); }, 'ghost'));
    if (r.status === 'launched') rocket.append(el('span', '🎉 LIFT-OFF! Ask your parent for the prize.', 'notice')); box.append(rocket);
  }
  if (st.history.length) { const log = el('div', null, 'log'); for (const h of st.history.slice(0, 6)) log.append(el('span', `${h.date} · ${h.mode === 'scan' ? '🧠' : TRACK[h.track].emoji} ${h.levelId} ${h.papers} · ${h.quit ? `left at Q${h.atQ + 1}` : h.passed ? 'PASS' : `${h.correct}/${h.total}`}`, 'card-meta')); box.append(log); }
  const actions = el('div', null, 'actions'); actions.append(button('🛒 Shop & rewards', shopScreen, 'ghost'), button('🗺 Map & fluency', mapScreen, 'ghost'), button('Switch child', async () => { await api('/session/select', {}); channel?.postMessage('changed'); await refresh(); }, 'ghost'), button('Parent sign-in', () => signInScreen(), 'text-button')); box.append(actions);
}
async function shopScreen() {
  transientView = true; const g = await api('/game/state'); gameModel = g; const box = panel('GRID SHOP', 'Spend what you earned.', 'Cosmetics and utilities use ⚡ Grid Coins. Family rewards use 🏆 Reward Points. Prices and outcomes come from the server.');
  box.append(el('p', `Wallet · ⚡ ${g.wallet.gc} · 🏆 ${g.wallet.rp} · 🛡️ ${g.wallet.shields}`, 'notice'));
  const inv = new Set(g.wallet.inventory || []);
  for (const it of g.catalog.filter((x) => !x.hatch && !x.unlock)) {
    const row = el('div', null, 'shop-row'); row.append(el('span', `${it.emoji} ${it.name}`, 'shop-name'), el('span', `⚡${it.cost}`, 'shop-cost'));
    if (it.kind === 'shield' || it.kind === 'crate' || it.kind === 'egg') row.append(button('BUY', async () => { const r = await api('/game/shop/buy', { itemId: it.id, operationId: crypto.randomUUID() }); gameSound('buy'); if (r.awarded) note(`🎁 You got ${r.awarded.emoji} ${r.awarded.name}!`); await shopScreen(); }, 'ghost'));
    else if (!inv.has(it.id)) row.append(button('BUY', async () => { await api('/game/shop/buy', { itemId: it.id, operationId: crypto.randomUUID() }); gameSound('buy'); await shopScreen(); }, 'ghost'));
    else if (EQUIP_SLOT[it.kind]) { const active = g.wallet[EQUIP_SLOT[it.kind]] === it.id; row.append(button(active ? 'EQUIPPED' : 'EQUIP', async () => { if (!active) await api('/game/shop/equip', { kind: it.kind, itemId: it.id }); await shopScreen(); }, active ? 'badge' : 'ghost')); }
    box.append(row);
  }
  const earned = g.catalog.filter((x) => x.unlock || x.hatch); if (earned.length) { box.append(el('h2', 'Earned & hatch pets')); for (const it of earned) { const u = it.unlockProgress; box.append(el('p', `${it.emoji} ${it.name} · ${inv.has(it.id) ? 'OWNED' : it.hatch ? 'Mystery Egg hatch' : `${u?.have || 0}/${u?.need || it.unlock?.n}`}`, 'small muted')); } }
  box.append(el('h2', '🎁 Reward Store'));
  if (!g.rewards.length) box.append(el('p', 'Your parent has not published any rewards yet.', 'muted'));
  for (const r of g.rewards) { const row = el('div', null, 'shop-row'); row.append(el('span', `${r.emoji} ${r.name}`, 'shop-name'), el('span', `🏆${r.cost}${r.cap ? ` · max ${r.cap}/day` : ''}`, 'shop-cost'), button('REDEEM', async () => { await api('/game/rewards/redeem', { rewardId: r.id, operationId: crypto.randomUUID() }); note('Sent to parent for approval. Points are held while pending.'); await shopScreen(); }, 'ghost')); box.append(row); }
  const pending = (g.wallet.redemptions || []).filter((r) => r.status === 'pending'); if (pending.length) box.append(el('p', `Pending: ${pending.map((r) => `${r.emoji} ${r.name}`).join(' · ')}`, 'notice'));
  box.append(button('Back to my grid', childScreen, 'primary'));
}
async function mapScreen() {
  transientView = true; const [st, g] = await Promise.all([api('/learn/state'), api('/game/state')]); gameModel = g; const box = panel('MISSION MAP', 'Progress & fluency', 'Your map is calculated from server-recorded sessions. Accuracy and time cannot be edited by the browser.'); if (g.wallet.activeMap) box.className += ` ${g.wallet.activeMap}`;
  for (const t of ['engine', 'nav']) { const p = st[t], card = el('div', null, 'track'); card.append(el('strong', `${TRACK[t].emoji} ${TRACK[t].name} · Sector ${p.levelId}`), el('span', `${Math.min(100, p.paper - 1)} papers · ${p.bossCleared} crowns`, 'card-meta')); box.append(card); }
  if (!g.heatmap.length) box.append(el('p', 'Complete some sessions to light up the fluency grid.', 'muted'));
  for (const c of g.heatmap.sort((a,b) => a.track.localeCompare(b.track) || a.level-b.level || a.tier-b.tier)) { const row = el('div', null, 'heat-row'); row.append(el('strong', `${TRACK[c.track].emoji} ${c.levelId} · Tier ${c.tier}`), el('span', `${c.accuracy}% · ${c.avgSeconds ?? '—'} s avg · ${c.attempts} questions`, 'card-meta')); box.append(row); }
  box.append(button('Back to my grid', childScreen, 'primary'));
}
function displayText(d) { if (d.layout === 'stack') return `${d.top} ${d.sym} ${d.bottom} =`; if (d.layout === 'frac') return `${d.pre ? `${d.pre} ` : ''}${d.parts.map((p) => (p.sym ? p.sym : `${p.n}/${p.d}`)).join(' ')} =`; return d.text; }
function playView(session, q) {
  stopTimer(); transientView = true; const t = TRACK[q.track || session.track], box = panel(`${t.emoji} ${t.name} · SECTOR ${q.levelId || session.levelId}`, runLabel(session), `Question ${q.index + 1} of ${session.count}${session.mode === 'placement' ? '' : ` · paper ${q.paper}`}`);
  const shout = gameModel?.wallet?.activeShout, tier = playStreak >= 18 ? 3 : playStreak >= 14 ? 2 : playStreak >= 9 ? 1 : playStreak >= 4 ? 0 : -1;
  if (tier >= 0) box.append(el('p', (SHOUTS[shout] || ['COMBO!', 'SUPER COMBO!', 'HYPER COMBO!', 'ULTRA COMBO!!'])[tier], 'combo'));
  box.append(el('p', displayText(q.display), 'question'));
  if (q.read && window.speechSynthesis && window.SpeechSynthesisUtterance) box.append(button('🔊 Read aloud', () => { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new window.SpeechSynthesisUtterance(q.read)); }, 'text-button'));
  const timerSkin = gameModel?.wallet?.activeTimer || ''; const clock = el('p', `${q.seconds} s`, `clock ${timerSkin}`); box.append(clock); let left = q.seconds;
  timer = setInterval(() => { left--; clock.textContent = `${Math.max(0, left)} s`; if (left <= 0) stopTimer(); }, 1000);
  const attemptId = crypto.randomUUID();
  const submit = async (answer) => { stopTimer(); const r = await api('/learn/answer', { sessionId: session.id, index: q.index, attemptId, answer }); playStreak = r.correct ? playStreak + 1 : 0; const fx = FX[gameModel?.wallet?.activeFx]; if (fx && r.correct) note(`${fx} ${fx} ${fx}`);
    gameSound(r.correct ? 'correct' : 'wrong'); if (r.done) summaryView(session, r.summary); else playView({ ...session, index: r.question.index }, r.question); note(r.correct ? '✓ Correct' : r.result === 'timeout' ? `⏱ Too slow — it was ${r.expected}` : `✗ It was ${r.expected}`); };
  const submitForm = (fields, read) => { const form = el('form', null, 'answer-form'); for (const f of fields) form.append(f.wrap); const go = el('button', 'Answer', 'primary'); go.type = 'submit'; form.append(go); form.onsubmit = (event) => { event.preventDefault(); run(() => submit(read())); }; box.append(form); fields[0].input.focus(); };
  if (q.answerType === 'choice') q.display.choices.forEach((c, i) => box.append(button(c, () => submit(String(i)), 'primary')));
  else if (q.answerType === 'frac') { const n = field('Numerator', 'text', { inputMode: 'numeric', pattern: '(0|[1-9][0-9]{0,3})', maxLength: 4, autocomplete: 'off' }); const d = field('Denominator', 'text', { inputMode: 'numeric', pattern: '[1-9][0-9]{0,3}', maxLength: 4, autocomplete: 'off' }); submitForm([n, d], () => ({ n: n.input.value.trim(), d: d.input.value.trim() })); }
  else { const a = field('Your answer', 'text', { inputMode: q.answerType === 'dec' ? 'decimal' : 'numeric', maxLength: 10, autocomplete: 'off' }); submitForm([a], () => a.input.value.trim()); }
  box.append(button('Leave this session', async () => { stopTimer(); await api('/learn/quit', { sessionId: session.id }); await refresh(); }, 'text-button'));
}
function summaryView(session, s) {
  transientView = true;
  if (s.placement) { // the test is done: where each track begins
    const box = panel('🎯 PLACEMENT COMPLETE', 'Your grid is set.', `${s.correct} out of ${s.total} in the test. Coins start with your first real papers.`);
    const words = { ahead: 'ready for the next sector', 'on-level': 'right in the middle of the sector', building: 'building up through the sector', foundations: 'from the start of the sector', previous: 'a sector back, from the middle', 'previous-start': 'a sector back, from the start' };
    for (const tr of ['engine', 'nav']) { const p = s.placement[tr]; box.append(el('p', `${TRACK[tr].emoji} ${TRACK[tr].name}: starts at Sector ${p.levelId}, paper ${p.paper} — ${words[p.band] || p.band} (${p.correct}/${p.total} right).`, 'notice')); }
    box.append(button('Go to my grid', refresh, 'primary')); return;
  }
  const t = TRACK[session.track];
  const box = panel(`${t.emoji} ${t.name} · ${s.papers}`, s.passed ? 'PASS!' : 'Not this time.',
    s.passed ? (s.rewarded ? `${s.correct} out of ${s.total}. ⚡ +${s.gcEarned} 🏆 +${s.rpEarned}` : `${s.correct} out of ${s.total}. Practice runs keep you sharp but pay nothing — coins come back when the other track finishes the sector.`)
      : `${s.correct} out of ${s.total}${s.timeout ? `, ${s.timeout} timed out` : ''}. A pass needs every question right.`);
  if (s.leveledUp) box.append(el('p', `Sector ${s.newLevelId} unlocked!`, 'notice'));
  else if (s.bossNext) box.append(el('p', '👑 A check point is next: questions from the whole tier, double loot.', 'notice'));
  for (const e of s.gameEvents || []) if (e.item) box.append(el('p', `${e.type === 'hatched' ? '🥚 HATCH!' : '🏆 UNLOCK!'} ${e.item.emoji} ${e.item.name}`, 'notice'));
  box.append(el('p', `Wallet: ⚡ ${s.wallet.gc} · 🏆 ${s.wallet.rp}`, 'muted'), button('Back to my grid', refresh, 'primary'));
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
  else { box.append(el('p', `${g.rocket.prize.emoji} ${g.rocket.prize.name} · ${g.rocket.totalFuel}/${g.rocket.goal} · ${g.rocket.status}`, 'notice')); if (g.rocket.status === 'fueling') box.append(button('Launch now', async () => { await parentGameMutation('/game/parent/rocket', { action: 'launch', rocketId: g.rocket.id }); }, 'ghost'), button('Scrap (no refund)', async () => { await parentGameMutation('/game/parent/rocket', { action: 'scrap', rocketId: g.rocket.id }); }, 'text-button')); else box.append(button('Prize delivered · clear', async () => { await parentGameMutation('/game/parent/rocket', { action: 'claim', rocketId: g.rocket.id }); }, 'primary')); }
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
if (returned?.get('checkout')) {
  if (typeof history === 'object' && history?.replaceState) history.replaceState(null, '', location.pathname);
  if (returned.get('result') === 'success') { note('Payment received. Your plan updates as soon as the payment provider confirms it; this page checks again in a moment.'); setTimeout(() => { if (!working) run(refresh); }, 4000); }
  else note('Checkout cancelled. Nothing was charged.');
}
