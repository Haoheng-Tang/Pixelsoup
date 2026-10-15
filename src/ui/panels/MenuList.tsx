import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatShortcut } from '../use-file-shortcuts';
import type { MenuEntry, MenuSections } from './menu-logic';
import { menuKeyAction, placeSubmenu } from './menu-logic';

interface MenuListProps<T extends string> {
  label: string;
  sections: MenuSections<T>;
  /** An enabled item was chosen, by a click, Enter or Space; in a submenu too. */
  onChoose: (item: MenuEntry<T>) => void;
  /** Escape. */
  onClose: () => void;
  /** Tab moves the focus out of the menu. */
  onLeave: () => void;
  /** The left arrow: a submenu goes back to its item. */
  onBack?: () => void;
  /** Which item takes the focus when the menu appears: none for a submenu the pointer opened. */
  focusOnOpen?: 'first' | 'last' | 'none';
  id?: string;
  className?: string;
  style?: CSSProperties;
  /** The menu element, for whoever places it or watches for clicks outside it. */
  menuRef?: RefObject<HTMLDivElement | null>;
}

/** The open submenu's item, and whether the submenu took the focus (opened by a key). */
interface OpenSubmenu<T extends string> {
  readonly command: T;
  readonly focus: 'first' | 'none';
}

/**
 * A menu's items (WAI-ARIA menu): the menu bar's drop-downs and the canvas's context
 * menu draw theirs alike, with shortcut badges, separators between sections and arrow-key
 * navigation. The keys it handles are marked as used (`preventDefault`), so the canvas's
 * tool and the app's shortcuts leave them alone: Enter chooses an item rather than
 * closing a lasso, Escape closes the menu rather than deselecting.
 *
 * An item with a `submenu` opens it beside itself when the pointer rests on it, or on a
 * click, Enter, Space or the right arrow, which also move the focus into it; Escape or the
 * left arrow there closes it again.
 */
export function MenuList<T extends string>({
  label,
  sections,
  onChoose,
  onClose,
  onLeave,
  onBack,
  focusOnOpen = 'first',
  id,
  className = 'menu-list',
  style,
  menuRef,
}: MenuListProps<T>) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = menuRef ?? ownRef;
  const items = sections.flat();
  const [submenu, setSubmenu] = useState<OpenSubmenu<T> | null>(null);
  const triggers = useRef(new Map<T, HTMLElement>());

  useEffect(() => {
    if (focusOnOpen === 'none') return;
    const list = menuItems(ref.current);
    (focusOnOpen === 'first' ? list[0] : list[list.length - 1])?.focus();
    // Only when the menu appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (item: MenuEntry<T> | undefined) => {
    if (!item || item.disabled) return;
    if (item.submenu) setSubmenu({ command: item.command, focus: 'first' });
    else onChoose(item);
  };

  /** Closes the submenu from inside it, putting the focus back on its item. */
  const closeSubmenu = () => {
    if (!submenu) return;
    setSubmenu(null);
    triggers.current.get(submenu.command)?.focus();
  };

  // The pointer resting on an item opens its submenu, or closes another item's.
  const hover = (item: MenuEntry<T>, button: HTMLElement) => {
    if (submenu?.command === item.command) return;
    const focused = document.activeElement;
    const focusInSubmenu =
      submenu !== null &&
      focused !== null &&
      focused.closest('[role=menu]') !== ref.current &&
      (ref.current?.contains(focused) ?? false);
    setSubmenu(item.submenu && !item.disabled ? { command: item.command, focus: 'none' } : null);
    // The focus mustn't vanish with the submenu, or the keys would leave the menu.
    if (focusInSubmenu) button.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const action = menuKeyAction(e.key);
    if (!action) return;
    // A submenu's keys are its own.
    if (e.target instanceof Element && e.target.closest('[role=menu]') !== ref.current) return;
    const list = menuItems(ref.current);
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => {
      setSubmenu(null);
      list[(i + list.length) % list.length]?.focus();
    };
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
      case 'open': {
        const item = items[index];
        if (item?.submenu && !item.disabled) {
          setSubmenu({ command: item.command, focus: 'first' });
        }
        break;
      }
      case 'back':
        onBack?.();
        break;
      case 'close':
        onClose();
        break;
      case 'leave':
        onLeave();
        return;
    }
    e.preventDefault();
  };

  const renderItem = (item: MenuEntry<T>) => {
    const open = submenu?.command === item.command;
    return (
      // Disabled items stay focusable so keyboard users can still find them.
      <button
        type="button"
        role={menuItemRole(item)}
        aria-checked={item.checked}
        tabIndex={-1}
        className="menu-item"
        aria-disabled={item.disabled ? true : undefined}
        aria-haspopup={item.submenu ? 'menu' : undefined}
        aria-expanded={item.submenu ? open : undefined}
        ref={
          item.submenu
            ? (button) => {
                if (button) triggers.current.set(item.command, button);
                else triggers.current.delete(item.command);
              }
            : undefined
        }
        onPointerEnter={(e) => hover(item, e.currentTarget)}
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
          {item.icon !== undefined && (
            <span className="menu-icon" aria-hidden="true">
              {item.icon}
            </span>
          )}
          {item.label}
        </span>
        {item.submenu ? (
          <span className="menu-submark" aria-hidden="true">
            ▸
          </span>
        ) : (
          item.shortcut && (
            <kbd className="menu-shortcut">
              {formatShortcut(item.shortcut, { plain: item.plain === true })}
            </kbd>
          )
        )}
      </button>
    );
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
          {section.map((item) =>
            item.submenu ? (
              <div key={item.command} role="none" className="menu-sub">
                {renderItem(item)}
                {submenu?.command === item.command && (
                  <Submenu
                    // A key press after the pointer opened it moves the focus in.
                    key={submenu.focus}
                    label={item.label}
                    sections={item.submenu}
                    focusOnOpen={submenu.focus}
                    onChoose={onChoose}
                    onClose={closeSubmenu}
                    onLeave={onLeave}
                  />
                )}
              </div>
            ) : (
              <Fragment key={item.command}>{renderItem(item)}</Fragment>
            ),
          )}
        </Fragment>
      ))}
    </div>
  );
}

