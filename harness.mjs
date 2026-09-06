// Dev harness — the same app with the Firebase config stripped and the PIN gate off, so the UI can
// be poked at without touching the kids' live data. Builds test-harness.html (gitignored) and serves
// it:  node harness.mjs  ->  http://localhost:5174
// Seed a state from the browser console, e.g.
//   localStorage.setItem('kumon-progress:geralt', JSON.stringify({ level: 1, paper: 61, bossCleared: 3, history: [], wallet: {...} }))
import { build } from "esbuild";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const r = (...p) => path.join(root, ...p);
const tmp = r("node_modules", ".harness");
fs.mkdirSync(tmp, { recursive: true });

const gate = "if (u.test) { enterAs(u, p); return; } // sandbox has no PIN";
let src = fs.readFileSync(r("src", "automathtics-src.jsx"), "utf8");
if (!src.includes(gate)) throw new Error("PIN-gate anchor not found — harness.mjs needs updating");
src = src.replace(gate, "if (true) { enterAs(u, p); return; } // HARNESS: PIN gate off");
// the admin gate too — the harness is local-only, so there is nothing behind it to protect
const adminGate = "if (pin === ADMIN_PIN) {";
if (!src.includes(adminGate)) throw new Error("admin-gate anchor not found — harness.mjs needs updating");
src = src.replace(adminGate, "if (pin === ADMIN_PIN || pin === \"\") { // HARNESS: an empty PIN opens the gate; a wrong one still exercises the fail path");
// expose the current question so a scripted test can answer word problems it can't parse from the DOM
const qAnchor = "  const q = qs[qIdx];\n  const curPaper = q ? q.paper : startPaper;"; // the render-scope one, not record()'s
if (!src.includes(qAnchor)) throw new Error("question anchor not found — harness.mjs needs updating");
src = src.replace(qAnchor, qAnchor + "\n  if (typeof document !== \"undefined\") document.documentElement.setAttribute(\"data-q\", q ? JSON.stringify({ t: q.answer.type, v: q.answer.v }) : \"\"); // HARNESS");
fs.writeFileSync(path.join(tmp, "automathtics-src.jsx"), src, "utf8");
fs.copyFileSync(r("src", "automathtics-entry.jsx"), path.join(tmp, "automathtics-entry.jsx"));
fs.copyFileSync(r("src", "navigator.js"), path.join(tmp, "navigator.js"));

const out = await build({
  entryPoints: [path.join(tmp, "automathtics-entry.jsx")],
  bundle: true, minify: false, loader: { ".jsx": "jsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  write: false, outfile: "b.js",
});

let head = fs.readFileSync(r("src", "shell-head.html"), "utf8");
head = head.replace(/<script>\s*\/\* FIREBASE CONFIG[\s\S]*?<\/script>/, "<!-- harness: Firebase config intentionally absent -->");
if (head.includes("KUMON_FIREBASE_CONFIG =")) throw new Error("Firebase config still present in harness shell");

const html = head + out.outputFiles[0].text + "\n" + fs.readFileSync(r("src", "shell-tail.html"), "utf8");
fs.writeFileSync(r("test-harness.html"), html, "utf8");
console.log("test-harness.html built — local-only, no cloud");

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(r("test-harness.html")));
  })
  .listen(5174, () => console.log("harness: http://localhost:5174"));
