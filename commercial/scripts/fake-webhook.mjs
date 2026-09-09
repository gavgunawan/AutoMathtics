// Operator tool for the zero-cost fake payment provider (Stage 3.3): signs one provider event
// and delivers it to a running server's webhook route, exactly as a real provider would. This is
// how a checkout is "completed" while no money moves. Refuses any target that is not loopback
// unless CONFIRM_WEBHOOK_TARGET names that origin exactly.
//
//   WEBHOOK_SECRET_FAKE=... node scripts/fake-webhook.mjs ORIGIN CUSTOMER_REF checkout.completed PLAN PERIOD_END_ISO [CHECKOUT_ID]
//   WEBHOOK_SECRET_FAKE=... node scripts/fake-webhook.mjs ORIGIN CUSTOMER_REF invoice.paid PLAN PERIOD_END_ISO
//   WEBHOOK_SECRET_FAKE=... node scripts/fake-webhook.mjs ORIGIN CUSTOMER_REF invoice.payment_failed
//   WEBHOOK_SECRET_FAKE=... node scripts/fake-webhook.mjs ORIGIN CUSTOMER_REF subscription.updated PLAN
//   WEBHOOK_SECRET_FAKE=... node scripts/fake-webhook.mjs ORIGIN CUSTOMER_REF subscription.deleted
//
// EVENT_ID (default evt_<uuid>) lets you re-deliver the same event to see the replay; EVENT_AT
// (unix ms, default now) lets you deliver an old event to see it ignored as stale. The customer
// reference is on the parent's billing view (`GET /api/billing` → customer.fake) after a checkout.
import { randomUUID } from 'node:crypto';
import { signWebhook, PROVIDER_EVENTS } from '../server/payments.mjs';

const [origin, customer, type, ...rest] = process.argv.slice(2);
const secret = process.env.WEBHOOK_SECRET_FAKE;
if (!origin || !customer || !type) { console.error('Usage: node scripts/fake-webhook.mjs ORIGIN CUSTOMER_REF EVENT_TYPE [PLAN] [PERIOD_END_ISO] [CHECKOUT_ID]'); process.exit(1); }
if (!/^[a-f0-9]{64,}$/.test(secret || '')) throw Error('Set WEBHOOK_SECRET_FAKE to the server\'s webhook secret (hex, 32+ bytes).');
if (!PROVIDER_EVENTS[type] && process.env.ALLOW_UNSUPPORTED_EVENT !== 'yes') throw Error(`Unknown event type; one of ${Object.keys(PROVIDER_EVENTS).join(', ')} (or ALLOW_UNSUPPORTED_EVENT=yes to watch it be ignored).`);
const url = new URL(origin);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) && process.env.CONFIRM_WEBHOOK_TARGET !== url.origin) throw Error('Non-loopback target: set CONFIRM_WEBHOOK_TARGET to exactly that origin.');
const data = {};
if (['checkout.completed', 'invoice.paid'].includes(type)) {
  data.plan = rest[0]; data.periodEnd = Date.parse(rest[1] || '');
  if (!data.plan || !Number.isSafeInteger(data.periodEnd)) throw Error('PLAN and PERIOD_END_ISO are required for a payment event.');
  if (type === 'checkout.completed' && rest[2]) data.checkoutId = rest[2];
} else if (type === 'subscription.updated') { data.plan = rest[0]; if (!data.plan) throw Error('PLAN is required.'); }
const at = Number(process.env.EVENT_AT || Date.now());
const event = { id: process.env.EVENT_ID || `evt_${randomUUID()}`, type, at, customer, data };
const raw = Buffer.from(JSON.stringify(event));
const response = await fetch(`${url.origin}/api/webhooks/fake`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': signWebhook(secret, raw, Date.now()) }, body: raw });
console.log(JSON.stringify({ event: event.id, status: response.status, ...(await response.json()) }));
process.exit(response.ok ? 0 : 2);
