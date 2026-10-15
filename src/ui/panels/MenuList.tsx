import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { Fragment, useEffect, useRef } from 'react';
import { formatShortcut } from '../use-file-shortcuts';
import type { MenuEntry, MenuSections } from './menu-logic';
import { menuKeyAction } from './menu-logic';

interface MenuListProps<T extends string> {
  label: string;
  sections: MenuSections<T>;
  /** An enabled item was chosen, by a click, Enter or Space. */
  onChoose: (item: MenuEntry<T>) => void;
  /** Escape. */
  onClose: () => void;
  /** Tab moves the focus out of the menu. */
  onLeave: () => void;
  /** Which item takes the focus when the menu appears. */
  focusOnOpen?: 'first' | 'last';
  id?: string;
  className?: string;
  style?: CSSProperties;
  /** The menu element, for whoever places it or watches for clicks outside it. */
  menuRef?: RefObject<HTMLDivElement | null>;
}

/**
 * A menu's items (WAI-ARIA menu): the menu bar's drop-downs and the canvas's context
 * menu draw theirs alike, with shortcut badges, separators between sections and arrow-key
 * navigation. The keys it handles are marked as used (`preventDefault`), so the canvas's
 * tool and the app's shortcuts leave them alone: Enter chooses an item rather than
 * closing a lasso, Escape closes the menu rather than deselecting.
 */
export function MenuList<T extends string>({
  label,
  sections,
  onChoose,
  onClose,
  onLeave,
  focusOnOpen = 'first',
  id,
  className = 'menu-list',
  style,
  menuRef,
}: MenuListProps<T>) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = menuRef ?? ownRef;
  const items = sections.flat();

  useEffect(() => {
    const list = menuItems(ref.current);
    (focusOnOpen === 'first' ? list[0] : list[list.length - 1])?.focus();
    // Only when the menu appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (item: MenuEntry<T> | undefined) => {
    if (item && !item.disabled) onChoose(item);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const action = menuKeyAction(e.key);
    if (!action) return;
    const list = menuItems(ref.current);
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (action) {
      case 'next':
        focusAt(index + 1);
        break;
      case 'previous':
        focusAt(index < 0 ? -1 : index - 1);
        break;
      case 'first':
        focusAt(0);
        break;
      case 'last':
        focusAt(-1);
        break;
      case 'choose':
        // Handled here rather than by the button's own click, so the key is marked used.
        e.preventDefault();
        choose(items[index]);
        return;
      case 'close':
        onClose();
        break;
      case 'leave':
        onLeave();
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      id={id}
      className={className}
      style={style}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
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
