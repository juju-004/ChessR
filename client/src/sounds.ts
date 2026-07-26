/**
 * Original, procedurally-synthesized sound effects — not sampled or adapted
 * from chess.com, lichess, or anywhere else. Full disclosure on scope: this is
 * simple Web Audio API oscillator synthesis (tones/envelopes), not real sound
 * design — it won't sound as polished as a professionally recorded/mixed sample
 * library, but it is guaranteed original and carries no licensing risk, which
 * a "grab a similar-sounding file from somewhere" approach couldn't promise.
 */

let ctx: AudioContext | null = null;

// Module-level mute switch driven by the Settings page's "Move sounds"
// toggle (see SettingsContext.tsx / Game.tsx) — checked once at the top of
// playTones rather than threading an `enabled` flag through every call site.
let soundEnabled = true;

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
}

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

interface Tone {
  freq: number;
  startOffset: number; // seconds from the sound's start
  duration: number; // seconds
  type?: OscillatorType;
  gain?: number;
}

function playTones(tones: Tone[]) {
  if (!soundEnabled) return;
  const audioCtx = getCtx();
  // Browsers suspend AudioContext until a user gesture; every sound call is
  // triggered by one (a drag, a click), so resuming here is safe and cheap.
  if (audioCtx.state === 'suspended') void audioCtx.resume();

  const now = audioCtx.currentTime;
  for (const tone of tones) {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = tone.type ?? 'sine';
    osc.frequency.value = tone.freq;

    const start = now + tone.startOffset;
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

/** A soft, short two-note "pluck" for a normal move. */
export function playMoveSound() {
  playTones([{ freq: 520, startOffset: 0, duration: 0.09, type: 'triangle' }]);
}

/** A sharp "click-thud" impact — a brief high click immediately followed by a
 *  low thump, evoking a piece actually being knocked off the board. */
export function playCaptureSound() {
  playTones([
    { freq: 1400, startOffset: 0, duration: 0.035, type: 'triangle', gain: 0.16 },
    { freq: 140, startOffset: 0.015, duration: 0.14, type: 'square', gain: 0.2 },
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

/** A descending chime when a game ends (win, loss, draw, abort — same cue). */
export function playGameOverSound() {
  playTones([
    { freq: 523, startOffset: 0, duration: 0.14 },
    { freq: 392, startOffset: 0.12, duration: 0.16 },
    { freq: 261, startOffset: 0.26, duration: 0.28 },
  ]);
}
