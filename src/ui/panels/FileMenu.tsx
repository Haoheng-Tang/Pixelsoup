import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { AppController, FileCommand } from '../session/app-controller';
import { formatShortcut } from '../use-file-shortcuts';

interface MenuItem {
  readonly command: FileCommand;
  readonly label: string;
  readonly shortcut?: string;
}

const SECTIONS: readonly (readonly MenuItem[])[] = [
  [
    { command: 'new', label: 'New…', shortcut: 'N' },
    { command: 'open', label: 'Open…', shortcut: 'O' },
    { command: 'import', label: 'Import Image as Layer…' },
  ],
  [
    { command: 'save', label: 'Save', shortcut: 'S' },
    { command: 'save-as', label: 'Save As…', shortcut: 'Shift+S' },
    { command: 'export', label: 'Export…', shortcut: 'Shift+E' },
  ],
  [{ command: 'close', label: 'Close' }],
  [{ command: 'demo', label: 'Demo Document' }],
];

/** The File menu button and its drop-down (WAI-ARIA menu button pattern). */
export function FileMenu({ controller }: { controller: AppController }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // Which item to focus when the menu opens: first or last.
  const focusOnOpen = useRef<'first' | 'last'>('first');

  useEffect(() => {
    if (!open) return;
    const list = menuItems(menuRef.current);
    (focusOnOpen.current === 'first' ? list[0] : list[list.length - 1])?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openMenu = (focus: 'first' | 'last') => {
    focusOnOpen.current = focus;
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (command: FileCommand) => {
    close();
    // Synchronously, inside the click or key press, so file pickers can open.
    controller.run(command);
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu(e.key === 'ArrowDown' ? 'first' : 'last');
    }
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent) => {
    const list = menuItems(menuRef.current);
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        focusAt(index < 0 ? -1 : index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(-1);
        break;
      case 'Escape':
        close();
        break;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : openMenu('first'))}
        onKeyDown={onTriggerKeyDown}
      >
        File
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="menu-list"
          role="menu"
          aria-label="File"
          onKeyDown={onMenuKeyDown}
        >
          {SECTIONS.map((section, i) => (
            <Fragment key={section[0]?.command}>
              {i > 0 && <div role="separator" className="menu-separator" />}
              {section.map(({ command, label, shortcut }) => (
                <button
                  key={command}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="menu-item"
                  onClick={() => choose(command)}
                  aria-keyshortcuts={shortcut ? ariaShortcut(shortcut) : undefined}
                >
                  <span>{label}</span>
                  {shortcut && <kbd className="menu-shortcut">{formatShortcut(shortcut)}</kbd>}
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/** The menu's items in order. */
function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return [...(menu?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
}

/** "Shift+S" → "Control+Shift+S Meta+Shift+S" for aria-keyshortcuts. */
function ariaShortcut(keys: string): string {
  return `Control+${keys} Meta+${keys}`;
}
