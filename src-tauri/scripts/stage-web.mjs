// Copy the web app into src-tauri/web/, the folder Tauri bundles.
// Only these items are packaged; anything else in the repo (and real store
// data outside it) never reaches the app. Runs before every Tauri build.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tauriDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(tauriDir, "..");
const out = join(tauriDir, "web");
const items = ["index.html", "css", "js", "vendor", "data"];

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const item of items) cpSync(join(root, item), join(out, item), { recursive: true });

// The web page tries ../data/real/store.js, which exists only beside a local
// checkout. The app has no such file, and Tauri answers a missing file with
// index.html, which fails to parse as a script. Drop the tag from the copy.
const page = join(out, "index.html");
const html = readFileSync(page, "utf8");
const kept = html.split("\n").filter((line) => !line.includes("data/real/store.js"));
if (kept.length !== html.split("\n").length - 1) throw new Error("expected exactly one data/real/store.js tag in index.html");
writeFileSync(page, kept.join("\n"));
console.log(`staged ${items.join(", ")} into src-tauri/web (without the local real-store tag)`);
