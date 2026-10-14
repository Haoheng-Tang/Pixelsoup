import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { formatShortcut } from '../use-file-shortcuts';

export interface MenuEntry<T extends string> {
  readonly command: T;
  readonly label: string;
  /** Shortcut without the platform modifier, e.g. 'Shift+S' for Ctrl/Cmd+Shift+S. */
  readonly shortcut?: string;
  /** The shortcut takes no Ctrl/Cmd: 'Delete' is the Delete key alone. */
  readonly plain?: boolean;
  readonly disabled?: boolean;
  /** Makes the item a checkbox (`menuitemcheckbox`), ticked when true. */
  readonly checked?: boolean;
}

interface MenuButtonProps<T extends string> {
  label: string;
  /** Groups of items, drawn with separators between them. */
  sections: readonly (readonly MenuEntry<T>[])[];
  /** Runs synchronously inside the click or key press, so it may open file pickers. */
  onChoose: (command: T) => void;
}

/** A menu button and its drop-down (WAI-ARIA menu button pattern). */
export function MenuButton<T extends string>({ label, sections, onChoose }: MenuButtonProps<T>) {
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

  const choose = (item: MenuEntry<T>) => {
    if (item.disabled) return;
    close();
    onChoose(item.command);
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
        {label}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="menu-list"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
        >
          {sections.map((section, i) => (
            <Fragment key={section[0]?.command}>
              {i > 0 && <div role="separator" className="menu-separator" />}
              {section.map((item) => (
                // Disabled items stay focusable so keyboard users can still find them.
                <button
                  key={item.command}
                  type="button"
                  role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={item.checked}
                  tabIndex={-1}
                  className="menu-item"
                  aria-disabled={item.disabled ? true : undefined}
                  onClick={() => choose(item)}
                  aria-keyshortcuts={
                    item.shortcut ? ariaShortcut(item.shortcut, item.plain === true) : undefined
                  }
                >
                  <span>
                    {item.checked !== undefined && (
                      <span className="menu-check" aria-hidden="true">
                        {item.checked ? '✓' : ''}
                      </span>
                    )}
                    {item.label}
                  </span>
                  {item.shortcut && (
                    <kbd className="menu-shortcut">
                      {formatShortcut(item.shortcut, { plain: item.plain === true })}
                    </kbd>
                  )}
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
  return [
    ...(menu?.querySelectorAll<HTMLElement>('[role=menuitem], [role=menuitemcheckbox]') ?? []),
  ];
}

/**
 * "Shift+S" → "Control+Shift+S Meta+Shift+S" for aria-keyshortcuts; a plain shortcut is
 * just its keys.
 */
function ariaShortcut(keys: string, plain: boolean): string {
  return plain ? keys : `Control+${keys} Meta+${keys}`;
}
