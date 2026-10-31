export interface MicrophoneCapture {
  stop(): Promise<ArrayBuffer>;
  cancel(): void;
}
export async function captureMicrophone(
  deviceId: string,
  signal: AbortSignal,
  level: (value: number) => void,
  ended: () => void,
  limit: () => void,
): Promise<MicrophoneCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId === "default" ? {} : { deviceId: { exact: deviceId } }),
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
    video: false,
  });
  if (signal.aborted) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("Запись отменена");
  }
  let context: AudioContext;
  try {
    context = new AudioContext({ sampleRate: 16000 });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  let node: AudioWorkletNode | undefined;
  let chunks: Float32Array[] = [];
  let finish: (() => void) | undefined;
  let stopped = false;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    node?.disconnect();
    void context.close().catch(() => {});
    signal.removeEventListener("abort", cancel);
  };
  const cancel = () => {
    cleanup();
    chunks = [];
    finish?.();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await context.audioWorklet.addModule(
      new URL("./voice/capture-worklet.js", window.location.href).href,
    );
    if (signal.aborted) throw new Error("Запись отменена");
    node = new AudioWorkletNode(context, "small-voice-capture");
    for (const track of stream.getAudioTracks())
      track.addEventListener("ended", () => {
        if (!stopped) ended();
      });
    const source = context.createMediaStreamSource(stream);
    // The processor writes no output, so this keeps processing alive without monitoring audio.
    source.connect(node);
    node.connect(context.destination);
    node.port.onmessage = ({ data }: MessageEvent<Float32Array | string>) => {
      if (data instanceof Float32Array) {
        chunks.push(data);
        let energy = 0;
        for (const value of data) energy += value * value;
        level(Math.min(1, Math.sqrt(energy / data.length) * 8));
      } else if (data === "limit") {
        limit();
        finish?.();
      } else if (data === "stopped") finish?.();
    };
    await context.resume();
    return {
      cancel,
      async stop() {
        const rate = context.sampleRate;
        if (!stopped)
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 300);
            finish = () => {
              clearTimeout(timeout);
              resolve();
            };
            node!.port.postMessage("stop");
          });
        cleanup();
        if (signal.aborted) throw new Error("Запись отменена");
        const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        if (!length) throw new Error("Речь не обнаружена. Попробуйте ещё раз");
        const samples = new Float32Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          samples.set(chunk, offset);
          offset += chunk.length;
        }
        chunks = [];
        if (rate === 16000) return samples.buffer;
        const offline = new OfflineAudioContext(
          1,
          Math.min(16000 * 120, Math.ceil((length * 16000) / rate)),
          16000,
        );
        const buffer = offline.createBuffer(1, length, rate);
        buffer.copyToChannel(samples, 0);
        const input = offline.createBufferSource();
        input.buffer = buffer;
        input.connect(offline.destination);
        input.start();
        const rendered = await offline.startRendering();
        return new Float32Array(rendered.getChannelData(0)).buffer;
      },
    };
  } catch (error) {
    cancel();
    throw error;
  }
}
