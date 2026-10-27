let ctx: AudioContext | null = null;

// Module-level mute switch driven by the Settings page's "Move sounds"
// toggle (see SettingsContext.tsx / Game.tsx), checked once at the top of
// each play function rather than threading an `enabled` flag through every
// call site.
let soundEnabled = true;

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
}

const isIOS =
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** iOS plays Web Audio as "ambient" audio by default: the hardware silent
 *  switch mutes it completely (users who hear nothing) and it follows the
 *  quiet ringer volume (users who hear it very low). Declaring the page's
 *  audio as "playback" makes it behave like media: silent switch ignored,
 *  media volume used. Supported on iOS 16.4+; a no-op everywhere else. */
function setPlaybackAudioSession() {
  try {
    const session = (navigator as any).audioSession;
    if (session && session.type !== "playback") session.type = "playback";
  } catch {
    /* unsupported, nothing to do */
  }
}

let outputNode: AudioNode | null = null;
let outputCtx: AudioContext | null = null;

/** Every sound connects here instead of straight to ctx.destination. iOS
 *  renders Web Audio noticeably quieter than the same file played by a
 *  media element, so on iOS a master gain lifts everything and a limiter
 *  right behind it keeps the boost from clipping. */
function getOutput(audioCtx: AudioContext): AudioNode {
  if (outputNode && outputCtx === audioCtx) return outputNode;
  const master = audioCtx.createGain();
  master.gain.value = isIOS ? 2 : 1;
  const limiter = audioCtx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  master.connect(limiter);
  limiter.connect(audioCtx.destination);
  outputNode = master;
  outputCtx = audioCtx;
  return master;
}

function getCtx(): AudioContext {
  setPlaybackAudioSession();
  // A closed context can never be reopened; make a fresh one.
  if (!ctx || ctx.state === "closed") ctx = new AudioContext();
  return ctx;
}

