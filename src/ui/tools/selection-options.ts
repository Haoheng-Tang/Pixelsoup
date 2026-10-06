import type { SelectionMode } from '../../core';

/**
 * Settings shared by the selection tools: how a new shape combines with the existing
 * selection. Observable so the tool-options bar can show and change it.
 */
export class SelectionOptions {
  private current: SelectionMode = 'replace';
  private readonly listeners = new Set<() => void>();

  get mode(): SelectionMode {
    return this.current;
  }

  setMode(mode: SelectionMode): void {
    if (mode === this.current) return;
    this.current = mode;
    for (const listener of [...this.listeners]) listener();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
