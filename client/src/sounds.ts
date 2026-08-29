/**
 * Original, procedurally-synthesized sound effects, not sampled or adapted
 * from chess.com, lichess, or anywhere else. Full disclosure on scope: this is
 * simple Web Audio API oscillator synthesis (tones/envelopes), not real sound
 * design, it won't sound as polished as a professionally recorded/mixed sample
 * library, but it is guaranteed original and carries no licensing risk, which
 * a "grab a similar-sounding file from somewhere" approach couldn't promise.
 */

let ctx: AudioContext | null = null;

// Module-level mute switch driven by the Settings page's "Move sounds"
// toggle (see SettingsContext.tsx / Game.tsx), checked once at the top of
// playTones rather than threading an `enabled` flag through every call site.
let soundEnabled = true;

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
}

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function ensureAudioContext(): AudioContext {
  const audioCtx = getCtx();
  // Browsers suspend AudioContext until a user gesture; every sound call is
  // triggered by one (a drag, a click), so resuming here is safe and cheap.
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

interface Tone {
  freq: number;
  startOffset: number; // seconds from the sound's start
  duration: number; // seconds
  type?: OscillatorType;
  gain?: number;
  /** If set, the oscillator sweeps from `freq` up/down to this frequency
   *  over `duration` instead of holding steady. Not used by any sound in
   *  this file right now, kept available for a future one that wants it. */
  freqEnd?: number;
}

function playTones(tones: Tone[]) {
  if (!soundEnabled) return;
  const audioCtx = ensureAudioContext();

  const now = audioCtx.currentTime;
  for (const tone of tones) {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = tone.type ?? 'sine';

    const start = now + tone.startOffset;
    osc.frequency.setValueAtTime(tone.freq, start);
    if (tone.freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(tone.freqEnd, start + tone.duration);
    }

    const peakGain = tone.gain ?? 0.18;
    gainNode.gain.setValueAtTime(0, start);
    gainNode.gain.linearRampToValueAtTime(peakGain, start + 0.008);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + tone.duration + 0.02);
  }
}

/** A short burst of filtered white noise, the "clash"/transient sizzle a
 *  pure oscillator can't produce on its own. Only used by playBerserkSound
 *  today; kept generic (not folded into playTones' Tone shape) since it's a
 *  genuinely different signal chain (buffer source + filter, not an
 *  oscillator) rather than just another tone variant. */
function playNoiseBurst(startOffset: number, duration: number, gain: number, highpassFreq: number) {
  if (!soundEnabled) return;
  const audioCtx = ensureAudioContext();
  const start = audioCtx.currentTime + startOffset;

  const bufferSize = Math.max(1, Math.ceil(audioCtx.sampleRate * duration));
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = highpassFreq;

  const gainNode = audioCtx.createGain();
  gainNode.gain.setValueAtTime(0, start);
  gainNode.gain.linearRampToValueAtTime(gain, start + 0.004);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  source.start(start);
  source.stop(start + duration + 0.02);
}

/** A soft, quiet placement sound for a normal move: a brief noise transient
 *  (the felt-on-wood contact tap) under a short low thud. Same recipe as
 *  playCaptureSound below, just much quieter and with no "crack", a normal
 *  move should read as gentle contact, not an impact. Deliberately dropped
 *  the old single triangle-wave blip, on its own a bare oscillator note
 *  reads as a synth/game blip rather than a piece actually touching down. */
export function playMoveSound() {
  playNoiseBurst(0, 0.018, 0.05, 3200);
  playTones([
    { freq: 300, startOffset: 0.004, duration: 0.07, type: 'triangle', gain: 0.13 },
  ]);
}

/** A sharp "snap", a brief filtered-noise crack (the actual transient a
 *  pure oscillator can't produce) landing right on top of a single low
 *  thud, like a piece being struck off the board and set down in one
 *  motion. Deliberately one clean hit rather than the previous
 *  double-knock, so it stays punchy and reads instantly as "different
 *  from a normal move" even in a fast flurry of captures. */
