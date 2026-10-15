/** A 16 × 16 stroked icon for the tool-options bar's buttons. */
export function OptionsIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A tick: commits what the tool is doing. */
export const COMMIT_ICON = 'M3 8.5 6.5 12 13 4.5';

/** A cross: cancels it. */
export const CANCEL_ICON = 'M4 4l8 8M12 4l-8 8';
