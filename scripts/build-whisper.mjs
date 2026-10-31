import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

// Official upstream, pinned source revision. Weights are never built into this directory.
const revision = "2eeeba56e9edd762b4b38467bab96c2517163158";
if (process.platform !== "darwin")
  throw new Error("The current native voice build targets macOS");
const cmake = process.env.CMAKE ?? "cmake";
const work = await mkdtemp(join(tmpdir(), "small-whisper-build-"));
try {
  const source = join(work, "source");
  const build = join(work, "build");
  execFileSync(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      "v1.8.3",
      "https://github.com/ggml-org/whisper.cpp.git",
      source,
    ],
    { stdio: "inherit" },
  );
  const actual = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (actual !== revision) throw new Error("Unexpected whisper.cpp revision");
  execFileSync(
    cmake,
    [
      "-S",
      source,
      "-B",
      build,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DBUILD_SHARED_LIBS=OFF",
      "-DWHISPER_BUILD_TESTS=OFF",
      "-DGGML_NATIVE=OFF",
      "-DGGML_METAL=ON",
      "-DGGML_METAL_EMBED_LIBRARY=ON",
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    cmake,
    ["--build", build, "--target", "whisper-cli", "-j", "6"],
    { stdio: "inherit" },
  );
  const output = resolve("native/voice");
  await mkdir(output, { recursive: true });
  await cp(join(build, "bin/whisper-cli"), join(output, "whisper-cli"));
  await cp(join(source, "LICENSE"), join(output, "LICENSE.whisper.cpp"));
  await writeFile(
    join(output, "version.json"),
    JSON.stringify({ version: "1.8.3", revision, arch: process.arch }),
  );
  console.log(`Built Whisper runtime: ${output}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
