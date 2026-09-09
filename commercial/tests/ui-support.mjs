// Test-only DOM harness. Executes the exact public/app.js with the real HTTP
// handler and synthetic identity/database fixtures. It is not a browser engine.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fixture, secret } from './support.mjs';
import { createApp } from '../server/http.mjs';
export class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.value = ''; this._text = ''; this.attrs = {}; this.events = {}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; this._text = ''; }
  set textContent(x) { this._text = String(x); this.children = []; }
  get textContent() { return this._text + this.children.map(x => typeof x === 'string' ? x : x.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k, f) { this.events[k] = f; }
  checkValidity() { return !(this.required && !this.value) && (!this.pattern || new RegExp(`^(?:${this.pattern})$`).test(this.value)); }
  reportValidity() { return this.checkValidity(); }
  focus() {}
}
export function nodes(el, tag) { return [...(el.tagName === tag ? [el] : []), ...el.children.flatMap(c => c instanceof Element ? nodes(c, tag) : [])]; }
export function control(root, label) {
  const b = nodes(root, 'BUTTON').find(b => b.textContent === label); assert.ok(b, `button missing: ${label}`); return b;
}
export async function uiFixture(t, { family = true, signedIn = true } = {}) {
  const f = fixture();
  const a = signedIn ? (family ? await f.family('parentA', 2) : await f.login('parentA')) : null;
  const cfg = { origin: 'http://127.0.0.1', secret, emulator: true, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } };
  const server = createApp(f.service, cfg, { learning: f.learning, game: f.game, billing: f.billing }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cfg.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  let cookie = a ? `__session=${a.cookie}` : '';
  const requests = [], broadcasts = [], documentEvents = {};
  let channelHandler;
  class Channel {
    constructor() {}
    addEventListener(_, fn) { channelHandler = fn; }
    postMessage(message) { broadcasts.push(message); }
  }
  const root = new Element('main'), message = new Element('p');
  const document = { visibilityState: 'visible', querySelector: sel => sel === '#app' ? root : message,
    createElement: tag => new Element(tag), addEventListener: (name, fn) => { documentEvents[name] = fn; } };
  const fetchForPage = async (path, options = {}) => {
    requests.push({ path, method: options.method || 'GET' }); // never retain request credentials
    const r = await fetch(cfg.origin + path, { ...options, headers: { ...options.headers, Cookie: cookie, Origin: cfg.origin } });
    const next = r.headers.get('set-cookie'); if (next) cookie = next.split(';')[0]; return r;
  };
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const speechSynthesis = { cancel() {}, speak() {} };
  class SpeechSynthesisUtterance { constructor(text) { this.text = text; } }
  const window = { BroadcastChannel: Channel, speechSynthesis, SpeechSynthesisUtterance };
  const context = vm.createContext({ document, window, BroadcastChannel: Channel, crypto: webcrypto, fetch: fetchForPage, console,
    setInterval: () => 0, clearInterval: () => {}, setTimeout: (fn) => { fn(); return 0; } }); // the question clock is display only
  const api = await vm.runInContext(`(async()=>{ ${source}\nreturn { addChildScreen, familySetup, resetPinScreen, signInScreen, refresh,
    getModel:()=>model, isWorking:()=>working, setAuth:x=>{authModule=x;} }; })()`, context);
  const idle = async () => { for (let i = 0; i < 1000 && api.isWorking(); i++) await new Promise(r => setTimeout(r, 2)); assert.equal(api.isWorking(), false); };
  const setAuth = (uid = 'parentA', extra = {}) => api.setAuth({ signIn: async () => ({ stage: 'ready', idToken: f.token(uid) }), clear: async () => {}, ...extra });
  const submitLogin = async () => {
    const form = nodes(root, 'FORM')[0]; assert.ok(form, 'login form missing');
    const inputs = nodes(form, 'INPUT'); inputs[0].value = 'synthetic@example.test'; inputs[1].value = 'SyntheticPasswordOnly';
    form.onsubmit({ preventDefault() {} }); await idle();
  };
  const draft = async (nickname = 'Private draft') => {
    api.addChildScreen(); const inputs = nodes(root, 'INPUT');
    inputs[0].value = nickname; inputs[1].value = inputs[2].value = '763829'; inputs[3].value = '7'; // nickname, PIN, PIN again, age (v3.1)
    nodes(root, 'SELECT')[0].value = 'wolf'; f.advance(301000);
    await control(root, 'Create child profile').onclick(); assert.ok(root.textContent.includes('PARENT VERIFICATION'));
  };
  return { f, a, root, message, api, requests, broadcasts, nodes: tag => nodes(root, tag), click: label => control(root, label).onclick(),
    idle, setAuth, submitLogin, draft, cookie: () => cookie, setCookie: value => { cookie = `__session=${value}`; },
    visibility: () => documentEvents.visibilitychange?.(), sessionChange: () => channelHandler?.() };
}
