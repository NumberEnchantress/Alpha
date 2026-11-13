// Build the Android APK on Windows without symlink rights.
//
// `tauri android build` compiles the Rust library, then symlinks it into the
// Android project. Windows refuses symlinks unless Developer Mode is on, so the
// build stops there. This script lets Tauri compile each target, copies the
// library in instead, and runs Gradle with Tauri's own Rust tasks skipped.
// With Developer Mode on, plain `tauri android build` works and this is not needed.
//
// Usage, from the repo root:  node src-tauri/scripts/android-build.mjs [--release]
// Needs JAVA_HOME, ANDROID_HOME and NDK_HOME (see src-tauri/ANDROID.md).
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const release = process.argv.includes("--release");
const profile = release ? "release" : "debug";
const Profile = release ? "Release" : "Debug";
const tauriDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(tauriDir, "..");
const android = join(tauriDir, "gen", "android");
const targets = [
  { rust: "aarch64", triple: "aarch64-linux-android", abi: "arm64-v8a", arch: "arm64" },
  { rust: "x86_64", triple: "x86_64-linux-android", abi: "x86_64", arch: "x86_64" },
];

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: true });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  return r;
}

for (const t of targets) {
  const started = Date.now();
  const args = ["--yes", "@tauri-apps/cli@2", "android", "build", "--apk", "--ci", "--target", t.rust];
  if (!release) args.push("--debug");
  const r = run("npx", args, root);
  const lib = join(tauriDir, "target", t.triple, profile, "libalpha_lib.so");
  let fresh = false;
  try {
    fresh = statSync(lib).mtimeMs >= started - 1000;
  } catch {}
  const symlinkOnly = /symbolic link/i.test((r.stdout ?? "") + (r.stderr ?? ""));
  if (r.status !== 0 && !(symlinkOnly && fresh)) {
    console.error(`Rust build for ${t.rust} failed for a reason other than the symlink; stopping.`);
    process.exit(1);
  }
  const dest = join(android, "app", "src", "main", "jniLibs", t.abi);
  mkdirSync(dest, { recursive: true });
  copyFileSync(lib, join(dest, "libalpha_lib.so"));
  console.log(`copied ${t.triple}/${profile}/libalpha_lib.so into jniLibs/${t.abi}`);
}

const gradle = `"${join(android, process.platform === "win32" ? "gradlew.bat" : "gradlew")}"`;
const skip = ["Universal", ...targets.map((t) => t.arch.replace(/^./, (c) => c.toUpperCase()))]
  .flatMap((a) => ["-x", `rustBuild${a}${Profile}`]);
const g = run(gradle, [
  `assembleUniversal${Profile}`,
  `-PabiList=${targets.map((t) => t.abi).join(",")}`,
  `-ParchList=${targets.map((t) => t.arch).join(",")}`,
  `-PtargetList=${targets.map((t) => t.rust).join(",")}`,
  ...skip, "--console=plain",
], android);
if (g.status !== 0) process.exit(g.status ?? 1);
console.log(`APK: src-tauri/gen/android/app/build/outputs/apk/universal/${profile}/`);
