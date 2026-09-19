import { config } from './config.mjs';
import { pinHasher } from './security.mjs';
import { Foundation } from './service.mjs';
import { FirebaseIdentity, FirestoreStore } from './firebase.mjs';
import { Learning } from './learning.mjs';
import { Game } from './game.mjs';
import { Olympia } from './olympia.mjs';
import { Tutor } from './tutor.mjs';
import { createModel } from './anthropic.mjs';
import { Subscriptions } from './subscription.mjs';
import { Payments, FakeGateway } from './payments.mjs';
import { StripeGateway } from './gateways/stripe.mjs';
import { Support } from './support.mjs';
import { Recovery } from './recovery.mjs';
import { Email } from './email.mjs';
import { Feedback } from './feedback.mjs';
import { Waitlist } from './waitlist.mjs';
import { createSheets } from './sheets.mjs';
import { LeavingFlow } from './leaving.mjs';
import { createMailer } from './mailer.mjs';
import { VERSION } from './version.mjs';
import { createApp } from './http.mjs';

const cfg = config(); // Validate BEFORE loading SDKs or opening network connections.
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId: cfg.projectId, ...(cfg.emulator ? {} : { credential: applicationDefault() }) });
const store = new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) });
const identity = new FirebaseIdentity(getAuth(app));
const service = new Foundation({ store, identity, hasher: pinHasher(cfg.pepper, cfg.previousPeppers), secret: cfg.secret });
const recovery = new Recovery({ foundation: service, store, identity, secret: cfg.secret }); // Stage 4.4
const learning = new Learning({ foundation: service, store });
const game = new Game({ foundation: service, store });
// Olympia (19 Sep 2026): the moons behind the Gateway jump, and the Explain-to-me tutor, which runs only where the owner has put a
// Claude API key in the environment (config.mjs tutor); without one the button never shows.
const olympia = new Olympia({ foundation: service, store });
const tutor = new Tutor({ foundation: service, store, model: cfg.tutor.apiKey ? createModel({ apiKey: cfg.tutor.apiKey, model: cfg.tutor.model }) : null,
  limits: { monthlyCalls: cfg.tutor.monthlyCalls, dailyExplanations: cfg.tutor.dailyPerChild }, log: (event) => console.error(JSON.stringify(event)) });
// what the log may say about the key: that there is one, its length, and whether it starts as a Claude key does — never a character of it
console.log(JSON.stringify({ event: 'tutor', on: tutor.on, keyLength: cfg.tutor.apiKey ? cfg.tutor.apiKey.length : 0, keyPrefixOk: Boolean(cfg.tutor.apiKey && cfg.tutor.apiKey.startsWith('sk-ant-')), monthlyCalls: cfg.tutor.monthlyCalls }));
// PAYMENT_PROVIDER=none: payments are not open. config.mjs reads no provider settings, so no gateway is built below, and the billing
// view, the payment routes and the leaving flow all say so (PAYMENTS.md → Payments not open).
const billing = new Subscriptions({ foundation: service, store, paymentsOpen: cfg.payments.provider !== 'none' });
const gateways = {};
if (cfg.payments.webhookSecrets.fake) gateways.fake = new FakeGateway({ secret: cfg.payments.webhookSecrets.fake });
if (cfg.payments.stripe) gateways.stripe = new StripeGateway({ ...cfg.payments.stripe, origin: cfg.origin });
const payments = new Payments({ foundation: service, store, billing, provider: cfg.payments.provider, gateways });
const support = new Support({ foundation: service, store, billing, payments });
const email = new Email({ foundation: service, store, identity, secret: cfg.secret }); // email-v1: sign-up consent, the switches, the email buttons
// Send feedback: kept in Firestore; copied to the owner only with FEEDBACK_TO and Resend (config.mjs). The fake provider emails nothing.
const feedback = new Feedback({ foundation: service, store, mailer: cfg.feedback.mail?.provider === 'resend' ? createMailer(cfg.feedback.mail) : null, to: cfg.feedback.to,
  release: cfg.releaseSha || VERSION, log: (event) => console.error(JSON.stringify(event)) });
// Leaving (12 Sep 2026): the cancel-or-pause flow, which does its work through the billing, payment and email routes above
const leaving = new LeavingFlow({ foundation: service, store, billing, payments, email });
// The waiting list behind /join: addresses only, until the doors open on 14 September
const waitlist = new Waitlist({ store, secret: cfg.secret, origin: cfg.origin, release: cfg.releaseSha || VERSION,
  // mail is null when the service copies nothing (no FEEDBACK_TO, config.mjs), and a service with nothing to send must still start
  mailer: cfg.waitlist.mail?.provider === 'resend' ? createMailer(cfg.waitlist.mail) : null, replyTo: cfg.waitlist.replyTo,
  sheets: cfg.waitlist.sheetId ? createSheets() : null, sheetId: cfg.waitlist.sheetId, // the owner's Google Sheet copy, where one is named
  log: (event) => console.error(JSON.stringify(event)) });
// A new sheet fills itself, and an address that expired from the list leaves it: at startup, when the copy is over an hour old.
// Not awaited, so the port opens at once; it never throws.
waitlist.syncSheetIfStale();
const server = createApp(service, cfg, { reportError: (event) => console.error(JSON.stringify(event)), learning, game, olympia, tutor, billing, payments, support, recovery, email, feedback, leaving, waitlist });
server.listen(cfg.port, cfg.emulator ? '127.0.0.1' : '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'foundation_ready', mode: cfg.mode, port: cfg.port }));
});
process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); });
