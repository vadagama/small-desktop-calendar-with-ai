import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { extractFile } from "@electron/asar";

export function updateMetadata({ version, filename, sha512, size }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error("Invalid release version");
  if (!/^Small-Calendar-[0-9A-Za-z.-]+-arm64\.zip$/.test(filename))
    throw new Error("Invalid update filename");
  if (
    !/^[A-Za-z0-9+/]{86}==$/.test(sha512) ||
    !Number.isSafeInteger(size) ||
    size <= 0
  )
    throw new Error("Invalid update checksum or size");
  return {
    version,
    files: [{ url: filename, sha512, size }],
    path: filename,
    sha512,
    releaseDate: new Date().toISOString(),
  };
}

export async function packageUpdate(app, output) {
  if (process.platform !== "darwin")
    throw new Error("macOS update packaging requires macOS");
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });
  run("codesign", ["--verify", "--deep", "--strict", app]);
  const details = spawnSync("codesign", ["--display", "--verbose=4", app], {
    encoding: "utf8",
  });
  if (
    details.status !== 0 ||
    !details.stderr.includes("Authority=Developer ID Application:") ||
    !/TeamIdentifier=[A-Z0-9]+/.test(details.stderr)
  )
    throw new Error(
      "Update payload requires a Developer ID Application signature; ad-hoc builds cannot be published as updates",
    );
  run("xcrun", ["stapler", "validate", app]);
  run("spctl", ["--assess", "--type", "execute", app]);
  if (
    run("lipo", [
      "-archs",
      join(app, "Contents/MacOS/Small Calendar"),
    ]).trim() !== "arm64"
  )
    throw new Error("The update pipeline currently supports arm64 builds only");
  const config = JSON.parse(
    await readFile(join(app, "Contents/Resources/app-update.yml"), "utf8"),
  );
  if (
    config.provider !== "github" ||
    config.owner !== "vadagama" ||
    config.repo !== "small-desktop-calendar-with-ai"
  )
    throw new Error("Unexpected update provider");
  const pkg = JSON.parse(
    extractFile(
      join(app, "Contents/Resources/app.asar"),
      "package.json",
    ).toString(),
  );
  const version = pkg.version;
  const filename = `Small-Calendar-${version}-arm64.zip`;
  // Validate the version before constructing any output path.
  updateMetadata({
    version,
    filename,
    sha512: Buffer.alloc(64).toString("base64"),
    size: 1,
  });
  await mkdir(output, { recursive: true });
  const zip = join(output, filename);
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(zip)) hash.update(chunk);
  const metadata = updateMetadata({
    version,
    filename,
    sha512: hash.digest("base64"),
    size: (await stat(zip)).size,
  });
  const channel = version.includes("-")
    ? version.split("-")[1].split(".")[0]
    : "latest";
  // JSON is a YAML subset understood by electron-updater. Stable and prerelease feeds are separate.
  const manifest = join(output, `${channel}-mac.yml`);
  await writeFile(manifest, JSON.stringify(metadata, null, 2) + "\n");
  console.log(`Update payload: ${zip}\nUpdate manifest: ${manifest}`);
  return { zip, manifest };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      app: {
        type: "string",
        default:
          "release/production/Small Calendar-darwin-arm64/Small Calendar.app",
      },
      out: { type: "string", default: "release/production" },
    },
  });
  await packageUpdate(resolve(values.app), resolve(values.out));
}
