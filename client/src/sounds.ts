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
   *  over `duration` instead of holding steady, used for the berserk
   *  siren's rising/falling "whoop". */
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

/** A soft, short two-note "pluck" for a normal move. */
export function playMoveSound() {
  playTones([{ freq: 520, startOffset: 0, duration: 0.09, type: 'triangle' }]);
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

/** A brighter, more urgent rising two-note alert for check. */
export function playCheckSound() {
  playTones([
    { freq: 660, startOffset: 0, duration: 0.1, type: 'sawtooth', gain: 0.15 },
    { freq: 880, startOffset: 0.09, duration: 0.14, type: 'sawtooth', gain: 0.15 },
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

/** A rising-then-falling siren "whoop", a noise-burst crack up front, then
 *  two sawtooth sweeps (low-to-high, then high-to-low) instead of the old
 *  fixed-pitch horn stabs, closer to an actual alarm klaxon than a chord.
 *  A faint high ring-out on top as it settles. Still the loudest, busiest
 *  sound in this file on purpose, berserking is a loud, once-per-game
 *  declaration, so it should cut through everything else. */
export function playBerserkSound() {
  playNoiseBurst(0, 0.05, 0.18, 1200);
  playTones([
    { freq: 220, freqEnd: 880, startOffset: 0, duration: 0.16, type: 'sawtooth', gain: 0.22 },
    { freq: 880, freqEnd: 220, startOffset: 0.16, duration: 0.18, type: 'sawtooth', gain: 0.2 },
    { freq: 1760, startOffset: 0.02, duration: 0.12, type: 'square', gain: 0.06 },
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
