import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseUpdateInfo,
  resolveFiles,
  findFile,
} from "electron-updater/out/providers/Provider.js";
// @ts-expect-error Packaging scripts are JavaScript, executed directly by Node.
import { updateMetadata } from "../../scripts/package-update.mjs";

test("update manifest contains the archive checksum and size required by the updater", () => {
  const sha512 = Buffer.alloc(64, 42).toString("base64");
  const info = updateMetadata({
    version: "1.2.3",
    filename: "Small-Calendar-1.2.3-arm64.zip",
    sha512,
    size: 123,
  });
  assert.equal(info.version, "1.2.3");
  assert.deepEqual(info.files, [
    { url: "Small-Calendar-1.2.3-arm64.zip", sha512, size: 123 },
  ]);
  assert.equal(info.sha512, sha512);
  const base = new URL(
    "https://github.com/vadagama/small-desktop-calendar-with-ai/releases/download/v1.2.3/",
  );
  const parsed = parseUpdateInfo(
    JSON.stringify(info),
    "latest-mac.yml",
    new URL("latest-mac.yml", base),
  );
  const archive = findFile(resolveFiles(parsed, base), "zip");
  assert.equal(archive?.url.href, new URL(info.path, base).href);
  assert.equal(archive?.info.sha512, sha512);
});

test("packaging rejects unsafe versions, missing checksums, and empty archives", () => {
  const valid = {
    version: "1.2.3",
    filename: "Small-Calendar-1.2.3-arm64.zip",
    sha512: Buffer.alloc(64).toString("base64"),
    size: 123,
  };
  for (const invalid of [
    { version: "../../file" },
    { filename: "../archive.zip" },
    { sha512: "" },
    { size: 0 },
    { size: NaN },
  ])
    assert.throws(() => updateMetadata({ ...valid, ...invalid }));
});