interface SubmenuProps<T extends string> {
  label: string;
  sections: MenuSections<T>;
  focusOnOpen: 'first' | 'none';
  onChoose: (item: MenuEntry<T>) => void;
  onClose: () => void;
  onLeave: () => void;
}

/** A submenu beside its item, on whichever side it fits (see `placeSubmenu`). */
function Submenu<T extends string>({
  label,
  sections,
  focusOnOpen,
  onChoose,
  onClose,
  onLeave,
}: SubmenuProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current;
    const item = menu?.parentElement;
    if (!menu || !item) return;
    const { side, top } = placeSubmenu(
      item.getBoundingClientRect(),
      menu.offsetWidth,
      menu.offsetHeight,
      window.innerWidth,
      window.innerHeight,
    );
    menu.style.top = `${top}px`;
    menu.style.left = side === 'right' ? '100%' : 'auto';
    menu.style.right = side === 'right' ? 'auto' : '100%';
  });
  return (
    <MenuList
      menuRef={ref}
      className="menu-list submenu"
      label={label}
      sections={sections}
      focusOnOpen={focusOnOpen}
      onChoose={onChoose}
      onClose={onClose}
      onBack={onClose}
      onLeave={onLeave}
    />
  );
}

/** The menu's own items in order, not its submenus'. */
function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return [
    ...(menu?.querySelectorAll<HTMLElement>(
      '[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio]',
    ) ?? []),
  ].filter((item) => item.closest('[role=menu]') === menu);
}

function menuItemRole(item: MenuEntry<string>): string {
  if (item.checked === undefined) return 'menuitem';
  return item.radio ? 'menuitemradio' : 'menuitemcheckbox';
}

/**
 * "Shift+S" → "Control+Shift+S Meta+Shift+S" for aria-keyshortcuts; a plain shortcut is
 * just its keys.
 */
function ariaShortcut(keys: string, plain: boolean): string {
  return plain ? keys : `Control+${keys} Meta+${keys}`;
}
