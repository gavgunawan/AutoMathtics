import { config } from './config.mjs';
import { pinHasher } from './security.mjs';
import { Foundation } from './service.mjs';
import { FirebaseIdentity, FirestoreStore } from './firebase.mjs';
import { Learning } from './learning.mjs';
import { Game } from './game.mjs';
import { Subscriptions } from './subscription.mjs';
import { createApp } from './http.mjs';

const cfg = config(); // Validate BEFORE loading SDKs or opening network connections.
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId: cfg.projectId, ...(cfg.emulator ? {} : { credential: applicationDefault() }) });
const store = new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) });
const service = new Foundation({ store, identity: new FirebaseIdentity(getAuth(app)),
  hasher: pinHasher(cfg.pepper, cfg.previousPeppers), secret: cfg.secret });
const learning = new Learning({ foundation: service, store });
const game = new Game({ foundation: service, store });
const billing = new Subscriptions({ foundation: service, store });
const server = createApp(service, cfg, { reportError: (event) => console.error(JSON.stringify(event)), learning, game, billing });
server.listen(cfg.port, cfg.emulator ? '127.0.0.1' : '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'foundation_ready', mode: cfg.mode, port: cfg.port }));
});
process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); });
