import assert from "node:assert/strict";
import { getRawHeader } from "@electron/asar";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyFuses } from "./electron-fuses.mjs";

const source = process.argv[2];
if (!source)
  throw new Error(
    "Usage: node scripts/test-package-integrity.mjs path/to/Small Calendar.app",
  );
await verifyFuses(resolve(source));
const work = await mkdtemp(join(tmpdir(), "small-integrity-test-"));
try {
  const app = join(work, "Small Calendar.app");
  await cp(resolve(source), app, { recursive: true, verbatimSymlinks: true });
  const archive = join(app, "Contents/Resources/app.asar");
  const bytes = await readFile(archive);
  const { headerString } = getRawHeader(archive);
  const offset = bytes.indexOf(Buffer.from(headerString));
  const hash = headerString.indexOf('"hash":"') + 8;
  assert.ok(offset >= 0 && hash >= 8, "expected ASAR integrity header");
  bytes[offset + hash] = bytes[offset + hash] === 97 ? 98 : 97;
  await writeFile(archive, bytes);
  const result = await new Promise((done, reject) => {
    const child = spawn(
      join(app, "Contents/MacOS/Small Calendar"),
      [`--user-data-dir=${join(work, "profile")}`],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Tampered app was not rejected within 15 seconds"));
    }, 15_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      done({ code, signal, stderr });
    });
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /integrity|hash mismatch|Invalid Asar/i);
  console.log("Tampered ASAR rejected by Electron at runtime");
} finally {
  await rm(work, { recursive: true, force: true });
}
