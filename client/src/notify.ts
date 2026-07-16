/**
 * Lightweight in-app notification banners, rendered into #global-alert.
 *
 * Deliberately NOT using window.confirm()/alert() for real-time events like
 * incoming challenges: those are synchronous, blocking dialogs, and browsers
 * are inconsistent about surfacing them promptly (or at all) on a background/
 * unfocused tab — which made incoming challenges look like they were silently
 * not arriving, when the socket event had actually fired correctly.
 */

export function showActionBanner(
  message: string,
  actions: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' | 'danger' }[],
  autoDismissMs?: number,
): HTMLElement {
  const container = document.getElementById('global-alert');
  if (!container) throw new Error('#global-alert container missing from index.html');

  const card = document.createElement('div');
  card.className = 'notify-card';

  const p = document.createElement('p');
  p.textContent = message;
  card.appendChild(p);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'actions';

  for (const action of actions) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    if (action.variant && action.variant !== 'primary') btn.className = action.variant;
    btn.addEventListener('click', () => {
      action.onClick();
      card.remove();
    });
    actionsEl.appendChild(btn);
  }
  card.appendChild(actionsEl);

  container.appendChild(card);

  if (autoDismissMs) {
    setTimeout(() => card.remove(), autoDismissMs);
  }

  return card;
}

export function showToast(message: string, durationMs = 4000): void {
  showActionBanner(message, [], durationMs);
}
