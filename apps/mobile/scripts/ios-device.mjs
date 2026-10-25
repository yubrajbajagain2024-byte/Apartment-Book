// `npm run ios:device [-- "<iPhone name>"]`: the app on your own iPhone, signed by a free Apple ID (Xcode's Personal
// Team). See README → "Your own iPhone, free". It builds with CAMPCONNECT_FREE_SIGNING=1 (app.config.js: its own bundle
// id, no Push Notifications entitlement), generates ios/ when it is missing or was made for the normal builds, keeps
// package.json exactly as it was (prebuild would rewrite its "ios" and "android" scripts), finds CocoaPods in your user
// gems, and hands over to `expo run:ios`, which builds, signs, installs and opens the app and runs Metro on port 8083.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJson = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const user = os.userInfo().username.toLowerCase().replace(/[^a-z0-9]/g, "") || "local";
const bundleId = process.env.CAMPCONNECT_BUNDLE_ID || `${appJson.expo.ios.bundleIdentifier}.${user}`;

// CocoaPods from `gem install --user-install` lives in ~/.gem/ruby/<version>/bin.
const gemRoot = path.join(os.homedir(), ".gem", "ruby");
const gemBins = fs.existsSync(gemRoot) ? fs.readdirSync(gemRoot).map((v) => path.join(gemRoot, v, "bin")).filter((d) => fs.existsSync(path.join(d, "pod"))) : [];
const env = { ...process.env, CAMPCONNECT_FREE_SIGNING: "1", LANG: process.env.LANG || "en_US.UTF-8", PATH: [...gemBins, process.env.PATH].join(path.delimiter) };
if (spawnSync("pod", ["--version"], { env, stdio: "ignore" }).status !== 0) {
  console.error("CocoaPods isn't installed: see README → \"Your own iPhone, free\", step 1.");
  process.exit(1);
}

const run = (args) => spawnSync("npx", args, { cwd: root, env, stdio: "inherit" }).status ?? 1;

const ios = path.join(root, "ios");
const pbxproj = path.join(ios, `${appJson.expo.name.replace(/[^A-Za-z0-9]/g, "")}.xcodeproj`, "project.pbxproj");
const madeForFreeSigning = fs.existsSync(pbxproj) && fs.readFileSync(pbxproj, "utf8").includes(`PRODUCT_BUNDLE_IDENTIFIER = ${bundleId};`);
// The config ios/ was last made from: when app.json or app.config.js changes (a permission text, a plugin), prebuild
// runs again so the native project carries the change; `expo run:ios` alone never re-applies the config.
const configHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "app.json"))).update(fs.readFileSync(path.join(root, "app.config.js"))).digest("hex");
const configStamp = path.join(ios, ".campconnect-config-hash");
const configApplied = fs.existsSync(configStamp) && fs.readFileSync(configStamp, "utf8").trim() === configHash;
if (!madeForFreeSigning || !configApplied) {
  const pkgPath = path.join(root, "package.json");
  const pkg = fs.readFileSync(pkgPath, "utf8");
  const clean = fs.existsSync(ios) && !madeForFreeSigning;
  console.log(!fs.existsSync(ios) ? "Making ios/ for free signing…" : clean ? "ios/ was made for the normal builds: making it again for free signing…" : "The app's config changed since ios/ was made: applying it…");
  // Prebuild recreates ios/ by default; when only the config changed, --no-clean updates it in place, so Xcode keeps
  // its incremental build.
  const status = run(["expo", "prebuild", "--platform", "ios", ...(fs.existsSync(ios) && !clean ? ["--no-clean"] : [])]);
  if (fs.readFileSync(pkgPath, "utf8") !== pkg) fs.writeFileSync(pkgPath, pkg);
  if (status !== 0) process.exit(status);
  fs.writeFileSync(configStamp, `${configHash}\n`);
}

