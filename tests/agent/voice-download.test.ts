import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { VoiceDownload } from "../../src/main/voice/download.js";

const data = Buffer.from("test model data");
const model = {
  filename: "model.bin",
  bytes: data.length,
  sha256: createHash("sha256").update(data).digest("hex"),
  url: "https://huggingface.co/test/model",
};
test("model is ready only after hash verification and runtime validation; removal clears it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voice-download-"));
  let validated = false;
  try {
    const download = new VoiceDownload(
      dir,
      async () => {
        validated = true;
      },
      model,
      async () => new Response(data),
    );
    await download.init();
    await download.install();
    await download.settled();
    assert.equal(download.status.phase, "ready");
    assert.equal(validated, true);
    assert.deepEqual(await readFile(join(dir, "model.bin")), data);
    await download.remove();
    assert.equal(download.status.phase, "absent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("checksum mismatch never promotes a partial model", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voice-download-"));
  try {
    const download = new VoiceDownload(
      dir,
      async () => {},
      model,
      async () => new Response(Buffer.alloc(data.length)),
    );
    await download.init();
    await download.install();
    await download.settled();
    assert.equal(download.status.phase, "error");
    await assert.rejects(readFile(join(dir, "model.bin")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("restart resumes partial download with validated Content-Range", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voice-download-"));
  try {
    await writeFile(join(dir, "model.bin.part"), data.subarray(0, 4));
    const download = new VoiceDownload(
      dir,
      async () => {},
      model,
      async (_url, options) => {
        assert.equal(new Headers(options?.headers).get("range"), "bytes=4-");
        return new Response(data.subarray(4), {
          status: 206,
          headers: {
            "content-range": `bytes 4-${data.length - 1}/${data.length}`,
          },
        });
      },
    );
    await download.init();
    assert.equal(download.status.phase, "paused");
    await download.install();
    await download.settled();
    assert.equal(download.status.phase, "ready");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime failure retains verified weights for a retry without downloading", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voice-download-"));
  try {
    await writeFile(join(dir, "model.bin"), data);
    let attempts = 0;
    const download = new VoiceDownload(
      dir,
      async () => {
        if (++attempts === 1) throw new Error("Runtime unavailable");
      },
      model,
      async () => {
        throw new Error("Must not download again");
      },
    );
    await download.init();
    assert.equal(download.status.phase, "error");
    assert.deepEqual(await readFile(join(dir, "model.bin.part")), data);
    await download.install();
    await download.settled();
    assert.equal(download.status.phase, "ready");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
