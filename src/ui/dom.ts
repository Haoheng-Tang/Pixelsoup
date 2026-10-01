/** True if keyboard input on `target` should go to the element (typing), not to shortcuts. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset'].includes(
    target.type,
  );
}
