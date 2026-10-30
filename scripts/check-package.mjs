import { listPackage, statFile } from "@electron/asar";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function inspectArchive(path) {
  const entries = listPackage(path);
  const forbidden = entries.filter((name) =>
    /\/(?:\.vite|\.cache|\.git|\.bin|test-results|playwright-report)(?:\/|$)/.test(
      name,
    ),
  );
  if (forbidden.length)
    throw new Error(
      `Build contains development artifacts: ${forbidden.slice(0, 5).join(", ")}`,
    );
  for (const file of [
    "/package.json",
    "/out/main/index.js",
    "/out/main/agent-worker.js",
    "/out/preload/index.cjs",
    "/out/renderer/index.html",
  ])
    if (!entries.includes(file)) throw new Error(`Package is missing ${file}`);
  const totals = {};
  for (const name of entries) {
    const entry = statFile(path, name.slice(1));
    if (entry.files) continue;
    const parts = name.split("/");
    const key =
      parts[1] === "node_modules"
        ? parts.slice(1, parts[2].startsWith("@") ? 4 : 3).join("/")
        : parts[1];
    totals[key] = (totals[key] ?? 0) + (entry.size ?? 0);
  }
  return Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1]));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const archive = process.argv[2];
  if (!archive)
    throw new Error("Usage: node scripts/check-package.mjs path/to/app.asar");
  const bytes = (await stat(archive)).size;
  const entries = inspectArchive(archive);
  console.log(JSON.stringify({ archiveBytes: bytes, entries }, null, 2));
  if (bytes > 32 * 1024 * 1024)
    throw new Error("app.asar exceeds the 32 MiB budget");
}
