// AudioWorklet runs away from the UI thread; batches ~85ms at 48kHz.
class SmallVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.used = 0;
    this.frames = 0;
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data === "stop") {
        if (this.used) this.port.postMessage(this.buffer.slice(0, this.used));
        this.used = 0;
        this.stopped = true;
        this.port.postMessage("stopped");
      }
    };
  }
  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      if (this.frames++ >= sampleRate * 120) {
        this.stopped = true;
        if (this.used) this.port.postMessage(this.buffer.slice(0, this.used));
        this.port.postMessage("limit");
        return false;
      }
      this.buffer[this.used++] = sample;
      if (this.used === this.buffer.length) {
        this.port.postMessage(this.buffer);
        this.buffer = new Float32Array(4096);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor("small-voice-capture", SmallVoiceCapture);
