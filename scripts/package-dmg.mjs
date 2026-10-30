import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.platform !== "darwin")
  throw new Error("DMG packaging requires macOS.");
const run = (command, args) =>
  execFileSync(command, args, { stdio: "inherit" });
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const app = resolve("release/Small Calendar-darwin-arm64/Small Calendar.app");
const info = await readFile(join(app, "Contents/Info.plist"), "utf8");
if (!info.includes("kz.small.desktop-calendar"))
  throw new Error("Unexpected app bundle.");
run("codesign", ["--verify", "--deep", "--strict", app]);
const work = await mkdtemp(join(tmpdir(), "small-calendar-dmg-"));
const stage = join(work, "stage");
const mount = join(work, "volume");
const image = join(work, "installer.dmg");
const output = resolve(`release/Small-Calendar-${version}-arm64-local.dmg`);
let attached = false;
try {
  await mkdir(join(stage, ".background"), { recursive: true });
  run("ditto", [app, join(stage, "Small Calendar.app")]);
  await symlink("/Applications", join(stage, "Applications"));
  const backgroundTool = join(work, "dmg-background");
  run("clang", [
    "-fobjc-arc",
    "-framework",
    "AppKit",
    "scripts/dmg-background.m",
    "-o",
    backgroundTool,
  ]);
  run(backgroundTool, [join(stage, ".background/background.png")]);
  run("hdiutil", [
    "create",
    "-srcfolder",
    stage,
    "-volname",
    "Small Calendar",
    "-fs",
    "HFS+",
    "-format",
    "UDRW",
    image,
  ]);
  run("hdiutil", [
    "attach",
    image,
    "-mountpoint",
    mount,
    "-nobrowse",
    "-noautoopen",
  ]);
  attached = true;
  // Pass the mount path as data instead of interpolating it into AppleScript.
  run("osascript", [
    "-e",
    `
on run argv
  set volumeFolder to POSIX file (item 1 of argv) as alias
  tell application "Finder"
    set installerWindow to make new Finder window to volumeFolder
    set current view of installerWindow to icon view
    set toolbar visible of installerWindow to false
    set statusbar visible of installerWindow to false
    set bounds of installerWindow to {120, 120, 760, 520}
    set options to icon view options of installerWindow
    set arrangement of options to not arranged
    set icon size of options to 96
    set text size of options to 12
    set background picture of options to file ".background:background.png" of volumeFolder
    set position of item "Small Calendar.app" of volumeFolder to {170, 190}
    set position of item "Applications" of volumeFolder to {470, 190}
    update volumeFolder without registering applications
    delay 2
    close installerWindow
  end tell
end run`,
    mount,
  ]);
  run("sync", []);
  run("hdiutil", ["detach", mount]);
  attached = false;
  run("hdiutil", ["convert", image, "-format", "UDZO", "-o", output, "-ov"]);
  run("hdiutil", ["verify", output]);
  console.log(`Local installer (ad-hoc signed, not notarized): ${output}`);
} finally {
  if (attached) run("hdiutil", ["detach", mount]);
  await rm(work, { recursive: true, force: true });
}
