import { useEffect, useState } from "react";
import { Check, Edit } from "lucide-react";
import { Modal } from "./ui/Modal.js";
import { Button, Avatar } from "./ui/index.js";
import {
  AVATAR_GRADIENTS,
  avatarGradientStyle,
  buildAvatarStyle,
  parseAvatarStyle,
} from "../lib/avatarGradients.js";
import { AVATAR_ICONS, AvatarIconGlyph } from "../lib/avatarIcons.js";
import { updateMyProfile } from "../api/users.js";
import { ApiRequestError } from "../api/http.js";
import { useNotify } from "../contexts/NotificationContext.js";
import { cn } from "../lib/cn.js";

const BIO_MAX = 160;

export interface EditProfileModalProps {
  open: boolean;
  onClose: () => void;
  username: string;
  /** The avatar's stored look: "<gradient>" or "<gradient>+<icon>". */
  currentGradient?: string | null;
  currentBio?: string | null;
  /** Called with the fields that actually changed, right after a
   *  successful save, so the profile page can update in place without a
   *  full refetch. */
  onSaved: (patch: { avatarGradient?: string; bio?: string }) => void;
}

/** Small uppercase label above each section of the form. */
function SectionLabel({ children }: { children: string }) {
  return (
    <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-base-content/50">
      {children}
    </p>
  );
}

export function EditProfileModal({
  open,
  onClose,
  username,
  currentGradient,
  currentBio,
  onSaved,
}: EditProfileModalProps) {
  const { notify } = useNotify();
  // The gradient and the optional icon are stored together in one string
  // (see parseAvatarStyle), so split them for editing and join on save.
  const [gradient, setGradient] = useState(parseAvatarStyle(currentGradient).gradientId);
  const [icon, setIcon] = useState<string | null>(parseAvatarStyle(currentGradient).iconId);
  const [bio, setBio] = useState(currentBio ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Start from what's saved every time the dialog opens, so a cancelled
  // edit doesn't leak into the next one.
  useEffect(() => {
    if (!open) return;
    const parsed = parseAvatarStyle(currentGradient);
    setGradient(parsed.gradientId);
    setIcon(parsed.iconId);
    setBio(currentBio ?? "");
    setError("");
  }, [open, currentGradient, currentBio]);

  const avatarStyle = buildAvatarStyle(gradient, icon);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await updateMyProfile({ avatarGradient: avatarStyle, bio: bio.trim() });
      onSaved({ avatarGradient: avatarStyle, bio: bio.trim() });
      notify("Profile updated.", [], 3000);
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal icon={<Edit />} open={open} onClose={onClose} title="Edit profile">
      <div className="flex max-h-[75vh] flex-col gap-6 overflow-y-auto px-3 pb-1">
        {/* Live preview, updates as you pick, so you see exactly what
            everyone else will. */}
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-base-200/60 py-5">
          <Avatar username={username} size="xl" gradient={avatarStyle} />
          <p className="text-sm font-semibold text-base-content">{username}</p>
        </div>

        <div>
          <SectionLabel>Color</SectionLabel>
          <div className="grid grid-cols-5 gap-3">
            {AVATAR_GRADIENTS.map((preset) => {
              const selected = gradient === preset.id;
              const style = avatarGradientStyle(preset.id);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setGradient(preset.id)}
                  title={preset.label}
                  aria-label={preset.label}
                  aria-pressed={selected}
                  style={style}
                  className={cn(
                    "relative mx-auto flex aspect-square w-full max-w-11 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-base-100 transition-shadow",
                    !style && "gradient-brand",
                    selected ? "ring-2 ring-(--primary)" : "hover:ring-2 hover:ring-base-content/20",
                  )}
                >
                  {selected && <Check className="h-5 w-5 drop-shadow" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <SectionLabel>Icon</SectionLabel>
          {/* Each option is drawn on the gradient you've picked. */}
          <div className="grid grid-cols-5 gap-3">
            {[{ id: null, label: "Initials" }, ...AVATAR_ICONS].map((opt) => {
              const selected = icon === opt.id;
              const style = avatarGradientStyle(gradient);
              return (
                <button
                  key={opt.id ?? "initials"}
                  type="button"
                  onClick={() => setIcon(opt.id)}
                  aria-label={opt.label}
                  aria-pressed={selected}
                  className="group flex flex-col items-center gap-1.5"
                >
                  <span
                    style={style}
                    className={cn(
                      "flex aspect-square w-full max-w-11 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white ring-offset-2 ring-offset-base-100 transition-shadow",
                      !style && "gradient-brand",
                      selected
                        ? "ring-2 ring-(--primary)"
                        : "group-hover:ring-2 group-hover:ring-base-content/20",
                    )}
                  >
                    {opt.id ? (
                      <AvatarIconGlyph id={opt.id} className="h-full w-full" />
                    ) : (
                      username.slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-[11px]",
                      selected ? "font-semibold text-base-content" : "text-base-content/50",
                    )}
                  >
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="profile-bio">
            <SectionLabel>Bio</SectionLabel>
          </label>
          <textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
            rows={3}
            placeholder="A short line about you"
            className="w-full resize-none rounded-xl border border-base-300 bg-base-200/60 px-3 py-2.5 text-sm text-base-content outline-none focus:border-(--primary)"
          />
          <p className="mt-1 text-right text-xs text-base-content/40">
            {bio.length}/{BIO_MAX}
          </p>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="glass" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
