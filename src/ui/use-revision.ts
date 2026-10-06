import { useCallback, useSyncExternalStore } from 'react';

/** Something that notifies on change and exposes a number that changes with it. */
export interface RevisionSource {
  subscribe(listener: () => void): () => void;
  readonly revision: number;
}

/** Re-renders the calling component whenever `source` changes. */
export function useRevision(source: RevisionSource): number {
  const subscribe = useCallback((notify: () => void) => source.subscribe(notify), [source]);
  return useSyncExternalStore(subscribe, () => source.revision);
}
