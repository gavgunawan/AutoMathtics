// The paper trail of email-v1: what a family's deletion keeps and why, which email records expire by TTL (and that no financial
// one does), and the owner's documents: the deployment section, the privacy rows, the acceptance rows, the README.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RETENTION } from '../server/support.mjs';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

test('deletion keeps the account\'s email choices and the report status rows and says why; the two short-lived email collections expire by TTL, and no financial one does', async () => {
  assert.match(RETENTION['emailPrefs/{uid}'], /sign-in account/); assert.match(RETENTION['reports/*'], /no content/); assert.match(RETENTION['reports/*'], /TTL 400 days/);
  assert.ok(!Object.keys(RETENTION).some((k) => k.startsWith('outbox')), 'the outbox goes with the family, it is not kept');
  for (const [name, text] of [['DEPLOY_V3.md', await read('../DEPLOY_V3.md')], ['02-permissions.sh', await read('../scripts/cloudshell/02-permissions.sh')]]) {
    const groups = text.match(/for GROUP in ([^;]+); do/)[1].split(/\s+/);
    for (const g of ['reports', 'outbox']) assert.ok(groups.includes(g), `${name}: ${g} expires by TTL`);
    for (const g of ['emailPrefs', 'checkouts', 'billingChangeIntents', 'billingEvents', 'billingCustomers', 'billing']) assert.ok(!groups.includes(g), `${name}: ${g} is not a TTL group`);
  }
});

test('the owner\'s documents: the email section of the deployment guide, the privacy rows, acceptance rows E1 to E8, the README', async () => {
  const deploy = await read('../DEPLOY_V3.md'), privacy = await read('../PRIVACY.md'), acceptance = await read('../ACCEPTANCE.md'), readme = await read('../README.md');
  for (const s of ['## 5b. Email', 'am-v3-email-key', '07-report-job.sh', 'onboarding@resend.dev', 'EMAIL_PROVIDER=resend', 'verify a domain', '0 7 * * 1', 'Idempotency-Key', '/api/email/unsubscribe', 'EMAIL_PROVIDER=fake']) assert.ok(deploy.includes(s), s);
  assert.ok(!/^npm install/m.test(deploy));
  for (const s of ['`emailPrefs/{uid}`', '`reports/{familyId}:{week}`', '`outbox/{id}`', 'Resend', 'United States', '30 days', 'Email button tokens', 'email-v1', 'RFC 8058']) assert.ok(privacy.includes(s), s);
  for (let i = 1; i <= 8; i++) assert.match(acceptance, new RegExp(`^\\| E${i} \\|`, 'm'), `E${i}`);
  assert.match(readme, /Weekly progress email \(email-v1\)/); for (const s of ['`emailPrefs/{uid}`', '`reports/{familyId}:{week}`', '`outbox/{id}`']) assert.ok(readme.includes(s), s);
});
