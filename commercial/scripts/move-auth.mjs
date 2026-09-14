// The move to automathtics-live (the owner's plan of 13 Sep 2026, DEPLOY_V3.md → Moving to a live project): every sign-in account
// copied from staging as it is. The same account id, so every Firestore record that names a parent still matches; the same email,
// verified flag and disabled flag; the same password, staging's scrypt hash imported with staging's own hash parameters, so a parent
// types what they always typed; and the same mobile as the second factor. Block J runs it in Cloud Shell as the owner, after the
// Firestore copy:
//
//   TOKEN="$(gcloud auth print-access-token)" node scripts/move-auth.mjs            a dry run: reads both projects, prints counts
//   TOKEN="$(gcloud auth print-access-token)" node scripts/move-auth.mjs --write    imports what live lacks, reads live back, compares
//
// It prints counts only, never an address, a mobile number, a hash, a salt or the signer key, and exits 2 when live does not match.
// A rerun after a failure imports only the accounts live still lacks; an account live holds that staging does not stops it.
import { pathToFileURL } from 'node:url';

export const FROM = 'automathtics-v3-staging', TO = 'automathtics-live';
export const API = 'https://identitytoolkit.googleapis.com';
const E164 = /^\+[1-9]\d{6,14}$/;
const phoneOf = (factor) => factor.unobfuscatedPhoneInfo || factor.phoneInfo;

/** Each staging account as the import takes it. A second factor without a whole mobile number stops everything: it would enrol the wrong phone. */
export function importRecords(users) {
  return users.map((u) => {
    const factors = (u.mfaInfo || []).map((m) => {
      if (!E164.test(phoneOf(m) || '')) throw Error('An account has a second factor without a whole mobile number: stopping before anything is written.');
      return { mfaEnrollmentId: m.mfaEnrollmentId, displayName: m.displayName, enrolledAt: m.enrolledAt, phoneInfo: phoneOf(m) };
    });
    return {
      localId: u.localId, email: u.email, emailVerified: Boolean(u.emailVerified), passwordHash: u.passwordHash, salt: u.salt, displayName: u.displayName,
      disabled: Boolean(u.disabled), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
      ...(u.customAttributes ? { customAttributes: u.customAttributes } : {}), ...(factors.length ? { mfaInfo: factors } : {}),
    };
  });
}

export const summary = (users) => ({
  accounts: users.length,
  withPassword: users.filter((u) => u.passwordHash).length,
  verified: users.filter((u) => u.emailVerified).length,
  disabled: users.filter((u) => u.disabled).length,
  withPhoneFactor: users.filter((u) => (u.mfaInfo || []).length).length,
});

/** How live differs from staging, in counts: accounts it lacks, accounts it holds that staging does not, and accounts that differ. */
export function compare(from, to) {
  const live = new Map(to.map((u) => [u.localId, u])), ids = new Set(from.map((u) => u.localId));
  const phones = (u) => (u.mfaInfo || []).map(phoneOf).sort().join(',');
  let missing = 0, differing = 0;
  for (const u of from) {
    const v = live.get(u.localId);
    if (!v) missing++;
    else if (v.email !== u.email || !v.emailVerified !== !u.emailVerified || !v.disabled !== !u.disabled || !v.passwordHash !== !u.passwordHash || phones(v) !== phones(u)) differing++;
  }
  return { missing, extra: to.filter((u) => !ids.has(u.localId)).length, differing };
}

/** An error message from the provider with anything that could be an address or a number taken out. */
export const redact = (message) => String(message).replace(/[^\s@"]+@[^\s@"]+/g, '…').replace(/\+?\d{6,}/g, '…');

export async function move({ token, write = false, log = (line) => console.log(JSON.stringify(line)) }) {
  if (!token) throw Error('Set TOKEN="$(gcloud auth print-access-token)" first.');
  const call = async (method, path, project, body) => {
    const response = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': project, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    if (!response.ok) throw Error(`${method} ${path.replace(/\?.*/, '')} answered ${response.status}`); // not the body: an error can echo what was sent
    return text ? JSON.parse(text) : {};
  };
  const download = async (project) => {
    const users = [];
    let page = '';
    do {
      const answer = await call('GET', `/v1/projects/${project}/accounts:batchGet?maxResults=1000${page ? `&nextPageToken=${encodeURIComponent(page)}` : ''}`, project);
      users.push(...(answer.users || []));
      page = answer.nextPageToken || '';
    } while (page);
    return users;
  };
  // Identity Platform's settings keep the password hash parameters under signIn (v2 Config.signIn.hashConfig), never at the top.
  const hash = (await call('GET', `/admin/v2/projects/${FROM}/config`, FROM)).signIn?.hashConfig;
  if (hash?.algorithm !== 'SCRYPT' || !hash.signerKey || !hash.saltSeparator || !hash.rounds || !hash.memoryCost) throw Error('Staging\'s password hash parameters could not be read: stopping before anything is written.');
  const staging = await download(FROM), records = importRecords(staging), before = await download(TO);
  log({ step: 'staging', ...summary(staging) });
  log({ step: 'live before', ...summary(before), ...compare(staging, before) });
  const known = new Set(staging.map((u) => u.localId));
  if (before.some((u) => !known.has(u.localId))) throw Error('The live project holds sign-in accounts staging does not: stop and look before importing.');
  const present = new Set(before.map((u) => u.localId)), missing = records.filter((r) => !present.has(r.localId));
  if (!write) { log({ step: 'dry run', wouldImport: missing.length, written: 0 }); return { dryRun: true, wouldImport: missing.length }; }
  let failed = 0;
  for (let i = 0; i < missing.length; i += 1000) {
    const batch = missing.slice(i, i + 1000);
    const answer = await call('POST', `/v1/projects/${TO}/accounts:batchCreate`, TO, {
      users: batch, hashAlgorithm: 'SCRYPT', signerKey: hash.signerKey, saltSeparator: hash.saltSeparator, rounds: hash.rounds, memoryCost: hash.memoryCost, sanityCheck: true,
    });
    const errors = answer.error || [];
    failed += errors.length;
    log({ step: 'imported', count: batch.length - errors.length, failed: errors.length, reasons: [...new Set(errors.map((e) => redact(e.message)))] });
  }
  const after = await download(TO), result = compare(staging, after);
  const matchesStaging = failed === 0 && result.missing === 0 && result.extra === 0 && result.differing === 0;
  log({ step: 'live after', ...summary(after), ...result, matchesStaging });
  return { dryRun: false, imported: missing.length - failed, failed, matchesStaging };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--write') || args.length > 1) { console.error('Usage: TOKEN="$(gcloud auth print-access-token)" node scripts/move-auth.mjs [--write]'); process.exit(64); }
  const r = await move({ token: process.env.TOKEN, write: args[0] === '--write' });
  if (!r.dryRun && !r.matchesStaging) process.exitCode = 2;
}
