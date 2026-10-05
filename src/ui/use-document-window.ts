import { useEffect } from 'react';
import type { DocumentSession } from './session/document-session';
import { useRevision } from './use-revision';

/**
 * Keeps the window title in step with the document ("● name — Pixelsoup" when there are
 * unsaved changes) and asks before the page is closed or reloaded with unsaved changes.
 */
export function useDocumentWindow(session: DocumentSession): void {
  useRevision(session);
  const { name, isDirty } = session;

  useEffect(() => {
    document.title = `${isDirty ? '● ' : ''}${name} — Pixelsoup`;
  }, [name, isDirty]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!session.isDirty) return;
      e.preventDefault();
      // Older browsers only ask when returnValue is set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [session]);
}