function ensureAudioContext(): AudioContext {
  const audioCtx = getCtx();
  // Not just "suspended": iOS also parks the context in a non-standard
  // "interrupted" state after a call, Siri, or backgrounding the app, and
  // it stays silent until resumed.
  if ((audioCtx.state as string) !== "running") void audioCtx.resume().catch(() => {});
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
    gainNode.connect(getOutput(audioCtx));
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
  gainNode.connect(getOutput(audioCtx));
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
/** Sept 18 2026: move/capture switched from synthesized tones to David's
 *  own real audio files (client/public/sounds/move-self.mp3,
 *  client/public/sounds/capture.mp3) — replaces the plucked-woodblock
 *  synthesis this comment used to describe. Decoded once via
 *  AudioContext.decodeAudioData and cached as an AudioBuffer (a plain
 *  `new Audio(url)` per play would re-fetch/re-decode every single move),
 *  then played through a BufferSourceNode + GainNode each time, the same
 *  destination-routing pattern every other sound in this file uses, so
 *  the soundEnabled gate and AudioContext lifecycle stay consistent
 *  across synthesized and file-based sounds alike. */
const SOUND_FILES = {
  move: "/sounds/move-self.mp3",
  capture: "/sounds/capture.mp3",
  check: "/sounds/move-check.mp3",
} as const;

const bufferCache = new Map<string, Promise<AudioBuffer>>();

// getCtx() rather than ensureAudioContext(): decoding doesn't need a
// running context, just an existing one to decode into, and this is
// called from the module-level preload below (before any user gesture),
// where resuming a suspended AudioContext would just be silently ignored
// by the browser's autoplay policy anyway. ensureAudioContext()'s
// resume() call happens separately in playSoundFile, right at actual
// play time, which is always inside a real user gesture (a drag, a click).
function loadSoundBuffer(url: string): Promise<AudioBuffer> {
  let pending = bufferCache.get(url);
  if (!pending) {
    const audioCtx = getCtx();
    pending = fetch(url)
      .then((res) => res.arrayBuffer())
      .then((data) => audioCtx.decodeAudioData(data));
    bufferCache.set(url, pending);
    // Don't cache a failed decode/fetch, a later play call should get to
    // retry (e.g. the first attempt raced the network) rather than being
    // stuck replaying the same rejected promise forever.
    pending.catch(() => bufferCache.delete(url));
  }
  return pending;
}

function playSoundFile(url: string, gain = 0.85) {
  if (!soundEnabled) return;
  const audioCtx = ensureAudioContext();
  loadSoundBuffer(url)
    .then((buffer) => {
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = gain;
      source.connect(gainNode);
      gainNode.connect(getOutput(audioCtx));
      source.start();
    })
    .catch((err) => console.error(`Failed to play sound ${url}:`, err));
}

// Kicks off the fetch+decode for both files as soon as this module is
// live rather than waiting for the first move, so the first move of a
// game doesn't pay the network+decode latency the cache exists to avoid
// for every move after it. Best-effort: if this fails (offline, etc.),
// playSoundFile's own loadSoundBuffer call retries on the actual
// move/capture event.
void Promise.all(Object.values(SOUND_FILES).map(loadSoundBuffer)).catch(
  () => {},
);

/** A normal move: David's own move-self.mp3. */
export function playMoveSound() {
  playSoundFile(SOUND_FILES.move);
}

/** Capture: David's own capture.mp3, a hair louder than a plain move so
 *  it still reads as the bigger event. */
export function playCaptureSound() {
  playSoundFile(SOUND_FILES.capture, 0.95);
}

/** Check: the real move-check.mp3 file (client/public/sounds/move-check.mp3),
 *  the same file-based path as move/capture above. It plays instead of the
 *  plain move/capture file for a move that gives check (see
 *  playSoundForMove in components/game/types.ts), so it doubles as that
 *  move's sound. Kept at the capture's volume since it's the bigger event. */
export function playCheckSound() {
  playSoundFile(SOUND_FILES.check, 0.95);
}

/** A gentle ascending chime when a game starts. */
export function playGameStartSound() {
  playTones([
    { freq: 440, startOffset: 0, duration: 0.12 },
    { freq: 554, startOffset: 0.1, duration: 0.12 },
    { freq: 659, startOffset: 0.2, duration: 0.2 },
  ]);
}

/** Hard-clipping curve for the berserk growl. */
function makeGrowlCurve() {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 60;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}
// Built once, reused (return type inferred so it matches the DOM typings
// of whichever TypeScript version is installed).
let growlCurve: ReturnType<typeof makeGrowlCurve> | null = null;
function getGrowlCurve() {
  return (growlCurve ??= makeGrowlCurve());
}

/** Berserk: an aggressive snarl in the spirit of lichess's berserk cue. A
 *  steel "shing" (high-passed noise sweeping up) cuts in first, then a hard
 *  slam lands while a heavily distorted, tremolo-chopped sawtooth growl
 *  drops underneath it. Dark, gritty and loud on purpose, a one-off
 *  declaration that can't be mistaken for the bright check/low-time
 *  alerts. */
export function playBerserkSound() {
  if (!soundEnabled) return;
  const audioCtx = ensureAudioContext();
  const now = audioCtx.currentTime;

  // Growl: two detuned saws -> hard clip -> low-pass, amplitude chopped by a
  // fast LFO so it snarls instead of droning.
  const growlStart = now + 0.1;
  const growlLen = 0.6;
  const shaper = audioCtx.createWaveShaper();
  shaper.curve = getGrowlCurve();
  shaper.oversample = "2x";
  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(1800, growlStart);
  lowpass.frequency.exponentialRampToValueAtTime(400, growlStart + growlLen);
  const growlGain = audioCtx.createGain();
  growlGain.gain.setValueAtTime(0, growlStart);
  growlGain.gain.linearRampToValueAtTime(0.5, growlStart + 0.02);
  growlGain.gain.exponentialRampToValueAtTime(0.0001, growlStart + growlLen);
  const chop = audioCtx.createGain();
  chop.gain.value = 0.7;
  const lfo = audioCtx.createOscillator();
  lfo.type = "square";
  lfo.frequency.value = 32;
  const lfoDepth = audioCtx.createGain();
  lfoDepth.gain.value = 0.3;
  lfo.connect(lfoDepth);
  lfoDepth.connect(chop.gain);
  for (const [f0, f1] of [
    [118, 62],
    [124, 66],
  ]) {
    const osc = audioCtx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f0, growlStart);
    osc.frequency.exponentialRampToValueAtTime(f1, growlStart + growlLen);
    osc.connect(shaper);
    osc.start(growlStart);
    osc.stop(growlStart + growlLen + 0.02);
  }
  shaper.connect(lowpass);
  lowpass.connect(chop);
  chop.connect(growlGain);
  growlGain.connect(getOutput(audioCtx));
  lfo.start(growlStart);
  lfo.stop(growlStart + growlLen + 0.02);

  // Slam: low pitch-dropping thump under the growl's attack.
  playTones([
    { freq: 150, freqEnd: 40, startOffset: 0.1, duration: 0.3, type: "sine", gain: 0.55 },
    // Rising stab: the "RAAH" in front of the growl.
    { freq: 180, freqEnd: 360, startOffset: 0, duration: 0.12, type: "sawtooth", gain: 0.1 },
  ]);
  playImpact([
    // Steel shing: bright noise sweeping up into the hit.
    { startOffset: 0, duration: 0.14, gain: 0.22, freq: 6500, q: 0.8, filterType: "highpass", attack: 0.09 },
    // Slam: sharp crack + heavy body.
    { startOffset: 0.1, duration: 0.03, gain: 0.5, freq: 2400, q: 3, attack: 0.001 },
    { startOffset: 0.1, duration: 0.28, gain: 0.7, freq: 120, q: 1.5, attack: 0.002 },
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

/**
 * Unlocks audio on the first user gesture anywhere on the page.
 *
 * Browsers (iOS Safari especially) keep an AudioContext suspended until it's
 * created/resumed inside a gesture handler. Most sounds are triggered by a
 * drag or click so they resume it themselves, but a sound that fires from a
 * timer or a socket event with no gesture of its own (the low-time warning,
 * an opponent's move) can find it still suspended, for example for a
 * spectator or someone who loaded a game already in progress. Listening for
 * the first pointer/touch/key event covers all of those. Idempotent, and
 * removes its own listeners once the context is actually running.
 */
let audioUnlockInstalled = false;
export function installAudioUnlock() {
  if (audioUnlockInstalled || typeof document === 'undefined') return;
  audioUnlockInstalled = true;
  // touchend, not just touchstart/pointerdown: iOS only counts a completed
  // touch as an activation gesture.
  const events = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
  // The listeners are deliberately never removed: iOS can suspend or
  // "interrupt" the context again later (app switched away, phone call,
  // lock screen), and the next tap has to be able to wake it back up.
  function unlock() {
    try {
      const audioCtx = getCtx();
      if ((audioCtx.state as string) === 'running') return;
      void audioCtx.resume().catch(() => {});
      // Playing one silent sample inside the gesture is the classic iOS
      // unlock, it makes sure output is really live for later sounds.
      const silent = audioCtx.createBuffer(1, 1, 22050);
      const src = audioCtx.createBufferSource();
      src.buffer = silent;
      src.connect(getOutput(audioCtx));
      src.start(0);
    } catch {
      /* AudioContext unavailable; nothing to unlock */
    }
  }
  for (const e of events) document.addEventListener(e, unlock, { capture: true, passive: true });
  // Try to recover on return to the app too (works when iOS allows it, and
  // otherwise the next tap does it).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      try {
        const audioCtx = getCtx();
        if ((audioCtx.state as string) !== 'running') void audioCtx.resume().catch(() => {});
      } catch {
        /* ignore */
      }
    }
  });
  window.addEventListener('pageshow', unlock);
}
