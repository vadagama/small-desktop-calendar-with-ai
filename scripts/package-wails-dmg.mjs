import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// dmgbuild writes Finder metadata without opening windows or moving user focus.
const run = (command, args) =>
  execFileSync(command, args, { stdio: "inherit" });
export async function buildInstaller(app, output) {
  app = resolve(app);
  output = resolve(output);
  if (process.platform !== "darwin")
    throw new Error("DMG packaging requires macOS");
  if (!app.endsWith("/Ordo.app")) throw new Error("Expected Ordo.app");
  await access(join(app, "Contents/Info.plist"));
  try {
    await access(output);
    throw new Error(`Refusing to overwrite installer: ${output}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  await mkdir(dirname(output), { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "ordo-dmg-"));
  try {
    const tool = join(work, "dmg-artwork");
    const background = join(work, "background.png");
    const retina = join(work, "background@2x.png");
    const icon = join(app, "Contents/Resources/ordo.icns");
    run("/usr/bin/clang", [
      "-fobjc-arc",
      "-framework",
      "AppKit",
      "scripts/dmg-background.m",
      "-o",
      tool,
    ]);
    run(tool, [retina]);
    run("/usr/bin/sips", [
      "--resampleHeightWidth",
      "400",
      "640",
      "--setProperty",
      "dpiWidth",
      "72",
      "--setProperty",
      "dpiHeight",
      "72",
      retina,
      "--out",
      background,
    ]);
    const settings = join(work, "settings.py");
    await writeFile(
      settings,
      `import json\nsettings = json.loads(${JSON.stringify(
        JSON.stringify({
          files: [app],
          symlinks: { Applications: "/Applications" },
          icon,
          background,
          format: "UDZO",
          filesystem: "HFS+",
          window_rect: [
            [120, 120],
            [640, 400],
          ],
          icon_locations: { "Ordo.app": [170, 190], Applications: [470, 190] },
          icon_size: 96,
          text_size: 12,
          show_toolbar: false,
          show_status_bar: false,
          show_sidebar: false,
          default_view: "icon-view",
          include_icon_view_settings: true,
          include_list_view_settings: false,
        }),
      )})\nglobals().update(settings)\n`,
    );
    run(process.env.UV ?? "uv", [
      "tool",
      "run",
      "--from",
      "dmgbuild==1.6.7",
      "--with",
      "ds-store==1.3.4",
      "--with",
      "mac-alias==2.2.4",
      "dmgbuild",
      "-s",
      settings,
      "Ordo",
      output,
    ]);
    run(process.env.UV ?? "uv", [
      "run",
      "--no-project",
      "--with",
      "dmgbuild==1.6.7",
      "--with",
      "ds-store==1.3.4",
      "--with",
      "mac-alias==2.2.4",
      "python",
      "scripts/verify-wails-dmg.py",
      output,
    ]);
    // Finder's custom file icon is metadata; the volume icon is embedded in DMG.
    run(tool, ["--icon", icon, output]);
    run("/usr/bin/hdiutil", ["verify", output]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: { app: { type: "string" }, out: { type: "string" } },
  });
  if (!values.app || !values.out)
    throw new Error("Use --app <Ordo.app> --out <installer.dmg>");
  await buildInstaller(values.app, values.out);
}
