import { useEffect, useState } from 'react';
import type { AppController } from './session/app-controller';

/**
 * How long the drop hint outlasts the last dragover. Browsers repeat dragover at least every
 * 350 ms or so (the spec allows up to 550) while a drag is over the page.
 */
const DRAG_TIMEOUT_MS = 1000;

/** True for a drag that carries files (from the desktop, say), not text or a link. */
export function isFileDrag(types: ArrayLike<string>): boolean {
  return Array.from(types).includes('Files');
}

/**
 * Opens a file dropped anywhere on the page, as File → Open would: a .soup document or an
 * image. Returns true while files are dragged over the page and a drop would open one, to
 * show a hint. The browser's own handling (navigating to the file) never runs; while a
 * dialog is open or a file operation runs, the page refuses the drop.
 */
export function useFileDrop(controller: AppController): boolean {
  const [over, setOver] = useState(false);

  useEffect(() => {
    // dragenter and dragleave fire for every element crossed, so count them to tell when
    // the drag has left the page. dragover repeats while it's over the page, even holding
    // still, so the hint also goes once it stops: a drag cancelled outside the window may
    // never send dragleave.
    let depth = 0;
    let timer = 0;
    const hide = () => {
      depth = 0;
      window.clearTimeout(timer);
      setOver(false);
    };
    const show = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(hide, DRAG_TIMEOUT_MS);
      setOver(!controller.blocked);
    };
    const files = (e: DragEvent): e is DragEvent & { dataTransfer: DataTransfer } =>
      e.dataTransfer !== null && isFileDrag(e.dataTransfer.types);

    const onDragEnter = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      depth++;
      show();
    };
    const onDragOver = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = controller.blocked ? 'none' : 'copy';
      show();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!files(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) hide();
    };
    const onDrop = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      hide();
      controller.openDropped(e.dataTransfer);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [controller]);

  return over;
}
