import type { Vector3 } from '@babylonjs/core';
import type { PhoneKey } from '../core';

/** 每帧交给声音的状态。 */
export interface AudioFrame {
  listener: Vector3;
  forward: Vector3;
  up: Vector3;
  /** 0..1：心跳（被怀疑、被盯着）。 */
  heartbeat: number;
  /** 0..1：呼吸（暴露度）。 */
  breath: number;
  /** 异视在场时蝉声会停。 */
  anomaly: boolean;
  /** 0..1：灯光（跳闸时嗡声一起断）。 */
  lights: number;
  /** 0..1：老师暴怒时的低频底噪。 */
  rage: number;
}

const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

/** 原创的四小节铃声（和弦分解）；方波 + 三角波叠出和弦铃声那种塑料感。 */
const RINGTONE: [number, number][] = [
  [1047, 0.12], [784, 0.12], [659, 0.12], [784, 0.12], [1047, 0.12], [1319, 0.24],
  [1175, 0.12], [1047, 0.12], [988, 0.24], [784, 0.36],
];

/**
 * 全部声音都是现场合成的（Web Audio）：没有一个音频文件。
 * 坐标：Babylon 左手系 → Web Audio 右手系，统一把 z 取反（左右不会镜像，见 toAudio）。
 */
export class AudioDirector {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private sfx!: GainNode;
  private ambience!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuffer!: AudioBuffer;
  private hum!: GainNode;
  private cicadas!: GainNode;
  private drone!: GainNode;
  private beatIn = 0;
  private breathIn = 0;
  private breathPhase = 0;
  private duckUntil = 0;
  private voice: SpeechSynthesisVoice | null = null;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** 必须在一次用户点击里调用（浏览器的自动播放策略）。 */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.ambience = ctx.createGain();
    this.ambience.connect(this.master);

    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // 教室的混响：一段指数衰减的噪声当脉冲响应。
    this.reverb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 1.1), ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3.2);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.sfx.connect(this.reverb).connect(wet).connect(this.master);

    this.startAmbience(ctx);
    const pick = (): void => {
      this.voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('zh')) ?? null;
    };
    if (typeof speechSynthesis !== 'undefined') {
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
    if (paused && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  // ───────────── 常驻的声音 ─────────────

  private startAmbience(ctx: AudioContext): void {
    // 日光灯 50 Hz 的嗡声（q.fill.32 的答案就是它）：基频 + 两个谐波。
    this.hum = ctx.createGain();
    this.hum.gain.value = 0.012;
    this.hum.connect(this.ambience);
    for (const [f, g] of [[50, 0.5], [100, 1], [150, 0.25]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.value = g;
      o.connect(gain).connect(this.hum);
      o.start();
    }
    // 空调房一样的房间底噪。
    const room = this.loopNoise(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const roomGain = ctx.createGain();
    roomGain.gain.value = 0.05;
    room.connect(lp).connect(roomGain).connect(this.ambience);
    // 窗外的蝉：窄带噪声 + 30 Hz 的颤音 + 慢慢起伏，从 +X 那边的窗进来。
    const cic = this.loopNoise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4600;
    bp.Q.value = 9;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 31;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(trem.gain);
    lfo.start();
    this.cicadas = ctx.createGain();
    this.cicadas.gain.value = 0.05;
    const pan = this.panner(ctx, 7, 2, 0);
    cic.connect(bp).connect(trem).connect(this.cicadas).connect(pan).connect(this.ambience);
    // 暴怒时的低频：三个失谐的锯齿波。
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 220;
    this.drone.connect(dlp).connect(this.master);
    for (const f of [55, 55.7, 82.1]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(this.drone);
      o.start();
    }
  }

  private loopNoise(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.start();
    return src;
  }

  update(dt: number, f: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const l = ctx.listener;
    const [lx, ly, lz] = toAudio(f.listener);
    const [fx, fy, fz] = toAudio(f.forward);
    const [ux, uy, uz] = toAudio(f.up);
    if (l.positionX) {
      l.positionX.setTargetAtTime(lx, t, 0.02);
      l.positionY.setTargetAtTime(ly, t, 0.02);
      l.positionZ.setTargetAtTime(lz, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.02);
      l.upY.setTargetAtTime(uy, t, 0.02);
      l.upZ.setTargetAtTime(uz, t, 0.02);
    } else {
      l.setPosition(lx, ly, lz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    const ducked = t < this.duckUntil;
    this.hum.gain.setTargetAtTime(ducked ? 0 : 0.012 * f.lights, t, 0.05);
    this.cicadas.gain.setTargetAtTime(ducked || f.anomaly ? 0 : 0.05, t, f.anomaly ? 0.05 : 0.8);
    this.drone.gain.setTargetAtTime(ducked ? 0 : 0.05 * f.rage, t, 0.2);

    // 心跳：60 → 130 bpm。
    this.beatIn -= dt;
    if (f.heartbeat > 0.05 && this.beatIn <= 0 && !ducked) {
      this.beatIn = 60 / (60 + 70 * f.heartbeat);
      this.heartbeat(0.05 + 0.3 * f.heartbeat);
    }
    // 呼吸：越暴露越急、越响。
    this.breathIn -= dt;
    if (f.breath > 0.08 && this.breathIn <= 0 && !ducked) {
      const period = 3.2 - 1.6 * f.breath;
      this.breathIn = period / 2;
      this.breathPhase = 1 - this.breathPhase;
      this.breathe(this.breathPhase === 0, period / 2, 0.02 + 0.07 * f.breath);
    }
  }

  // ───────────── 积木 ─────────────

  private panner(ctx: AudioContext, x: number, y: number, z: number): PannerNode {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1;
    p.maxDistance = 30;
    p.rolloffFactor = 1.1;
    const [ax, ay, az] = toAudio({ x, y, z });
    if (p.positionX) {
      p.positionX.value = ax;
      p.positionY.value = ay;
      p.positionZ.value = az;
    } else p.setPosition(ax, ay, az);
    return p;
  }

  private at(x: number, y: number, z: number): AudioNode {
    const ctx = this.ctx!;
    const p = this.panner(ctx, x, y, z);
    p.connect(this.sfx);
    return p;
  }

  private envGain(dest: AudioNode, t0: number, attack: number, peak: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(dest);
    return g;
  }

  private tone(type: OscillatorType, freq: number, t0: number, dur: number, dest: AudioNode, endFreq?: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq !== undefined) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    o.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  private noise(t0: number, dur: number, dest: AudioNode): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.connect(dest);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
    return src;
  }

  private filter(type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  private get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private get live(): boolean {
    return this.ctx !== null && this.now >= this.duckUntil;
  }

  // ───────────── 老师 ─────────────

  /** 高跟鞋：一声脆的「嗒」；在讲台（木头）上多一层空心的「咚」。 */
  footstep(x: number, z: number, onPlatform: boolean, loud = 1): void {
    if (!this.live) return;
    const t = this.now;
    const dest = this.at(x, 0.05, z);
    this.noise(t, 0.03, this.filter('bandpass', 3000 + Math.random() * 600, 1.4, this.envGain(dest, t, 0.002, 0.5 * loud, 0.035)));
    this.tone('sine', 190, t, 0.07, this.envGain(dest, t, 0.002, 0.25 * loud, 0.06), 90);
    if (onPlatform) this.tone('triangle', 150, t, 0.16, this.envGain(dest, t, 0.004, 0.3 * loud, 0.15), 110);
  }

  pageTurn(x: number, z: number): void {
    if (!this.live) return;
    const t = this.now;
    const f = this.filter('bandpass', 1500, 0.8, this.envGain(this.at(x, 1.2, z), t, 0.06, 0.16, 0.22));
    f.frequency.setValueAtTime(1200, t);
    f.frequency.exponentialRampToValueAtTime(4200, t + 0.25);
    this.noise(t, 0.3, f);
  }

  /** 「嗯？」—— 一个往上挑的鼻音：锯齿波穿过两个共振峰。 */
  hmm(x: number, y: number, z: number): void {
    if (!this.live) return;
    const t = this.now;
    const out = this.envGain(this.at(x, y, z), t, 0.05, 0.5, 0.45);
    const f1 = this.filter('bandpass', 480, 5, out);
    const f2 = this.filter('bandpass', 1400, 7, out);
    const o = this.tone('sawtooth', 185, t, 0.5, f1, 270);
    o.connect(f2);
  }

  // ───────────── 手机 ─────────────

  /** 按键音：响铃模式是双音（DTMF，整间教室听得见）；静音只剩塑料键帽的一下。 */
  key(key: PhoneKey, audible: boolean): void {
    if (!this.live) return;
    const t = this.now;
    const out = this.filter('lowpass', 5000, 0.7, this.sfx);
    if (!audible) {
      this.noise(t, 0.008, this.filter('bandpass', 2500, 2, this.envGain(out, t, 0.001, 0.05, 0.01)));
      return;
    }
    const pair = DTMF[key];
    const g = this.envGain(out, t, 0.004, 0.09, 0.1);
    if (pair) {
      this.tone('sine', pair[0], t, 0.1, g);
      this.tone('sine', pair[1], t, 0.1, g);
    } else this.tone('square', 1046, t, 0.05, this.envGain(out, t, 0.002, 0.04, 0.05));
  }

  ring(): void {
    if (!this.ctx) return;
    let t = this.now;
    const out = this.filter('lowpass', 6000, 0.7, this.sfx);
    for (let rep = 0; rep < 2; rep++) {
      for (const [f, d] of RINGTONE) {
        const g = this.envGain(out, t, 0.005, 0.13, d * 0.9);
        this.tone('square', f, t, d, g);
        this.tone('triangle', f / 2, t, d, g);
        t += d;
      }
      t += 0.25;
    }
  }

  vibrate(): void {
    if (!this.ctx) return;
    const t = this.now;
    const out = this.filter('lowpass', 400, 1, this.sfx);
    for (let i = 0; i < 3; i++) this.tone('square', 150, t + i * 0.45, 0.3, this.envGain(out, t + i * 0.45, 0.02, 0.035, 0.28));
  }

  searchDone(audible: boolean): void {
    if (!this.live || !audible) return;
    const t = this.now;
    this.tone('square', 1319, t, 0.07, this.envGain(this.sfx, t, 0.003, 0.05, 0.07));
    this.tone('square', 1760, t + 0.08, 0.1, this.envGain(this.sfx, t + 0.08, 0.003, 0.05, 0.1));
  }

  denied(audible: boolean): void {
    if (!this.live) return;
    const t = this.now;
    this.tone('square', 220, t, 0.18, this.envGain(this.sfx, t, 0.003, audible ? 0.06 : 0.015, 0.18));
  }

  flip(open: boolean): void {
    if (!this.live) return;
    const t = this.now;
    this.noise(t, 0.012, this.filter('bandpass', open ? 3400 : 2600, 2, this.envGain(this.sfx, t, 0.001, 0.12, 0.02)));
    this.tone('sine', open ? 520 : 380, t, 0.04, this.envGain(this.sfx, t, 0.001, 0.05, 0.04));
  }

  pen(): void {
    if (!this.live) return;
    const t = this.now;
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.07 + Math.random() * 0.02;
      this.noise(s, 0.06, this.filter('bandpass', 3500 + Math.random() * 1500, 3, this.envGain(this.sfx, s, 0.005, 0.05, 0.05)));
    }
  }

  // ───────────── 被抓 / 死亡 ─────────────

  /** 闪现前的那一下：灯管断电的「嗞」+ 一阵风。 */
  whoosh(): void {
    if (!this.ctx) return;
    const t = this.now;
    this.tone('sawtooth', 100, t, 0.12, this.envGain(this.master, t, 0.002, 0.08, 0.1));
    const f = this.filter('bandpass', 300, 1.2, this.envGain(this.master, t, 0.12, 0.5, 0.18));
    f.frequency.setValueAtTime(250, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.28);
    this.noise(t, 0.32, f);
  }

  /**
   * 惊吓音：次低频的一记、三个失谐的锯齿波（过失真）、一阵噪声、一声走调的尖叫。
   * muffle 0..1 = 像隔着一层东西（DeathCurve 的 stingerMuffle）。
   */
  sting(volume = 1, muffle = 0, delay = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now + delay;
    const cut = 20000 * Math.pow(0.03, muffle);
    this.muffle.frequency.setTargetAtTime(Math.max(300, cut), t, 0.01);
    this.muffle.frequency.setTargetAtTime(20000, t + 1.6, 0.4);
    const v = Math.max(0.05, volume);
    this.tone('sine', 85, t, 0.9, this.envGain(this.master, t, 0.005, 0.9 * v, 0.9), 28);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 6);
    }
    shaper.curve = curve;
    const screech = this.envGain(this.master, t, 0.01, 0.22 * v, 1.3);
    const hp = this.filter('highpass', 700, 0.7, screech);
    shaper.connect(hp);
    for (const f of [1100, 1167, 1241]) {
      const o = this.tone('sawtooth', f, t, 1.3, shaper, f * 0.62);
      const vib = ctx.createOscillator();
      vib.frequency.value = 9;
      const depth = ctx.createGain();
      depth.gain.value = 40;
      vib.connect(depth).connect(o.frequency);
      vib.start(t);
      vib.stop(t + 1.4);
    }
    this.noise(t, 0.7, this.filter('lowpass', 5000, 0.5, this.envGain(this.master, t, 0.003, 0.35 * v, 0.6)));
    const scream = this.envGain(this.master, t + 0.05, 0.08, 0.25 * v, 1.0);
    const fa = this.filter('bandpass', 950, 6, scream);
    const fb = this.filter('bandpass', 2600, 8, scream);
    const s = this.tone('sawtooth', 480, t + 0.05, 1.1, fa, 760);
    s.connect(fb);
  }

  /** 死亡前的「先安静」：所有声音掐掉一段时间。 */
  silence(seconds: number): void {
    if (!this.ctx) return;
    this.duckUntil = this.now + seconds;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  heartbeat(volume: number): void {
    if (!this.ctx) return;
    const t = this.now;
    for (const [dt, v] of [[0, 1], [0.17, 0.7]] as const) {
      this.tone('sine', 62, t + dt, 0.12, this.envGain(this.master, t + dt, 0.008, volume * v, 0.11), 38);
    }
  }

  private breathe(inhale: boolean, seconds: number, volume: number): void {
    const t = this.now;
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(volume, t + seconds * (inhale ? 0.6 : 0.25));
    g.gain.linearRampToValueAtTime(0.0001, t + seconds * 0.95);
    g.connect(this.master);
    this.noise(t, seconds, this.filter('bandpass', inhale ? 1400 : 900, 0.9, g));
  }

  // ───────────── 广播 ─────────────

  /** 「叮咚」+ 用浏览器的中文语音念表里的那句话。念的时候环境声让一让。 */
  broadcast(text: string): void {
    if (!this.live) return;
    const t = this.now;
    const out = this.filter('lowpass', 3500, 0.7, this.at(2.9, 2.7, -4.4));
    for (const [f, dt] of [[784, 0], [659, 0.45]] as const) {
      const g = this.envGain(out, t + dt, 0.01, 0.35, 1.1);
      this.tone('sine', f, t + dt, 1.1, g);
      this.tone('sine', f * 2, t + dt, 0.6, this.envGain(out, t + dt, 0.01, 0.08, 0.5));
    }
    if (typeof speechSynthesis === 'undefined' || text.length === 0) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    if (this.voice) u.voice = this.voice;
    u.rate = 0.92;
    u.pitch = 0.85;
    u.volume = 0.9;
    this.ambience.gain.setTargetAtTime(0.4, t, 0.2);
    u.onend = () => this.ambience.gain.setTargetAtTime(1, this.now, 0.5);
    window.setTimeout(() => speechSynthesis.speak(u), 1200);
  }
}

function toAudio(v: { x: number; y: number; z: number }): [number, number, number] {
  return [v.x, v.y, -v.z];
}
