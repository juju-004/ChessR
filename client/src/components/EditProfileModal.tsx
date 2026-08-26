import { useState } from "react";
import { Modal } from "./ui/Modal.js";
import { Button, Avatar } from "./ui/index.js";
import { AVATAR_GRADIENTS } from "../lib/avatarGradients.js";
import { updateMyProfile } from "../api/users.js";
import { ApiRequestError } from "../api/http.js";
import { useNotify } from "../contexts/NotificationContext.js";
import { cn } from "../lib/cn.js";
import { Edit } from "lucide-react";

const BIO_MAX = 160;

export interface EditProfileModalProps {
  open: boolean;
  onClose: () => void;
  username: string;
  currentGradient?: string | null;
  currentBio?: string | null;
  /** Called with the fields that actually changed, right after a
   *  successful save, so the profile page can update in place without a
   *  full refetch. */
  onSaved: (patch: { avatarGradient?: string; bio?: string }) => void;
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
  const [gradient, setGradient] = useState(currentGradient ?? "brand");
  const [bio, setBio] = useState(currentBio ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await updateMyProfile({ avatarGradient: gradient, bio: bio.trim() });
      onSaved({ avatarGradient: gradient, bio: bio.trim() });
      notify("Profile updated.", [], 3000);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not save changes",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      icon={<Edit></Edit>}
      open={open}
      onClose={onClose}
      title="Edit profile"
    >
      <div className="flex flex-col px-3 gap-5">
        <div>
          <p className="mb-2 ml-2 text-sm font-medium text-base-content/80">
            Avatar gradient
          </p>
          <div className="flex items-center mt-2 mb-5 gap-3">
            <Avatar username={username} size="lg" gradient={gradient} />
            <p className="text-sm text-base-content/60">
              Pick a gradient below. This shows up everywhere your avatar does.
            </p>
          </div>
          <div className="grid grid-cols-5 gap-5">
            {AVATAR_GRADIENTS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setGradient(preset.id)}
                title={preset.label}
                aria-label={preset.label}
                aria-pressed={gradient === preset.id}
                className={cn(
                  "h-9 w-9 overflow-hidden mx-auto -rotate-45 flex flex-col justify-center items-center rounded-full ring-offset-2 ring-offset-base-100 transition-shadow",
                  gradient === preset.id
                    ? "ring-2 ring-(--primary)"
                    : "hover:ring-2 hover:ring-base-content/20",
                )}
              >
                <span
                  style={{ backgroundColor: preset.from }}
                  className={cn("w-full flex-1")}
                ></span>
                <span
                  style={{ backgroundColor: preset.to }}
                  className={cn("w-full flex-1")}
                ></span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="profile-bio"
            className="mb-2 block ml-2 text-sm font-medium text-base-content/80"
          >
            Bio
          </label>
          <textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
            rows={3}
            placeholder="A short line about you (optional)"
            className="w-full resize-none rounded-lg border border-base-300 bg-base-200/60 px-3 py-2 text-sm text-base-content outline-none focus:border-(--primary)"
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
