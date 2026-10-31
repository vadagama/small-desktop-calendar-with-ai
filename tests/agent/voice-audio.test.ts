import { test } from "node:test";
import assert from "node:assert/strict";
import { pcmToWav } from "../../src/main/voice/audio.js";

test("voice writes bounded mono 16k PCM16 WAV and rejects silence/invalid audio", () => {
  const pcm = new Float32Array(16000).fill(0.5);
  const wav = pcmToWav(pcm.buffer);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.length, 32044);
  assert.equal(wav.readInt16LE(44), 16384);
  assert.throws(
    () => pcmToWav(new Float32Array(16000).buffer),
    /Речь не обнаружена/,
  );
  assert.throws(() => pcmToWav(new Float32Array(16000).fill(NaN).buffer));
  assert.throws(() => pcmToWav(new Float32Array(16000).fill(2).buffer));
  assert.throws(() => pcmToWav(new ArrayBuffer(16000 * 121 * 4)));
  assert.throws(() => pcmToWav({ byteLength: 64000 }));
});
