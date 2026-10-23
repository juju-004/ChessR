import { memo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn.js";
import { springSoft } from "@/lib/motion.js";
import { useAfterPageAnimation } from "@/lib/pageAnimationGate.js";

export interface RCoinProps {
  /** Pixel size (square). Default 20. */
  size?: number;
  className?: string;
  /** Plays a one-shot flip-in on mount. */
  animateIn?: boolean;
  /**
   * Level of detail. `auto` (default) picks full detail at 32px and up and a
   * cheaper flat version below. `flat` forces the cheap version (use it for
   * big, faint decorations like a watermark, where the drop-shadow filter and
   * milled edge are invisible but expensive). `full` forces full detail.
   */
  detail?: "auto" | "flat" | "full";
  /**
   * Wait for the page's entrance animation to finish before mounting the
   * icon (a same-size empty box holds the layout meanwhile). Default true.
   * Set false for an icon that must be there on the very first frame.
   */
  defer?: boolean;
}

// Below this pixel size the milled edge (48 individually-drawn <line>s) and
// the feDropShadow filter are invisible anyway and pure rendering cost.
const FULL_DETAIL_MIN_SIZE = 32;

/*
 * The coin artwork is defined ONCE, in a hidden SVG sprite appended to the
 * document the first time an RCoin renders. Every RCoin is then just a tiny
 * <svg><use href="#rcoin-flat|full"/></svg>.
 *
 * Before this, every instance carried its own 7 gradient/filter <defs> and
 * ~10 paths. A page like Buy Coins renders a dozen of them, which is a lot of
 * DOM + gradient setup to do while the page is also fading in. Now each
 * instance is one <use> node and the gradients are shared.
 *
 * The sprite is 0x0 with overflow hidden rather than display:none, because
 * some browsers refuse to resolve gradients/filters that live inside a
 * display:none <svg>.
 */
const SPRITE_ID = "rcoin-sprite";

const R_PATH =
  "M 44 37 H 68 C 78 37 85 43 85 52 C 85 59 80 64 73 66.5 C 76.5 68 79 71 81.5 76.5 L 86 87 H 74.5 L 70.5 77.5 C 68.5 72.5 65.5 70.5 58.5 70.5 H 55 V 87 H 44 Z " +
  "M 55 46.5 V 61 H 66 C 71 61 74 58.5 74 53.7 C 74 49 71 46.5 66 46.5 Z";

function milledEdge(): string {
  let out = '<g stroke-width="1.4">';
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out +=
      `<line x1="${(64 + c * 56.5).toFixed(2)}" y1="${(64 + s * 56.5).toFixed(2)}" ` +
      `x2="${(64 + c * 60.5).toFixed(2)}" y2="${(64 + s * 60.5).toFixed(2)}" ` +
      `stroke="${i % 2 === 0 ? "#fff2c4" : "#5c3a06"}" stroke-opacity=".4"/>`;
  }
  return out + "</g>";
}

function coinBody(full: boolean): string {
  return (
    `<circle cx="64" cy="64" r="60" fill="url(#rcoin-rim)"${full ? ' filter="url(#rcoin-shadow)"' : ""}/>` +
    (full ? milledEdge() : "") +
    '<circle cx="64" cy="64" r="54" fill="none" stroke="url(#rcoin-rim-inner)" stroke-width="3.5"/>' +
    '<circle cx="64" cy="64" r="50.5" fill="none" stroke="#3d2405" stroke-opacity=".5" stroke-width="1.5"/>' +
    '<circle cx="64" cy="64" r="46" fill="url(#rcoin-center)"/>' +
    '<circle cx="64" cy="64" r="46" fill="url(#rcoin-vignette)"/>' +
    '<circle cx="64" cy="64" r="46" fill="none" stroke="#0f172a" stroke-opacity=".32" stroke-width="1.5"/>' +
    '<circle cx="64" cy="64" r="41" fill="none" stroke="url(#rcoin-shine)" stroke-width="3" stroke-linecap="round" stroke-dasharray="55 258" stroke-dashoffset="-6" transform="rotate(-55 64 64)"/>' +
    '<g transform="rotate(-2 64 64)">' +
    `<path d="${R_PATH}" fill="#0c051f" opacity=".85" transform="translate(2.5, 3.2)"/>` +
    `<path d="${R_PATH}" fill="#784e11" stroke="#523207" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="${R_PATH}" fill="url(#rcoin-letter)" stroke="#fff8d6" stroke-width=".5" stroke-linejoin="round" paint-order="stroke fill"/>` +
    '<path d="M 44 37.5 H 68 C 77.5 37.5 84 43 84 52 C 84 58 79.5 63 72.5 65.5" fill="none" stroke="#fff" stroke-width="1.25" stroke-linecap="round" opacity=".9"/>' +
    '<path d="M 45 37.5 V 86" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".85"/>' +
    '<path d="M 56 47.5 V 59.8 H 65.5 C 69.8 59.8 72.5 57.5 72.5 53.7 C 72.5 49.8 69.8 47.5 65.5 47.5" fill="none" stroke="#fffbe3" stroke-width=".8" stroke-linecap="round" opacity=".75"/>' +
    '<path d="M 60 70.5 C 66.5 70.5 69.5 72.5 71.5 77.5 L 75.5 87" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".8"/>' +
    "</g>"
  );
}

