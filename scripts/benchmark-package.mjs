import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { smokePackage } from "./smoke-package.mjs";

const executable = process.argv[2];
if (!executable)
  throw new Error(
    "Usage: node scripts/benchmark-package.mjs path/to/executable",
  );
const directory = await mkdtemp(join(tmpdir(), "small-package-benchmark-"));
const samples = [];
try {
  for (let run = 0; run < 5; run++) {
    const profile = join(directory, String(run));
    await mkdir(profile);
    for (const mode of ["fresh-profile", "reused-profile"]) {
      samples.push({
        run,
        mode,
        ...(await smokePackage(resolve(executable), profile)),
      });
    }
  }
  const summary = {};
  for (const mode of ["fresh-profile", "reused-profile"]) {
    summary[mode] = {};
    for (const metric of [
      "readyMs",
      "idleRssKiB",
      "chatRssKiB",
      "closedWindowRssKiB",
    ]) {
      const values = samples
        .filter((s) => s.mode === mode)
        .map((s) => s[metric])
        .sort((a, b) => a - b);
      summary[mode][metric] = {
        min: values[0],
        median: values[2],
        max: values[4],
      };
    }
  }
  console.log(
    JSON.stringify(
      {
        note: "macOS filesystem cache is not flushed; ready time includes CDP attachment; RSS is summed across app processes",
        summary,
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
