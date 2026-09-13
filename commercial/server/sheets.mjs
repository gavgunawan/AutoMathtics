// The owner's copy of the waiting list, in a Google Sheet (the owner's request of 13 Sep 2026: "cant this be in gsheet or
// something less codey"). The service writes it as itself — the runtime service account the sheet is shared with — holding a
// token from the Cloud Run metadata server scoped to spreadsheets alone: no key exists anywhere, and the account can open no
// sheet nobody shared with it. Values go in RAW, so an address that starts with = or + is text in a cell, never a formula.
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const METADATA_TOKEN_URL = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(SCOPE)}`;
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export function createSheets({ fetch = globalThis.fetch, now = Date.now, timeoutMs = 5000 } = {}) {
  let cached = null;
  async function call(url, init) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw Object.assign(Error(`Google answered ${res.status}`), { code: `SHEETS_${res.status}` });
    return res.json();
  }
  // one token for as long as it lasts, less a minute, so a write never starts on a token about to lapse
  async function token() {
    if (cached && cached.until - 60_000 > now()) return cached.value;
    const t = await call(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
    if (typeof t?.access_token !== 'string') throw Object.assign(Error('The metadata server gave no token'), { code: 'SHEETS_NO_TOKEN' });
    cached = { value: t.access_token, until: now() + (Number(t.expires_in) || 0) * 1000 };
    return cached.value;
  }
  const post = async (spreadsheetId, method, body) => call(`${API}/${encodeURIComponent(spreadsheetId)}/values:${method}`, {
    method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return {
    /** Write `data` — [A1 range, rows] pairs, in the sheet's first tab — then empty the `clear` ranges: two requests at most. */
    async write(spreadsheetId, { data, clear = [] }) {
      await post(spreadsheetId, 'batchUpdate', { valueInputOption: 'RAW', data: data.map(([range, values]) => ({ range, majorDimension: 'ROWS', values })) });
      if (clear.length) await post(spreadsheetId, 'batchClear', { ranges: clear });
    },
  };
}
