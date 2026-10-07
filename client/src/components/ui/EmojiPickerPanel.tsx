import EmojiPicker, { EmojiStyle, Theme, type EmojiClickData } from "emoji-picker-react";

/** The actual picker, kept in its own file so `emoji-picker-react` (which is
 *  fairly large) is only downloaded the first time someone opens it, see the
 *  React.lazy import in EmojiInput.tsx. Native emoji (no image CDN), no
 *  preview bar, to keep it compact. */
export default function EmojiPickerPanel({
  dark,
  width,
  height,
  onPick,
}: {
  dark: boolean;
  width: number;
  height: number;
  onPick: (emoji: string) => void;
}) {
  return (
    <EmojiPicker
      onEmojiClick={(d: EmojiClickData) => onPick(d.emoji)}
      theme={dark ? Theme.DARK : Theme.LIGHT}
      emojiStyle={EmojiStyle.NATIVE}
      width={width}
      height={height}
      lazyLoadEmojis
      skinTonesDisabled
      previewConfig={{ showPreview: false }}
      searchPlaceholder="Search emoji"
    />
  );
}
