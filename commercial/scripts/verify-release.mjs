// The post-deploy check of scripts/deploy-staging.sh, as a function the suite runs (tests/release.test.mjs): the live service must
// report the commit that was deployed, and the revision this deploy created must be ready, labelled with that commit and the one
// serving every request. A check that lived in the helper's heredoc could be neutered without a test noticing (fifth round).
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { VERSION } from '../server/version.mjs';

/**
 * Throws with the reason when the deploy did not take; answers what is live otherwise.
 * `service` is `gcloud run services describe --format=json` (null: the commit is checked, the revision is not).
 */
export function verifyRelease({ ok, health, sha, service = null }) {
  if (!ok || !health || health.version !== VERSION) throw Error('Live v3.0 health check failed; inspect Cloud Run logs.');
  if (!/^[0-9a-f]{40}$/.test(sha || '')) throw Error('verify-release needs the 40-character commit that was deployed.');
  if (health.release !== sha) throw Error(`The live service reports commit ${health.release || 'none'}, not ${sha}: the deploy did not take, or an older revision still serves traffic.`);
  let revision = null;
  if (service) {
    const st = service.status || {}, latest = st.latestCreatedRevisionName || null, ready = st.latestReadyRevisionName || null, traffic = Array.isArray(st.traffic) ? st.traffic : [];
    if (!latest || latest !== ready) throw Error(`The revision this deploy created (${latest || 'none'}) is not the ready one (${ready || 'none'}); inspect Cloud Run.`);
    const label = service.spec?.template?.metadata?.labels?.['release-sha'] || service.metadata?.labels?.['release-sha'] || null;
    if (label !== sha) throw Error(`The service is labelled release-sha=${label || 'none'}, not ${sha}.`);
    const serving = traffic.filter((t) => t.percent === 100);
    if (serving.length !== 1 || !(serving[0].revisionName === latest || serving[0].latestRevision === true)) {
      const name = service.metadata?.name || 'SERVICE';
      throw Error(`Traffic is not on ${latest}: ${traffic.map((t) => `${t.revisionName || 'LATEST'}=${t.percent ?? 0}%`).join(', ') || 'none'}. Route it there (gcloud run services update-traffic ${name} --to-latest --region REGION --project PROJECT_ID) and check again.`);
    }
    revision = latest;
  }
  return { version: health.version, release: health.release, revision };
}

const main = (() => { try { return process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : null; } catch { return null; } })(); // the real path: a checkout reached through a link must not make the gate silent
if (main && import.meta.url === main) {
  const [origin, sha, serviceFile] = process.argv.slice(2);
  if (!origin || !sha) { console.error('usage: node scripts/verify-release.mjs ORIGIN SHA [service.json]'); process.exit(2); }
  const res = await fetch(`${origin}/api/health`), health = await res.json().catch(() => null);
  const service = serviceFile ? JSON.parse(await readFile(serviceFile, 'utf8')) : null;
  const live = verifyRelease({ ok: res.ok, health, sha, service });
  console.log(`v${live.version} at commit ${sha.slice(0, 7)} is responding at ${origin}${live.revision ? ` from revision ${live.revision}` : ''}. Now complete the staging acceptance checklist.`);
}
