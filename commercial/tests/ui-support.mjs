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
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.value = ''; this._text = ''; this.attrs = {}; this.events = {};
    // only the CSSOM custom properties the page sets through setVar (the CSP refuses every other way), readable as style.props
    this.style = { props: {}, setProperty(k, v) { this.props[k] = String(v); }, removeProperty(k) { delete this.props[k]; } }; }
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
// clock: a function returning the time the page reads from Date.now(), for tests that count down (omit for real time)
// storage: a stand-in for the page's localStorage (omit: the page has none, as in a browser that blocks site data)
// location: the page's address, e.g. { search: '?resetsms', pathname: '/' } (omit: no location, as before), or an async
// function (f, a) → that address, run before the page loads, for an address that needs the fixture's ids (an email button)
// recordBodies: routes whose request bodies the test may read back from requests; only routes that carry no credential, such as '/api/learn/answer'
// svg: a DOM that makes SVG nodes (document.createElementNS), as a browser does (omit: it cannot, and the page must manage without)
// audio: a stand-in for window.AudioContext (omit: the page has no WebAudio and plays nothing)
export async function uiFixture(t, { family = true, signedIn = true, clock = null, storage = null, location = null, recordBodies = [], svg = false, audio = null } = {}) {
  const f = fixture();
  const a = signedIn ? (family ? await f.family('parentA', 2) : await f.login('parentA')) : null;
  if (typeof location === 'function') location = await location(f, a);
  const cfg = { origin: 'http://127.0.0.1', secret, emulator: true, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } };
  const server = createApp(f.service, cfg, { learning: f.learning, game: f.game, billing: f.billing, email: f.email, feedback: f.feedback }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
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
  // html: the page's root element, which carries data-mode (and data-bg on kid screens); decor: the #decor layer behind #app
  const html = new Element('html'), decor = new Element('div'); decor.id = 'decor';
  const document = { visibilityState: 'visible', querySelector: sel => sel === '#app' ? root : message, documentElement: html,
    getElementById: id => id === 'decor' ? decor : null, createElement: tag => new Element(tag),
    ...(svg ? { createElementNS: (ns, tag) => Object.assign(new Element(tag), { namespaceURI: ns }) } : {}), addEventListener: (name, fn) => { documentEvents[name] = fn; } };
  const fetchForPage = async (path, options = {}) => {
    requests.push({ path, method: options.method || 'GET', ...(recordBodies.includes(path) && options.body ? { body: JSON.parse(options.body) } : {}) }); // never retain request credentials
    const r = await fetch(cfg.origin + path, { ...options, headers: { ...options.headers, Cookie: cookie, Origin: cfg.origin } });
    const next = r.headers.get('set-cookie'); if (next) cookie = next.split(';')[0]; return r;
  };
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const speechSynthesis = { cancel() {}, speak() {} };
  class SpeechSynthesisUtterance { constructor(text) { this.text = text; } }
  // The session history of one tab, as far as the page can touch it: entries with their state, the one shown, and how
  // often Back was pressed on the first entry (which in a browser leaves for whatever the tab showed before).
  const history = { entries: [{ state: null }], index: 0, left: 0,
    get state() { return this.entries[this.index].state; },
    pushState(state) { this.entries.splice(this.index + 1); this.entries.push({ state }); this.index++; },
    replaceState(state) { this.entries[this.index] = { state }; } };
  const windowEvents = {};
  const window = { BroadcastChannel: Channel, speechSynthesis, SpeechSynthesisUtterance, history, addEventListener: (name, fn) => { windowEvents[name] = fn; }, ...(audio ? { AudioContext: audio } : {}) };
  // Intervals are held, never run on their own: a test ticks them (and moves its clock) explicitly.
  const intervals = new Map(); let intervalId = 0;
  const context = vm.createContext({ document, window, history, BroadcastChannel: Channel, crypto: webcrypto, fetch: fetchForPage, console, TextEncoder, URLSearchParams, ...(storage ? { localStorage: storage } : {}), ...(location ? { location } : {}),
    setInterval: (fn) => { intervals.set(++intervalId, fn); return intervalId; }, clearInterval: (id) => { intervals.delete(id); },
    setTimeout: (fn) => { fn(); return 0; },
    ...(clock ? { Date: class extends Date { static now() { return clock(); } } } : {}) });
  const api = await vm.runInContext(`(async()=>{ ${source}\nreturn { addChildScreen, familySetup, resetPinScreen, signInScreen, refresh, hms,
    getModel:()=>model, isWorking:()=>working, setAuth:x=>{authModule=x;} }; })()`, context);
  const idle = async () => { for (let i = 0; i < 1000 && api.isWorking(); i++) await new Promise(r => setTimeout(r, 2)); assert.equal(api.isWorking(), false); };
  const setAuth = (uid = 'parentA', extra = {}) => api.setAuth({ signIn: async () => ({ stage: 'ready', idToken: f.token(uid) }), clear: async () => {}, ...extra });
  const submitLogin = async () => {
    const form = nodes(root, 'FORM')[0]; assert.ok(form, 'login form missing');
    const inputs = nodes(form, 'INPUT'); inputs[0].value = 'synthetic@example.test'; inputs[1].value = 'SyntheticPasswordOnly';
    for (const again of inputs.slice(2)) if (again.type === 'password') again.value = inputs[1].value; // sign-up asks for it twice
    form.onsubmit({ preventDefault() {} }); await idle();
  };
  const draft = async (nickname = 'Private draft') => {
    api.addChildScreen(); const inputs = nodes(root, 'INPUT');
    inputs[0].value = nickname; inputs[1].value = inputs[2].value = '763829'; inputs[3].value = '7'; // nickname, PIN, PIN again, age (v3.1)
    nodes(root, 'SELECT')[0].value = 'wolf'; f.advance(301000);
    await control(root, 'Create child profile').onclick(); assert.ok(root.textContent.includes('PARENT VERIFICATION'));
  };
  return { f, a, root, message, html, decor, api, requests, broadcasts, nodes: tag => nodes(root, tag), click: label => control(root, label).onclick(),
    idle, setAuth, submitLogin, draft, cookie: () => cookie, setCookie: value => { cookie = `__session=${value}`; },
    visibility: () => documentEvents.visibilitychange?.(), sessionChange: () => channelHandler?.(),
    tap: (type = 'click') => documentEvents[type]?.({ type }), // a user's tap as the document sees it first (a click, a touchend, a key)
    // the release check (app.js releaseTick) lives as long as the page: ticked with the other clocks, never counted among them;
    // tick's promise settles once every clock has done its work (the check's question to the server included)
    history, intervals: () => [...intervals.values()].filter((fn) => fn.name !== 'releaseTick').length, tick: () => Promise.all([...intervals.values()].map((fn) => fn())),
    setRelease: (release) => { cfg.releaseSha = release; }, // a deploy, as the running server would report it
    // the browser's Back: one entry down, popstate with that entry's state, or out of the page from the first entry
    back: async () => { if (history.index === 0) { history.left++; return; } history.index--; windowEvents.popstate?.({ state: history.state }); await idle(); },
    popstate: async (state) => { windowEvents.popstate?.({ state }); await idle(); } };
}
