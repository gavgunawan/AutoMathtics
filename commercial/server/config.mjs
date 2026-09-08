export function config(env = process.env) {
  const mode = env.APP_MODE;
  if (!['emulator', 'staging', 'production'].includes(mode)) throw Error('Set APP_MODE explicitly.');
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId || projectId === 'automathtics') throw Error('Use a NEW Firebase project; the live prototype is forbidden.');
  const origin = env.APP_ORIGIN;
  let url;
  try { url = new URL(origin); } catch { throw Error('APP_ORIGIN must be an absolute origin.'); }
  if (url.origin !== origin) throw Error('APP_ORIGIN must have no path or trailing slash.');
  const secret = env.SESSION_SECRET, pepper = env.PIN_PEPPER;
  if (!/^[a-f0-9]{64,}$/.test(secret || '') || !/^[a-f0-9]{64,}$/.test(pepper || '') || secret === pepper) {
    throw Error('Set two different random hex secrets of at least 32 bytes.');
  }
  const emulator = mode === 'emulator';
  if (emulator) {
    if (!projectId.startsWith('demo-') || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:' ||
        env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088') {
      throw Error('Emulator mode requires demo-* project, loopback origin, Auth :9099 and Firestore :8088.');
    }
  } else if (url.protocol !== 'https:' || projectId.startsWith('demo-') || Object.keys(env).some((k) => k.includes('EMULATOR') && env[k])) {
    throw Error('Staging/production requires HTTPS and must not use emulator configuration.');
  }
  if (!env.FIREBASE_WEB_API_KEY || !env.FIREBASE_WEB_APP_ID) throw Error('Set the new project web configuration.');
  // Retired PIN peppers still verify old hashes; see pinHasher. Each must be a distinct real secret.
  const previousPeppers = (env.PIN_PEPPER_PREVIOUS || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (previousPeppers.some((p) => !/^[a-f0-9]{64,}$/.test(p) || p === pepper || p === secret) ||
      new Set(previousPeppers).size !== previousPeppers.length) {
    throw Error('PIN_PEPPER_PREVIOUS must list distinct retired hex peppers, none equal to the current secrets.');
  }
  // The number of trusted proxies in front of the server. Each appends to X-Forwarded-For the
  // address it accepted the connection from, so the last N entries are trustworthy and the
  // earliest of them — appended by the first trusted proxy — is the client. Firebase Hosting in
  // front of Cloud Run is 2. 0 = use the socket address, which behind a proxy is the proxy itself
  // and would throttle every visitor as one client, so staging/production must state the count
  // explicitly after measuring it on the real origin (DEPLOY_V3.md §5).
  if (!emulator && !/^[0-5]$/.test(env.TRUSTED_PROXY_HOPS || '')) throw Error('Set TRUSTED_PROXY_HOPS (0-5) for the deployed edge; see DEPLOY_V3.md.');
  const proxyHops = emulator ? Number(env.TRUSTED_PROXY_HOPS || 0) : Number(env.TRUSTED_PROXY_HOPS);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) throw Error('TRUSTED_PROXY_HOPS must be 0-5.');
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT.');
  return { mode, emulator, projectId, origin, secret, pepper, previousPeppers, proxyHops, port,
    web: { apiKey: env.FIREBASE_WEB_API_KEY, appId: env.FIREBASE_WEB_APP_ID, projectId, authDomain: `${projectId}.firebaseapp.com` } };
}
