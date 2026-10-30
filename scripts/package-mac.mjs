import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { inspectArchive } from "./check-package.mjs";
import { hardenElectron, verifyFuses } from "./electron-fuses.mjs";
const { values } = parseArgs({
  options: {
    "local-sign": { type: "boolean" },
    "release-sign": { type: "boolean" },
    hardened: { type: "boolean" },
    out: { type: "string", default: "release" },
  },
});
const local = values["local-sign"];
const release = values["release-sign"];
const hardened = values.hardened || release;
if (local && release)
  throw new Error("Choose local-sign or release-sign, not both");
if (hardened && !local && !release)
  throw new Error("Hardened builds must be signed");
const identity = process.env.SMALL_SIGN_IDENTITY;
const keychainProfile = process.env.SMALL_NOTARY_PROFILE;
if (
  release &&
  (!identity?.startsWith("Developer ID Application:") || !keychainProfile)
)
  throw new Error(
    "Release requires SMALL_SIGN_IDENTITY (Developer ID Application) and SMALL_NOTARY_PROFILE",
  );
if (process.platform !== "darwin")
  throw new Error("macOS packaging must run on macOS.");
const paths = await packager({
  dir: ".",
  name: "Small Calendar",
  appBundleId: "kz.small.desktop-calendar",
  platform: "darwin",
  arch: "arm64",
  out: values.out,
  asar: true,
  overwrite: true,
  icon: "build/app.icns",
  ...(hardened
    ? {
        afterExtract: [
          async ({ buildPath }) => {
            await hardenElectron(join(buildPath, "Electron.app"));
          },
        ],
      }
    : {}),
  ignore: [
    /^\/(?!out(\/|$)|package\.json$|node_modules(\/|$))/,
    /\/(?:\.vite|\.cache|\.git|\.bin|test-results|playwright-report)(?:\/|$)/,
  ],
  ...(local
    ? {
        osxSign: {
          identity: "-",
          identityValidation: false,
          preAutoEntitlements: false,
          preEmbedProvisioningProfile: false,
          gatekeeperAssess: false,
          optionsForFile: () => ({ hardenedRuntime: false }),
        },
      }
    : release
      ? {
          osxSign: {
            identity,
            optionsForFile: () => ({ hardenedRuntime: true }),
          },
          osxNotarize: { keychainProfile },
        }
      : {}),
});
for (const path of paths) {
  const app = join(path, "Small Calendar.app");
  inspectArchive(join(app, "Contents/Resources/app.asar"));
  if (hardened) await verifyFuses(app);
  if (local || release)
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
      stdio: "inherit",
    });
  if (release) {
    execFileSync("xcrun", ["stapler", "validate", app], { stdio: "inherit" });
    execFileSync("spctl", ["--assess", "--type", "execute", app], {
      stdio: "inherit",
    });
  }
  console.log(
    `${local ? "Locally signed (not for distribution)" : release ? "Signed and notarized" : "Unsigned"}: ${app}`,
  );
}
