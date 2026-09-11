// What the local real-browser check of the v2 look found (12 Sep 2026), held here: the sound starts inside a tap, as iPad Safari
// requires; the page names its own icon, so no browser asks the server for /favicon.ico; and the port leaves no dead v3 styles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { uiFixture } from './ui-support.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('the sound starts inside a tap: on a kid\'s device the first tap makes the audio context and plays one silent sample in it; a parent\'s taps make none', async (t) => {
  const made = [];
  class FakeAudio { // just what the page touches: a state, resume, and a buffer source it starts
    constructor() { this.state = 'suspended'; this.started = 0; made.push(this); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createBuffer() { return {}; }
    createBufferSource() { return { connect() {}, start: () => { this.started++; } }; }
    get destination() { return {}; }
  }
  const h = await uiFixture(t, { audio: FakeAudio }); await h.f.child(h.a.ctx); await h.api.refresh();
  h.tap('click'); h.tap('touchend'); assert.equal(made.length, 0, 'Mission Control makes no audio');
  await h.click('Hand over to kids');
  h.tap('touchend'); assert.equal(made.length, 1, 'the first tap on the launch pad makes it'); assert.equal(made[0].state, 'running'); assert.equal(made[0].started, 1, 'with one silent sample, inside the tap');
  h.tap('click'); h.tap('keydown'); assert.equal(made.length, 1, 'one context for the page'); assert.equal(made[0].started, 1, 'a running context needs nothing more');
  made[0].state = 'suspended'; h.tap('click'); assert.equal(made[0].state, 'running', 'one the system suspended wakes on the next tap');
});

test('the page names its own icon in the page itself, so no browser asks the server for /favicon.ico', async () => {
  const html = await read('../public/index.html');
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,[^"]+">/);
  assert.match(await read('../../commercial/server/http.mjs'), /img-src 'self' data:/, 'the icon is a data: image, which the CSP admits');
});

test('no dead v3 styles are left: the allowance bar, the crew cards and their orbiting frame, the .track and .approval rows, the loose-button stopgap', async () => {
  const css = await read('../public/styles.css'), app = await read('../public/app.js');
  for (const gone of ['.allowance', '.crew-grid', '.crew-card', '.avatar-frame', '@keyframes orbit{', '.card-meta', '.track {', '.approval', '.panel>button', 'h1.sub', '.quit{', '.actions']) assert.ok(!css.includes(gone), gone);
  assert.ok(!/\bfunction (cards|gameHero)\(/.test(app), 'nor the v3 functions that drew them');
});
