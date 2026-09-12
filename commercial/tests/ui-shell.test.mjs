// The page shell of the v2 look, and the rule every screen of it is built under (port plan, sections 0, 1 and 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { uiFixture } from './ui-support.mjs';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// The CSP is style-src 'self'. A style attribute, setAttribute('style') and a <style> element are refused by the browser
// without a word, so a screen built with one looks right under the test harness and broken on a phone. Markup parsed
// from a string is the other way in, and nicknames are never HTML. setVar is the single door for a dynamic value.
test('the page styles itself only through styles.css and custom properties set by setVar: no style attribute, no parsed markup, no @import', async () => {
  for (const file of ['app.js', 'auth.js', 'sms-schedule.js']) {
    const js = await read(`../public/${file}`);
    for (const banned of [/setAttribute\(\s*['"`]style/, /\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /\.cssText\b/, /createElement\(\s*['"`]style/, /document\.write/]) {
      assert.ok(!banned.test(js), `${file} uses ${banned}`);
    }
  }
  const app = await read('../public/app.js');
  assert.match(app, /const setVar = \(n, k, v\) => n\.style\?\.setProperty\(k, v\);/);
  assert.deepEqual(app.match(/\.style\b/g), ['.style'], 'app.js touches .style only inside setVar');
  assert.ok(!/@import/.test(await read('../public/styles.css')), 'styles.css pulls nothing in');
});

// v2 had no masthead: a child's screens hide the parents' masthead and footer, the launch pad the masthead. The mode is
// set on <html> by every screen, so a parent screen opened from a child's grid (sign-in) shows them again.
test('the shell follows the role: a parent keeps the masthead, the launch pad hides it, a child\'s screens hide it and the footer', async (t) => {
  const h = await uiFixture(t); await h.f.child(h.a.ctx); await h.api.refresh();
  assert.equal(h.html.attrs['data-mode'], 'parent');
  await h.click('Hand over to kids'); assert.equal(h.html.attrs['data-mode'], 'select');
  await h.nodes('BUTTON').find((n) => n.className === 'player-card').onclick(); assert.equal(h.html.attrs['data-mode'], 'select', 'the PIN pane is the launch pad');
  h.nodes('INPUT')[0].value = '000000'; await h.click('Enter my grid');
  assert.ok(h.message.textContent.includes('did not match')); assert.equal(h.message.className, 'message msg-bad', 'a refusal reads in red');
  h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid'); assert.equal(h.html.attrs['data-mode'], 'kid');
  await h.click('Parent sign-in'); assert.equal(h.html.attrs['data-mode'], 'parent', 'sign-in opened from a child\'s grid is a parent screen');
  const css = await read('../public/styles.css');
  for (const rule of ['html[data-mode=kid] .masthead', 'html[data-mode=kid] footer', 'html[data-mode=select] .masthead', 'html[data-mode=select] footer']) assert.ok(css.includes(rule), rule); // the footer off the PIN pad too (QA, 12 Sep 2026)
});
