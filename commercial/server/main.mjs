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
const server = createApp(service, cfg, { reportError: (event) => console.error(JSON.stringify(event)), learning, game, billing, payments, support, recovery, email });
server.listen(cfg.port, cfg.emulator ? '127.0.0.1' : '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'foundation_ready', mode: cfg.mode, port: cfg.port }));
});
process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); });
