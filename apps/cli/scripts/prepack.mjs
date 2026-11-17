// Copies the root README and LICENSE into the package before it's packed, with
// links made absolute so images and docs work on npmjs.com.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const repo = "https://github.com/InsaneArts/http-render";
const raw = "https://raw.githubusercontent.com/InsaneArts/http-render/main";

const readme = readFileSync(new URL("README.md", root), "utf8")
  .replace(/(src|srcset)="assets\//g, `$1="${raw}/assets/`)
  .replace(/\]\(assets\//g, `](${raw}/assets/`)
  .replace(/\]\((LICENSE|CONTRIBUTING\.md|SECURITY\.md)\)/g, `](${repo}/blob/main/$1)`)
  .replace(/href="LICENSE"/g, `href="${repo}/blob/main/LICENSE"`);

writeFileSync(new URL("../README.md", import.meta.url), readme);
copyFileSync(new URL("LICENSE", root), new URL("../LICENSE", import.meta.url));
