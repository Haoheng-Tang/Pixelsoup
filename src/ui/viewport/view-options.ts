import { assertNever } from '../../core';

/** The View menu's commands. (Quick Mask will join Extras here.) */
export type ViewCommand = 'extras';

/**
 * How the viewport shows the document, beyond pan and zoom: for now, whether the selection's
 * marching ants show (View → Extras). Session state, like the zoom: not part of the
 * document, never saved and never an undo step. Hiding the ants leaves the selection as it
 * is, and tools work on it as before.
 */
export class ViewOptions {
  private extras = true;
  private revisionCounter = 0;
  private readonly listeners = new Set<() => void>();

  /** Whether the selection's marching ants show. */
  get showExtras(): boolean {
    return this.extras;
  }

  /** Increments on every change, for React external stores. */
  get revision(): number {
    return this.revisionCounter;
  }

  setShowExtras(show: boolean): void {
    if (show === this.extras) return;
    this.extras = show;
    this.revisionCounter++;
    for (const listener of [...this.listeners]) listener();
  }

  toggleExtras(): void {
    this.setShowExtras(!this.extras);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export function runViewCommand(view: ViewOptions, command: ViewCommand): void {
  switch (command) {
    case 'extras':
      view.toggleExtras();
      return;
    default:
      assertNever(command);
  }
}