// Xcode 26's Swift (6.2) refuses SWIFT_RETURNS_RETAINED on the constructors of a SWIFT_SHARED_REFERENCE class, which
// expo-modules-jsi puts on RuntimeScheduler's for Xcode 27 (its changelog, #49120). That Swift already treats such a
// constructor as returning a retained object, which is all the annotation says (measured: one release and one delete
// per object, no extra retain), so on a Swift that refuses it the local copy of the header goes without. node_modules
// only: EAS and newer Xcodes build the package as published.
function swiftRefusesConstructorAnnotation() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frt-probe-"));
  try {
    fs.writeFileSync(path.join(dir, "probe.h"), "#pragma once\n#include <atomic>\n#include <swift/bridging>\nclass Probe {\n  std::atomic<int> refCount{1};\npublic:\n  SWIFT_RETURNS_RETAINED Probe() {}\n  Probe(const Probe &) = delete;\n  void retain() { refCount.fetch_add(1); }\n  void release() { if (refCount.fetch_sub(1) == 1) delete this; }\n} SWIFT_SHARED_REFERENCE(retainProbe, releaseProbe);\ninline void retainProbe(Probe *p) { p->retain(); }\ninline void releaseProbe(Probe *p) { p->release(); }\n");
    fs.writeFileSync(path.join(dir, "module.modulemap"), 'module Probe {\n  header "probe.h"\n  requires cplusplus\n  export *\n}\n');
    fs.writeFileSync(path.join(dir, "main.swift"), "import Probe\nlet p = Probe()\n_ = p\n");
    const r = spawnSync("xcrun", ["swiftc", "-typecheck", "-cxx-interoperability-mode=default", "-I", dir, path.join(dir, "main.swift")], { encoding: "utf8" });
    return r.status !== 0 && /cannot be annotated with either SWIFT_RETURNS_RETAINED/.test(`${r.stderr}${r.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const schedulerHeader = path.join(path.dirname(fileURLToPath(import.meta.resolve("expo-modules-jsi/package.json", `file://${root}/`))), "apple", "Sources", "ExpoModulesJSI-Cxx", "include", "RuntimeScheduler.h");
if (fs.existsSync(schedulerHeader)) {
  const header = fs.readFileSync(schedulerHeader, "utf8");
  const annotated = /SWIFT_RETURNS_RETAINED (RuntimeScheduler\()/g;
  if (annotated.test(header) && swiftRefusesConstructorAnnotation()) {
    fs.writeFileSync(schedulerHeader, header.replace(annotated, "$1"));
    console.log("This Xcode's Swift refuses expo-modules-jsi's constructor annotations: using the header without them (node_modules only).");
  }
}

// Swift 6.2 also fails to honour `nonisolated(unsafe)` on a local captured by a closure that is sent to another
// isolation domain ("sending 'resultPtr' risks causing data races"); SDK 57 relies on newer Swift there, and Expo works
// around the same Swift 6.2.3 bug elsewhere with its own Sendable wrappers. On Swift 6.2 the local copy carries those
// values in such a wrapper instead: the same pointer or the same weak reference, for the same reasons the files'
// comments give for why the capture is sound. Each file is changed only when every line it touches is found exactly
// as published, and only once.
const swiftVersion = spawnSync("xcrun", ["swiftc", "--version"], { encoding: "utf8" }).stdout ?? "";
const expoModulesCore = path.dirname(fileURLToPath(import.meta.resolve("expo-modules-core/package.json", `file://${root}/`)));
const swift62Fixes = [
  {
    // Three call-scoped pointers into the synchronous `JavaScriptActor.assumeIsolated` closures: an @unchecked Sendable
    // struct, so no allocation is added on the host-function call path the file's comments keep allocation-free.
    file: path.join(path.dirname(schedulerHeader), "..", "..", "ExpoModulesJSI", "Runtime", "JavaScriptRuntime.swift"),
    marker: "Swift62SendableBox",
    edits: [
      ["nonisolated(unsafe) let resultPtr = resultPtr", "let resultPtr = Swift62SendableBox(resultPtr)", 3],
      ["nonisolated(unsafe) let thisPtr = thisPtr", "let thisPtr = Swift62SendableBox(thisPtr)", 2],
      ["nonisolated(unsafe) let argumentsPtr = argumentsPtr", "let argumentsPtr = Swift62SendableBox(argumentsPtr)", 2],
      ["writeJSIValue(to: resultPtr)", "writeJSIValue(to: resultPtr.value)", 3],
      ["UnsafeMutablePointer(mutating: thisPtr).move()", "UnsafeMutablePointer(mutating: thisPtr.value).move()", 1],
      ["start: argumentsPtr, count: argumentsCount)", "start: argumentsPtr.value, count: argumentsCount)", 2],
      ["JavaScriptUnownedValue(runtime.pointee, thisPtr)", "JavaScriptUnownedValue(runtime.pointee, thisPtr.value)", 1],
    ],
    append: "\n/** Local Xcode 26 build only (apps/mobile/scripts/ios-device.mjs): carries a call-scoped pointer into a synchronous closure. */\ninternal struct Swift62SendableBox<Value>: @unchecked Sendable {\n  let value: Value\n  init(_ value: Value) { self.value = value }\n}\n",
  },
  {
    // The emitter, weakly, into the closure scheduled on the JS runtime: the module's own NonisolatedUnsafeWeakVar.
    file: path.join(expoModulesCore, "ios", "Core", "Events", "EventEmitter.swift"),
    marker: "NonisolatedUnsafeWeakVar(self)",
    edits: [
      ["nonisolated(unsafe) weak let emitter = self", "let emitterRef = NonisolatedUnsafeWeakVar(self)", 2],
      ["guard let emitter else {", "guard let emitter = emitterRef.value else {", 1],
      ["guard let emitter, let appContext else {", "guard let emitter = emitterRef.value, let appContext else {", 1],
    ],
  },
];
if (/Swift version 6\.2\./.test(swiftVersion)) {
  for (const fix of swift62Fixes) {
    if (!fs.existsSync(fix.file)) continue;
    let source = fs.readFileSync(fix.file, "utf8");
    const count = (text) => source.split(text).length - 1;
    if (source.includes(fix.marker) || !fix.edits.every(([from, , n]) => count(from) === n)) continue;
    for (const [from, to] of fix.edits) source = source.split(from).join(to);
    fs.writeFileSync(fix.file, source + (fix.append ?? ""));
    console.log(`Swift 6.2: adapted ${path.relative(path.join(root, "..", ".."), fix.file)} (node_modules only).`);
  }
}

// A space in the project's path ("Apartment Book 3") breaks four build scripts that run a path unquoted; EAS builds in a
// folder without spaces and never meets them. Locally they get the quotes: the expo-constants and expo-updates script
// phases (`bash -l -c "<path>"` splits the path inside the -c string; their podspecs, so `pod install` regenerates the
// phases), expo-constants' `basename $PROJECT_DIR`, and the app's "Bundle React Native code and images" phase, which runs
// a path printed by Node through an unquoted command substitution (ios/, regenerated by prebuild). Exact text only.
function applyExact(file, edits) {
  if (!fs.existsSync(file)) return false;
  let source = fs.readFileSync(file, "utf8");
  const count = (text) => source.split(text).length - 1;
  if (!edits.every(([from, , n]) => count(from) === n)) return false;
  for (const [from, to] of edits) source = source.split(from).join(to);
  fs.writeFileSync(file, source);
  console.log(`Path with spaces: quoted ${path.relative(path.join(root, "..", ".."), file)}.`);
  return true;
}
if (/\s/.test(root)) {
  const resolvePackage = (name) => path.dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`, `file://${root}/`)));
  const constants = resolvePackage("expo-constants");
  const updates = resolvePackage("expo-updates");
  applyExact(path.join(constants, "ios", "EXConstants.podspec"), [
    ['"bash -l -c \\"#{env_vars}$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\""', '"bash -l -c \\"#{env_vars}\\\\\\"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\\\\\"\\""', 1],
  ]);
  applyExact(path.join(constants, "scripts", "get-app-config-ios.sh"), [["PROJECT_DIR_BASENAME=$(basename $PROJECT_DIR)", 'PROJECT_DIR_BASENAME=$(basename "$PROJECT_DIR")', 1]]);
  applyExact(path.join(updates, "ios", "EXUpdates.podspec"), [
    [`'bash -l -c "$PODS_TARGET_SRCROOT/../scripts/create-updates-resources-ios.sh"'`, `'bash -l -c "\\"$PODS_TARGET_SRCROOT/../scripts/create-updates-resources-ios.sh\\""'`, 1],
  ]);
  const printed = "\\\"$NODE_BINARY\\\" --print \\\"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\\\"";
  applyExact(pbxproj, [["`" + printed + "`", "\\\"$(" + printed + ")\\\"", 1]]);
  const podsProject = path.join(ios, "Pods", "Pods.xcodeproj", "project.pbxproj");
  const stalePhases = ["-c \\\"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh", "-c \\\"$PODS_TARGET_SRCROOT/../scripts/create-updates-resources-ios.sh"];
  if (fs.existsSync(podsProject) && stalePhases.some((p) => fs.readFileSync(podsProject, "utf8").includes(p))) {
    console.log("Regenerating the Pods project with the quoted script phases…");
    const status = spawnSync("pod", ["install"], { cwd: ios, env, stdio: "inherit" }).status ?? 1;
    if (status !== 0) process.exit(status);
  }
}

if (process.env.IOS_DEVICE_PREPARE_ONLY === "1") process.exit(0);
const device = process.argv.slice(2).join(" ").trim();
process.exit(run(["expo", "run:ios", "--port", "8083", "--device", ...(device ? [device] : [])]));
