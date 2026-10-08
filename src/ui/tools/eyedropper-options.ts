/** Where the eyedropper samples: the composite of the visible layers, or the active layer. */
export type SampleSource = 'composite' | 'layer';

/** The eyedropper's settings, observable so the tool-options bar can show and change them. */
export class EyedropperOptions {
  private current: SampleSource = 'composite';
  private readonly listeners = new Set<() => void>();

  get source(): SampleSource {
    return this.current;
  }

  setSource(source: SampleSource): void {
    if (source === this.current) return;
    this.current = source;
    for (const listener of [...this.listeners]) listener();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
