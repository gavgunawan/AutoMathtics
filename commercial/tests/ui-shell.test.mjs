// The page shell of the v2 look, and the rule every screen of it is built under (port plan, sections 0 and 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
