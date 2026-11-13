# Alpha on Android (Tauri 2)

The web app at the repo root, wrapped as an Android app with Tauri 2. One codebase: the web files are bundled as they are, and everything Android-specific lives under `src-tauri/`.

## What is bundled

Before each build, `scripts/stage-web.mjs` copies `index.html`, `css/`, `js/`, `vendor/` and `data/` into `src-tauri/web/` (git-ignored), and Tauri packages that folder. Nothing else in the repo goes into the app.

`index.html` also tries `../data/real/store.js`, real store data that sits beside a local checkout. The staging script removes that one tag from the packaged copy, so real store data can never be loaded by the app. (Tauri answers a missing file with `index.html`, so the web page's own "drop the tag if missing" would not fire.)

## Toolchain

| Piece | Version used | Notes |
|---|---|---|
| Tauri CLI | 2.12.4 | `npx @tauri-apps/cli@2`, no install needed |
| Rust | 1.99 stable | targets `aarch64-linux-android` (phones) and `x86_64-linux-android` (emulator); `tauri android init` also adds `armv7-linux-androideabi` and `i686-linux-android` |
| Android SDK | platform 37 | the Gradle build installs it on first run (`compileSdk = 37`) |
| Android NDK | r29 (29.0.14206865) | install with `sdkmanager --package_file=<file>` holding `ndk;29.0.14206865`; on Windows the `.bat` splits a `;` in a plain argument |
| JDK | 21 | |
| Node | any recent | for the CLI and the two scripts |

Environment for every command below: `JAVA_HOME` (the JDK), `ANDROID_HOME` (the SDK), `NDK_HOME` (the NDK folder inside the SDK).

## Build

From the repo root, on Windows without Developer Mode (the usual case):

```
node src-tauri/scripts/android-build.mjs            # debug APK, arm64 + x86_64
node src-tauri/scripts/android-build.mjs --release  # release (unsigned; see Open items)
```

`tauri android build` compiles the Rust library and then symlinks it into the Android project, and Windows refuses symlinks without Developer Mode. The script lets Tauri compile each target, copies the library in instead, and runs Gradle with Tauri's Rust tasks skipped. With Developer Mode on, or on macOS or Linux, the plain command works:

```
npx @tauri-apps/cli@2 android build --debug --apk --target aarch64 x86_64
```

The APK lands in `src-tauri/gen/android/app/build/outputs/apk/universal/debug/`. A debug APK is about 270 MB, because the Rust libraries keep their debug symbols. A first build compiles a few hundred Rust crates per target and needs several GB of free disk for `src-tauri/target/`.

To regenerate the Android project from scratch: `npx @tauri-apps/cli@2 android init`. That overwrites `gen/android/`, including the insets change in `MainActivity.kt`.

## Install and run

```
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n org.example.alpha.debug/org.example.alpha.MainActivity
```

## Android-side changes

- `MainActivity.kt` pads the web view by the system bars, display cutout and keyboard. Android 15+ draws apps edge to edge, and without this the header sits under the status bar and the keyboard covers the results.

## Tested

Emulator, Android 16 (API 36), x86_64:
- installs and launches;
- loads the simulated-stock store with no console errors;
- search for `atorva 40` lists 6 matches;
- choosing one shows its place (robot P) and highlights it on the floor map;
- the keyboard no longer covers the results.

Not tested: a real phone (the arm64 build), a release build.

## Open items

- **App id** `org.example.alpha` is a placeholder. It has to change before any store release, and it can't change after one.
- **Icons** are Tauri's defaults.
- **CSP** is off (`"csp": null`), matching the web app today.
- **Release builds** need a signing key, which is not set up.
- **Phone layout** is the web app's own. On a phone-width screen the floor map is wider than the screen. That belongs to the shared web files, not the shell.
