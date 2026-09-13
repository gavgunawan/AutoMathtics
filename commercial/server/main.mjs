import { config } from './config.mjs';
import { pinHasher } from './security.mjs';
import { Foundation } from './service.mjs';
import { FirebaseIdentity, FirestoreStore } from './firebase.mjs';
import { Learning } from './learning.mjs';
import { Game } from './game.mjs';
import { Subscriptions } from './subscription.mjs';
import { Payments, FakeGateway } from './payments.mjs';
import { StripeGateway } from './gateways/stripe.mjs';
import { Support } from './support.mjs';
import { Recovery } from './recovery.mjs';
import { Email } from './email.mjs';
import { Feedback } from './feedback.mjs';
import { Waitlist } from './waitlist.mjs';
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
const billing = new Subscriptions({ foundation: service, store });
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
// The waiting list behind /join: addresses only, until the doors open on 19 September
const waitlist = new Waitlist({ store, secret: cfg.secret, origin: cfg.origin, release: cfg.releaseSha || VERSION,
  mailer: cfg.waitlist.mail.provider === 'resend' ? createMailer(cfg.waitlist.mail) : null, replyTo: cfg.waitlist.replyTo,
  log: (event) => console.error(JSON.stringify(event)) });
const server = createApp(service, cfg, { reportError: (event) => console.error(JSON.stringify(event)), learning, game, billing, payments, support, recovery, email, feedback, leaving, waitlist });
server.listen(cfg.port, cfg.emulator ? '127.0.0.1' : '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'foundation_ready', mode: cfg.mode, port: cfg.port }));
});
process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); });
