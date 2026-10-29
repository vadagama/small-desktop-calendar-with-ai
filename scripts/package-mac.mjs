import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const local = process.argv.includes("--local-sign");
if (process.platform !== "darwin")
  throw new Error("macOS packaging must run on macOS.");
const paths = await packager({
  dir: ".",
  name: "Small Calendar",
  appBundleId: "kz.small.desktop-calendar",
  platform: "darwin",
  arch: "arm64",
  out: "release",
  asar: true,
  overwrite: true,
  icon: "build/app.icns",
  ignore: /^\/(?!out(\/|$)|package\.json$|node_modules(\/|$))/,
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
    : {}),
});
for (const path of paths) {
  const app = join(path, "Small Calendar.app");
  if (local)
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
      stdio: "inherit",
    });
  console.log(
    `${local ? "Locally signed (not for distribution)" : "Unsigned"}: ${app}`,
  );
}
