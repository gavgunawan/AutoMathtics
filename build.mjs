// Bundle src/ and assemble index.html — the single file GitHub Pages serves.
//   npm install && npm run build
// index.html = src/shell-head.html + minified bundle + src/shell-tail.html.
// The Firebase config lives in shell-head.html and is the only part you ever hand-edit.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const r = (...p) => path.join(root, ...p);

const out = await build({
  entryPoints: [r("src", "automathtics-entry.jsx")],
  bundle: true,
  minify: true,
  loader: { ".jsx": "jsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "eof",
  write: false,
  outfile: "bundle.js",
});

const head = fs.readFileSync(r("src", "shell-head.html"), "utf8");
const tail = fs.readFileSync(r("src", "shell-tail.html"), "utf8");
const bundle = out.outputFiles[0].text;

if (bundle.includes("</script>")) throw new Error("bundle contains </script> — it would close the tag early");

fs.writeFileSync(r("index.html"), head + bundle + "\n" + tail, "utf8");
console.log(`index.html written — ${(fs.statSync(r("index.html")).size / 1024).toFixed(0)} KB`);
