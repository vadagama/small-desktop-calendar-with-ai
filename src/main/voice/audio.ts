import { VOICE_MAX_SECONDS, VOICE_SAMPLE_RATE } from "../../shared/voice.js";

export function pcmToWav(input: unknown): Buffer {
  if (
    !(input instanceof ArrayBuffer) ||
    input.byteLength % 4 ||
    input.byteLength < 1600 ||
    input.byteLength > VOICE_SAMPLE_RATE * VOICE_MAX_SECONDS * 4
  )
    throw new Error("Некорректная или слишком длинная запись");
  const samples = new Float32Array(input);
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(VOICE_SAMPLE_RATE, 24);
  wav.writeUInt32LE(VOICE_SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    if (!Number.isFinite(sample) || Math.abs(sample) > 1)
      throw new Error("Некорректный аудиосигнал");
    energy += sample * sample;
    wav.writeInt16LE(
      Math.round(sample * (sample < 0 ? 32768 : 32767)),
      44 + i * 2,
    );
  }
  if (Math.sqrt(energy / samples.length) < 0.001)
    throw new Error("Речь не обнаружена. Попробуйте ещё раз");
  return wav;
}
