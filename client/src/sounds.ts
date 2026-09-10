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
  if (audioCtx.state === "suspended") void audioCtx.resume();
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
    osc.type = tone.type ?? "sine";

    const start = now + tone.startOffset;
    osc.frequency.setValueAtTime(tone.freq, start);
    if (tone.freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(
        tone.freqEnd,
        start + tone.duration,
      );
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

  const bufferSize = Math.max(
    1,
    Math.ceil(audioCtx.sampleRate * layer.duration),
  );
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = layer.filterType ?? "bandpass";
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

/** Small per-call pitch jitter so repeated moves don't all sound like the
 *  exact same sample on a loop — real pieces landing never resonate at
 *  identically the same frequency twice. +/-4% is subtle enough to still
 *  read as "the same sound" while killing the machine-gun repetition. */
function jitter(freq: number, amount = 0.04): number {
  return freq * (1 + (Math.random() * 2 - 1) * amount);
}

/** A normal move: chess.com's actual move cue is a crisp, present "click"
 *  — brighter and punchier than a dull thud, with real top-end snap to it,
 *  not just a low knock. Three layers: a bright, near-instant click for
 *  the piece's initial edge contact (this is what was missing before and
 *  made it read as "low"/muffled), a mid tap for the felt-bottomed piece
 *  meeting the square, and a low body knock underneath for weight. Gains
 *  pushed up and attacks tightened across the board so the transient
 *  actually snaps instead of easing in. */
export function playMoveSound() {
  playImpact([
    {
      startOffset: 0,
      duration: 0.018,
      gain: 0.26,
      freq: jitter(2600),
      q: 5,
      attack: 0.001,
    }, // bright click
    {
      startOffset: 0.001,
      duration: 0.035,
      gain: 0.24,
      freq: jitter(1100),
      q: 3.4,
      attack: 0.001,
    }, // piece contact tap
    {
      startOffset: 0,
      duration: 0.06,
      gain: 0.2,
      freq: jitter(220),
      q: 2.4,
      attack: 0.002,
    }, // wood body knock
  ]);
}

/** Capture: single hit, same click+tap+body recipe as playMoveSound —
 *  no double-hit, since nothing physically knocks a captured piece off
 *  the board here, just louder and sharper than a plain move so it still
 *  reads as the bigger event. */
export function playCaptureSound() {
  playImpact([
    {
      startOffset: 0,
      duration: 0.02,
      gain: 0.3,
      freq: jitter(2800),
      q: 5.5,
      attack: 0.001,
    }, // bright click
    {
      startOffset: 0.001,
      duration: 0.038,
      gain: 0.28,
      freq: jitter(1050),
      q: 3.6,
      attack: 0.001,
    }, // piece contact tap
    {
      startOffset: 0,
      duration: 0.075,
      gain: 0.28,
      freq: jitter(195),
      q: 2.3,
      attack: 0.002,
    }, // deep body thud
  ]);
}

/** Check: chess.com's check cue is a short, flat double-tap alert rather
 *  than lichess's bell/chime — closer to a UI notification "ping-ping"
 *  than a musical note. Built from square-wave tones (a harder, less
 *  "musical" timbre than the old sine-bell version) at a single pitch
 *  repeated twice, quiet and quick so it reads as an alert layered over
 *  the move/capture sound rather than a separate melody. */
export function playCheckSound() {
  playTones([
    { freq: 1175, startOffset: 0, duration: 0.07, type: "square", gain: 0.12 },
    {
      freq: 1175,
      startOffset: 0.1,
      duration: 0.09,
      type: "square",
      gain: 0.12,
    },
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

/** Berserk: chess.com's berserk cue reads as a quick rising "power-up"
 *  flourish rather than an impact — closer in spirit to its own
 *  game-start chime than to a move/capture sound, just faster and more
 *  aggressive. Three-note rising square-wave sweep (each note itself
 *  ramping upward) landing on a sharp double-hit impact at the top, so it
 *  lands with the same tap+body punch as a capture right as the
 *  flourish peaks. Still the loudest, busiest sound in this file on
 *  purpose — it's a one-off declaration, not a per-move cue. */
export function playBerserkSound() {
  playTones([
    {
      freq: 440,
      freqEnd: 660,
      startOffset: 0,
      duration: 0.06,
      type: "square",
      gain: 0.1,
    },
    {
      freq: 660,
      freqEnd: 990,
      startOffset: 0.05,
      duration: 0.06,
      type: "square",
      gain: 0.11,
    },
    {
      freq: 990,
      freqEnd: 1480,
      startOffset: 0.1,
      duration: 0.08,
      type: "square",
      gain: 0.12,
    },
  ]);
  playImpact([
    { startOffset: 0.17, duration: 0.03, gain: 0.3, freq: 1400, q: 3.5, attack: 0.002 }, // landing tap
    { startOffset: 0.17, duration: 0.15, gain: 0.4, freq: 150, q: 2, attack: 0.003 }, // deep body thud
  ]);
}

/** A sharp double-beep, the clock just crossed into "you're running low"
 *  territory. Deliberately higher-pitched and more clipped than the check
 *  alert so it reads as "look at the clock" rather than "look at the
 *  board". Fires once per crossing (see the ref-guarded effect in
 *  Game.tsx), not on every tick while time stays low. */
export function playLowTimeSound() {
  playTones([
    { freq: 1046, startOffset: 0, duration: 0.08, type: "square", gain: 0.16 },
    {
      freq: 1046,
      startOffset: 0.12,
      duration: 0.08,
      type: "square",
      gain: 0.16,
    },
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