export function playCaptureSound() {
  playNoiseBurst(0, 0.035, 0.17, 2400);
  playTones([
    { freq: 1500, startOffset: 0, duration: 0.02, type: 'square', gain: 0.1 },
    { freq: 150, startOffset: 0.012, duration: 0.15, type: 'triangle', gain: 0.25 },
  ]);
}

/** A clean two-strike bell for check: each strike is a sine fundamental with
 *  a quiet octave-up sine layered on top (the overtone that makes a bell
 *  read as a bell rather than a flat tone), rising a third from the first
 *  strike to the second. Replaced the old two sawtooth stabs, a bare
 *  sawtooth's buzzy harmonic content is what read as a toy alarm rather
 *  than an alert, sine is a clean, professional-sounding waveform with no
 *  buzz to it. */
export function playCheckSound() {
  playTones([
    { freq: 784, startOffset: 0, duration: 0.14, type: 'sine', gain: 0.17 },
    { freq: 1568, startOffset: 0, duration: 0.09, type: 'sine', gain: 0.05 },
    { freq: 988, startOffset: 0.12, duration: 0.18, type: 'sine', gain: 0.16 },
    { freq: 1976, startOffset: 0.12, duration: 0.11, type: 'sine', gain: 0.05 },
  ]);
}

/** A gentle ascending chime when a game starts. */
export function playGameStartSound() {
  playTones([
    { freq: 440, startOffset: 0, duration: 0.12 },
    { freq: 554, startOffset: 0.1, duration: 0.12 },
    { freq: 659, startOffset: 0.2, duration: 0.2 },
  ]);
}

/** A powerful stinger for berserk, built as a scaled-up version of
 *  playCaptureSound's own recipe (noise-burst crack + low triangle thud)
 *  rather than the old sawtooth siren-whoop + square beep. A raw sawtooth
 *  sweep and a bare square wave both carry a buzzy, retro-game harmonic
 *  content, which read as a toy alarm rather than a serious declaration.
 *  This keeps the same "real impact" character as a capture, just bigger:
 *  a wider noise crack, a deeper triangle thud with a harmonic layer for
 *  body, and a quick sine shimmer on top (an octave-up ping, not a siren
 *  sweep) so it still cuts through everything else without sounding like
 *  an 8-bit klaxon. Still the loudest sound in this file on purpose. */
export function playBerserkSound() {
  playNoiseBurst(0, 0.055, 0.2, 1000);
  playTones([
    { freq: 130, startOffset: 0, duration: 0.22, type: 'triangle', gain: 0.27 },
    { freq: 390, startOffset: 0, duration: 0.16, type: 'triangle', gain: 0.11 },
    { freq: 880, startOffset: 0.03, duration: 0.1, type: 'sine', gain: 0.09 },
    { freq: 1760, startOffset: 0.03, duration: 0.07, type: 'sine', gain: 0.04 },
  ]);
}

/** A sharp double-beep, the clock just crossed into "you're running low"
 *  territory. Deliberately higher-pitched and more clipped than the check
 *  alert so it reads as "look at the clock" rather than "look at the
 *  board". Fires once per crossing (see the ref-guarded effect in
 *  Game.tsx), not on every tick while time stays low. */
export function playLowTimeSound() {
  playTones([
    { freq: 1046, startOffset: 0, duration: 0.08, type: 'square', gain: 0.16 },
    { freq: 1046, startOffset: 0.12, duration: 0.08, type: 'square', gain: 0.16 },
  ]);
}

/** A descending chime when a game ends (win, loss, draw, abort, same cue). */
export function playGameOverSound() {
  playTones([
    { freq: 523, startOffset: 0, duration: 0.14 },
    { freq: 392, startOffset: 0.12, duration: 0.16 },
    { freq: 261, startOffset: 0.26, duration: 0.28 },
  ]);
}