function spriteMarkup(): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false" ' +
    'style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none">' +
    "<defs>" +
    '<linearGradient id="rcoin-rim" x1="0.1" y1="0.1" x2="0.9" y2="0.9">' +
    '<stop offset="0%" stop-color="#fff8dc"/><stop offset="15%" stop-color="#ffe88c"/><stop offset="34%" stop-color="#f5bf45"/>' +
    '<stop offset="56%" stop-color="#c88a20"/><stop offset="78%" stop-color="#87580f"/><stop offset="100%" stop-color="#422806"/></linearGradient>' +
    '<linearGradient id="rcoin-rim-inner" x1="0.05" y1="0.05" x2="0.95" y2="0.95">' +
    '<stop offset="0%" stop-color="#fffce9"/><stop offset="20%" stop-color="#ffdf70"/><stop offset="52%" stop-color="#d39a29"/>' +
    '<stop offset="78%" stop-color="#9a6413"/><stop offset="100%" stop-color="#65400a"/></linearGradient>' +
    '<radialGradient id="rcoin-center" cx="34%" cy="25%" r="82%">' +
    '<stop offset="0%" stop-color="#b9d9ff"/><stop offset="18%" stop-color="#75a8f5"/><stop offset="40%" stop-color="#4c7ee0"/>' +
    '<stop offset="67%" stop-color="#6142b4"/><stop offset="88%" stop-color="#3b2675"/><stop offset="100%" stop-color="#21133f"/></radialGradient>' +
    '<radialGradient id="rcoin-vignette" cx="50%" cy="45%" r="58%">' +
    '<stop offset="50%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".42"/></radialGradient>' +
    '<linearGradient id="rcoin-letter" x1="0.1" y1="0" x2="0.9" y2="1">' +
    '<stop offset="0%" stop-color="#ffffff"/><stop offset="18%" stop-color="#fff2be"/><stop offset="36%" stop-color="#f7d070"/>' +
    '<stop offset="58%" stop-color="#cf9028"/><stop offset="76%" stop-color="#fceaa2"/><stop offset="100%" stop-color="#8c5811"/></linearGradient>' +
    '<linearGradient id="rcoin-shine" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#fff" stop-opacity=".95"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '<filter id="rcoin-shadow" x="-30%" y="-30%" width="160%" height="160%">' +
    '<feDropShadow dx="0" dy="5" stdDeviation="6" flood-opacity=".4"/></filter>' +
    `<symbol id="rcoin-flat" viewBox="0 0 128 128">${coinBody(false)}</symbol>` +
    `<symbol id="rcoin-full" viewBox="0 0 128 128">${coinBody(true)}</symbol>` +
    "</defs></svg>"
  );
}

let spriteInjected = false;
function ensureSprite() {
  if (spriteInjected || typeof document === "undefined") return;
  if (document.getElementById(SPRITE_ID)) {
    spriteInjected = true;
    return;
  }
  const host = document.createElement("div");
  host.id = SPRITE_ID;
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  host.innerHTML = spriteMarkup();
  document.body.appendChild(host);
  spriteInjected = true;
}

/**
 * Premium Rabah Coin
 *
 * A beveled gold coin with a sapphire/purple center and custom-minted
 * champagne-gold R emblem. Artwork lives in a shared sprite (see above), and
 * by default the icon mounts only after the page's entrance animation ends,
 * fading in on the compositor (opacity only).
 */
export const RCoin = memo(function RCoin({
  size = 20,
  className,
  animateIn = false,
  detail = "auto",
  defer = true,
}: RCoinProps) {
  const ready = useAfterPageAnimation(defer);

  // Same-size empty box until it's time to draw, so nothing shifts when the
  // coin appears. Keeps the className so absolutely-positioned decorations
  // (the watermark) stay where they belong.
  if (!ready) {
    return (
      <span
        aria-hidden="true"
        className={cn("inline-block shrink-0", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  ensureSprite();
  const full = detail === "full" || (detail === "auto" && size >= FULL_DETAIL_MIN_SIZE);

  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", defer && "rcoin-fade-in", className)}
      aria-hidden="true"
    >
      <use href={full ? "#rcoin-full" : "#rcoin-flat"} />
    </svg>
  );

  if (!animateIn) {
    return svg;
  }

  return (
    <motion.span
      className="inline-flex"
      initial={{
        opacity: 0,
        rotateY: 90,
      }}
      animate={{
        opacity: 1,
        rotateY: 0,
      }}
      transition={springSoft}
      style={{
        perspective: 200,
      }}
    >
      {svg}
    </motion.span>
  );
});

/**
 * Icon + amount.
 *
 * Example:
 * <RCoinAmount value={250} />
 */
export function RCoinAmount({
  value,
  size = 16,
  className,
}: {
  value: number | string;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <RCoin size={size} />
      {value}
    </span>
  );
}
