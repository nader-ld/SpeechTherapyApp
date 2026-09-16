/* Microphone recording (MediaRecorder) and a Web Audio metronome. */

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

export class Recorder {
  constructor() {
    this.stream = null;
    this.rec = null;
    this.chunks = [];
    this.url = null;
    this.state = 'idle'; // idle | starting | recording
    this.token = 0; // bumped by release() so a pending getUserMedia can't start late
  }

  static supported() {
    return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  /** Asks for the microphone and starts recording. Resolves false if release() was
      called while the permission prompt was open (the stream is stopped, nothing starts). */
  async start() {
    if (!Recorder.supported()) throw new Error('Recording is not supported in this browser');
    this.release();
    const token = ++this.token;
    this.state = 'starting';
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (token === this.token) this.state = 'idle';
      throw err;
    }
    if (token !== this.token) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    this.stream = stream;
    const mimeType = pickMimeType();
    this.rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start();
    this.state = 'recording';
    return true;
  }

  /** Stops recording; resolves with an object URL for playback (or null). */
  stop() {
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec || rec.state === 'inactive') { resolve(this.url); return; }
      rec.onstop = () => {
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type });
        this.release();
        this.url = URL.createObjectURL(blob);
        this.state = 'idle';
        resolve(this.url);
      };
      rec.stop();
    });
  }

  /** Stop the mic and free the last recording. Safe to call any time. */
  release() {
    this.token++;
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    if (this.rec && this.rec.state !== 'inactive') { try { this.rec.stop(); } catch { /* ignore */ } }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
    this.state = 'idle';
  }
}

export class Metronome {
  constructor() {
    this.ctx = null;
    this.timer = null;
    this.bpm = 60;
    this.running = false;
    this.nextBeat = 0;
  }

  _ctx() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Create and unlock the audio context. Call from a tap handler (e.g. Start) so that
      a chime fired later by a timer is allowed to play on iOS. */
  prime() {
    try { this._ctx(); } catch { /* no audio available */ }
  }

  start(bpm) {
    this.bpm = bpm || this.bpm;
    if (this.running) return;
    const ctx = this._ctx();
    this.running = true;
    this.nextBeat = ctx.currentTime + 0.05;
    this._schedule();
  }

  _schedule() {
    if (!this.running) return;
    const ctx = this.ctx;
    const interval = 60 / this.bpm;
    while (this.nextBeat < ctx.currentTime + 0.2) {
      this._click(this.nextBeat);
      this.nextBeat += interval;
    }
    this.timer = setTimeout(() => this._schedule(), 50);
  }

  _click(t, freq = 880, gain = 0.5, len = 0.08) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  /** Short two-note chime, e.g. when a timer ends or a target is reached. */
  chime() {
    const ctx = this._ctx();
    const t = ctx.currentTime + 0.02;
    this._click(t, 660, 0.4, 0.18);
    this._click(t + 0.18, 990, 0.4, 0.28);
  }
}
