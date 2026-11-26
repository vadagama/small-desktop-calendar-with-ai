import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "release/wails-macos-stage" },
    release: { type: "boolean", default: false },
    notes: { type: "string" },
  },
});
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("Wails packaging requires macOS on Apple Silicon");

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
const load = async (file) => JSON.parse(await readFile(file, "utf8"));
const pkg = await load("package.json");
const productName = "Ordo";
const iconName = "ordo.icns";
const version = pkg.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error("Invalid application version");
const osVersion = version.split("-")[0];
const releasing = values.release;
const identity = releasing ? process.env.SMALL_SIGN_IDENTITY : "-";
const team = releasing ? process.env.SMALL_WAILS_UPDATE_TEAM : "";
const notary = releasing ? process.env.SMALL_NOTARY_PROFILE : "";
let signingKey;
let publicKey = "";
if (releasing) {
  if (
    version !== osVersion ||
    !identity?.startsWith("Developer ID Application:") ||
    !/^[A-Z0-9]{10}$/.test(team ?? "") ||
    !notary ||
    !process.env.SMALL_WAILS_UPDATE_KEY_FILE
  )
    throw new Error(
      "Stable version, Developer ID, team ID, notary profile and Ed25519 key file required",
    );
  signingKey = createPrivateKey(
    await readFile(process.env.SMALL_WAILS_UPDATE_KEY_FILE),
  );
  if (signingKey.asymmetricKeyType !== "ed25519")
    throw new Error("Update key must use Ed25519");
  const jwk = createPublicKey(signingKey).export({ format: "jwk" });
  publicKey = Buffer.from(jwk.x, "base64url").toString("base64");
}
const whisper = "native/voice";
const engine = await load(join(whisper, "version.json"));
if (
  engine.revision !== "2eeeba56e9edd762b4b38467bab96c2517163158" ||
  engine.arch !== "arm64"
)
  throw new Error(
    "Run npm run voice:build to prepare the pinned Whisper engine",
  );

