/**
 * Original, procedurally-synthesized sound effects, not sampled or adapted
 * from chess.com, lichess, or anywhere else. Full disclosure on scope: this
 * is Web Audio API synthesis, not a recorded/mixed sample library, so it
 * won't be pixel-perfect foley — but the piece-contact sounds (move/
 * capture/berserk) are built as resonant-filtered noise impacts (the
 * standard technique for synthesizing a convincing knock/tap without a
 * sample), not oscillator tones, specifically because a held oscillator
 * note reads as "a synth playing a note" no matter how short you make it,
 * while a real piece landing on a board is fundamentally noise (a broadband
 * transient) shaped by the wood/board's resonance, not a pitch. Only the
 * alert/chime sounds (check, low time, game start/over) stay oscillator-
 * based, since those are meant to read as a notification tone, not an
 * object touching another object.
 */

let ctx: AudioContext | null = null;

// Module-level mute switch driven by the Settings page's "Move sounds"
// toggle (see SettingsContext.tsx / Game.tsx), checked once at the top of
// each play function rather than threading an `enabled` flag through every
// call site.
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
   *  over `duration` instead of holding steady. */
  freqEnd?: number;
}

/** Oscillator tones for the alert/chime sounds only (check, low time, game
 *  start/over) — a clean pitched note is exactly right for a notification
 *  cue, it just isn't right for something that's supposed to sound like an
 *  object landing on a board (see playImpact below for that). */
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

interface ImpactLayer {
  startOffset: number; // seconds from the sound's start
  duration: number; // seconds, envelope length
  gain: number; // peak gain
  /** Resonant filter center frequency in Hz. Low (~150-350Hz) reads as the
   *  hollow wood-on-wood "body" of the knock; high (~1800-4000Hz) reads as
   *  the initial hard "click" of the contact itself. Real impacts are a mix
   *  of both, which is why every impact sound below layers at least two of
   *  these rather than using just one. */
  freq: number;
  /** Filter resonance/narrowness. Higher = more "ringy"/tonal, lower =
   *  more "thuddy"/broadband. Body layers want low Q (2-4), click layers
   *  want a bit more (3-6) so they read as a distinct transient. */
  q: number;
  filterType?: BiquadFilterType; // defaults to 'bandpass'
  /** Attack time in seconds. Real material contact is near-instant
   *  (<=2ms); left adjustable since the very first layer of a bigger
   *  impact (capture, berserk) sometimes wants a hair softer attack so it
   *  doesn't click before the noise buffer has any energy in it. */
  attack?: number;
}

/** A single resonant-filtered noise burst: white noise (a real physical
 *  contact's actual raw energy) shaped by a bandpass filter (the
 *  material's resonance) and a fast-attack/exponential-decay envelope (the
 *  actual shape of an impact — instant onset, quick decay, no sustain).
 *  This is the core primitive every piece-contact sound below is built
 *  from instead of an oscillator, which is what makes them read as an
 *  object hitting a surface rather than a synth blip. */
function playImpactLayer(layer: ImpactLayer) {
  const audioCtx = ensureAudioContext();
  const start = audioCtx.currentTime + layer.startOffset;
  const attack = layer.attack ?? 0.002;

  const bufferSize = Math.max(1, Math.ceil(audioCtx.sampleRate * layer.duration));
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = layer.filterType ?? 'bandpass';
  filter.frequency.value = layer.freq;
  filter.Q.value = layer.q;

  const gainNode = audioCtx.createGain();
  gainNode.gain.setValueAtTime(0, start);
  gainNode.gain.linearRampToValueAtTime(layer.gain, start + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + layer.duration);

  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  source.start(start);
  source.stop(start + layer.duration + 0.02);
}

function playImpact(layers: ImpactLayer[]) {
  if (!soundEnabled) return;
  ensureAudioContext();
  for (const layer of layers) playImpactLayer(layer);
}

/** A normal move: a piece set down gently. Two layers — a quiet, brief high
 *  click for the instant of contact, and a soft low body thud for the
 *  board absorbing it — same physical recipe as a real piece placement,
 *  just at low gain and a short body decay since a normal move should read
 *  as "gentle contact", not an impact you'd notice across the room. */
export function playMoveSound() {
  playImpact([
    { startOffset: 0, duration: 0.02, gain: 0.05, freq: 2600, q: 4 }, // contact click
    { startOffset: 0, duration: 0.05, gain: 0.16, freq: 210, q: 2.4 }, // wood body thud
  ]);
}

/** A capture: a piece struck down harder, like it's being knocked off its
 *  square and set down in one motion. Same two-layer recipe as a normal
 *  move — click + body — just louder, a touch sharper on the click, and a
 *  deeper/longer body layer so it reads as a bigger, harder contact rather
 *  than a different kind of sound entirely; a capture should still sound
 *  unmistakably like the same board, just a harder hit. */
export function playCaptureSound() {
  playImpact([
    { startOffset: 0, duration: 0.03, gain: 0.11, freq: 3200, q: 5 }, // sharper crack
    { startOffset: 0.006, duration: 0.09, gain: 0.26, freq: 165, q: 2.2 }, // deeper body thud
  ]);
}

/** A clean two-strike bell for check: each strike is a sine fundamental
 *  with a quiet octave-up sine layered on top (the overtone that makes a
 *  bell read as a bell rather than a flat tone), rising a third from the
 *  first strike to the second. This is a notification cue, not a physical
 *  contact sound, so it's the one place a clean oscillator tone is exactly
 *  right rather than something to avoid. */
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

/** A powerful stinger for berserk: the same click+body impact recipe as
 *  playCaptureSound, scaled up (wider/louder click, deeper/longer body),
 *  plus a quick sine shimmer layered on top purely as a "declaration"
 *  accent — not the impact itself, which is why it's kept as a short quiet
 *  ping rather than a siren sweep. Still the loudest sound in this file on
 *  purpose. */
export function playBerserkSound() {
  playImpact([
    { startOffset: 0, duration: 0.045, gain: 0.16, freq: 3000, q: 4.5 }, // wide crack
    { startOffset: 0.008, duration: 0.16, gain: 0.34, freq: 130, q: 2 }, // deep body thud
  ]);
  playTones([
    { freq: 880, startOffset: 0.02, duration: 0.1, type: 'sine', gain: 0.08 },
    { freq: 1760, startOffset: 0.02, duration: 0.07, type: 'sine', gain: 0.04 },
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
