// Copy the web app into src-tauri/web/, the folder Tauri bundles. Runs before
// every Tauri build, so the Android app is always built from the current web app.
//
// Every top-level entry of the repo must be listed below as web (packaged) or
// not web (left out). A new entry stops the build until someone classifies it,
// so a web change can never silently miss the Android app, and nothing private
// can silently reach it.
import { cpSync, rmSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = ["index.html", "css", "js", "vendor", "data"];
const NOT_WEB = [".git", ".gitattributes", ".gitignore", "src-tauri", "README.md", "LICENSE"];

const tauriDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(tauriDir, "..");
const out = join(tauriDir, "web");

const unknown = readdirSync(root).filter((e) => !WEB.includes(e) && !NOT_WEB.includes(e));
if (unknown.length) {
  throw new Error(`stage-web: classify ${unknown.join(", ")} as WEB or NOT_WEB in src-tauri/scripts/stage-web.mjs`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const item of WEB) cpSync(join(root, item), join(out, item), { recursive: true });

// The page may load local store data from outside the repo (`src="../..."`).
// The app has no such files, and Tauri answers a missing file with index.html,
// which fails to parse as a script. Drop those tags from the packaged copy, so
// local store data can never reach the app.
const page = join(out, "index.html");
const lines = readFileSync(page, "utf8").split("\n");
const kept = lines.filter((line) => !/src="\.\.\//.test(line));
writeFileSync(page, kept.join("\n"));
console.log(`staged ${WEB.join(", ")} into src-tauri/web (dropped ${lines.length - kept.length} tag(s) loading files from outside the repo)`);