const out = resolve(values.out);
await mkdir(out, { recursive: true });
const work = await mkdtemp(join(tmpdir(), "small-wails-package-"));
let complete = false;
try {
  const source = join(work, "image");
  const appName = `${productName}.app`;
  const app = join(source, appName);
  const contents = join(app, "Contents");
  const resources = join(contents, "Resources");
  const bin = join(contents, "MacOS", "small-calendar");
  await mkdir(join(contents, "MacOS"), { recursive: true });
  await mkdir(resources);
  await cp(whisper, join(resources, "voice"), {
    recursive: true,
    filter: (path) =>
      path === whisper ||
      ["whisper-cli", "version.json", "LICENSE.whisper.cpp"].includes(
        path.split("/").at(-1),
      ),
  });
  await copyFile(process.execPath, join(resources, "node"));
  await chmod(join(resources, "node"), 0o755);
  await copyFile(join("build", iconName), join(resources, iconName));
  const info = {
    // Older preview bundles still registered with Launch Services lack the Ordo icon.
    CFBundleIdentifier: releasing
      ? "kz.small.desktop-calendar.wails"
      : "kz.small.ordo.preview",
    CFBundleName: productName,
    CFBundleDisplayName: productName,
    CFBundleExecutable: "small-calendar",
    CFBundlePackageType: "APPL",
    CFBundleVersion: osVersion,
    CFBundleShortVersionString: osVersion,
    CFBundleIconFile: iconName,
    LSMinimumSystemVersion: "15.1",
    NSMicrophoneUsageDescription:
      "Микрофон используется для локального голосового ввода в календаре.",
  };
  const plist = async (path, value) => {
    await writeFile(path, JSON.stringify(value));
    run("/usr/bin/plutil", ["-convert", "xml1", path]);
  };
  await plist(join(contents, "Info.plist"), info);
  run(
    "go",
    [
      "-C",
      "desktop-wails",
      "build",
      "-trimpath",
      `-ldflags=-s -w -X=main.buildVersion=${version} -X=main.updatePublicKey=${publicKey} -X=main.updateTeam=${team}`,
      "-o",
      bin,
      ".",
    ],
    { env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: "15.1" } },
  );

  const audio = join(work, "audio.plist");
  const jit = join(work, "jit.plist");
  await plist(audio, { "com.apple.security.device.audio-input": true });
  await plist(jit, { "com.apple.security.cs.allow-jit": true });
  function signBundle(path, entitlement) {
    run("/usr/bin/codesign", [
      "--force",
      "--sign",
      identity,
      ...(releasing ? ["--options", "runtime", "--timestamp"] : []),
      ...(entitlement ? ["--entitlements", entitlement] : []),
      path,
    ]);
  }
  signBundle(join(resources, "node"), jit);
  signBundle(join(resources, "voice", "whisper-cli"));
  signBundle(app, audio);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);

  const profile = await mkdtemp(join(work, "smoke-"));
  run(bin, ["-smoke", "-user-data-dir", profile], {
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      SMALL_WAILS_EXPECT_VOICE: "1",
    },
  });

  // Installed versions validate this exact update archive name.
  const archive = `Small-Calendar-Wails-${version}-arm64.zip`;
  const zip = join(work, archive);
  const zipApp = () =>
    run("/usr/bin/zip", ["-qry", "-y", zip, appName], { cwd: source });
  const notarize = (path) =>
    run("/usr/bin/xcrun", [
      "notarytool",
      "submit",
      path,
      "--no-s3-acceleration",
      "--keychain-profile",
      notary,
      "--wait",
    ]);
  const staple = (path) => {
    run("/usr/bin/xcrun", ["stapler", "staple", path]);
    run("/usr/bin/xcrun", ["stapler", "validate", path]);
  };
  if (releasing) {
    zipApp();
    notarize(zip);
    staple(app);
    await rm(zip);
    zipApp();
  }
  const files = await readdir(resources);
  if (files.some((file) => file.startsWith(".env")))
    throw new Error("Unexpected environment file in package");
  await symlink("/Applications", join(source, "Applications"));
  const name = `${productName}-${version}-arm64${releasing ? "" : "-local"}.dmg`;
  const dmg = join(work, name);
  run("/usr/bin/hdiutil", [
    "create",
    "-format",
    "UDZO",
    "-volname",
    productName,
    "-srcfolder",
    source,
    dmg,
  ]);
  if (releasing) {
    signBundle(dmg);
    notarize(dmg);
    staple(dmg);
  }
  run("/usr/bin/hdiutil", ["verify", dmg]);
  await copyFile(dmg, join(out, name));
  if (releasing) {
    const notes = values.notes ? await readFile(values.notes, "utf8") : "";
    if (Buffer.byteLength(notes) > 32 * 1024)
      throw new Error("Release notes exceed update manifest limit");
    const payload = await readFile(zip);
    const digest = createHash("sha256").update(payload).digest();
    const signature = sign(null, digest, signingKey);
    await copyFile(zip, join(out, archive));
    const manifest = {
      schemaVersion: 1,
      version,
      channel: "stable",
      name: productName,
      notes,
      artifacts: [
        {
          platform: "darwin",
          arch: "arm64",
          filetype: "zip",
          filename: archive,
          size: payload.length,
          url: `https://github.com/vadagama/small-desktop-calendar-with-ai/releases/download/v${version}/${archive}`,
          digestAlgo: "sha256",
          digest: digest.toString("base64"),
          signatureAlgo: "ed25519",
          signature: signature.toString("base64"),
        },
      ],
    };
    await writeFile(
      join(out, "latest-wails-mac.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  }
  complete = true;
  console.log(join(out, name));
} finally {
  if (complete || !releasing) await rm(work, { recursive: true, force: true });
  else console.error(`Preserved signed packaging work for recovery: ${work}`);
}
