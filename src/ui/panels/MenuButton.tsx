import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import type { MenuEntry, MenuSections } from './menu-logic';
import { MenuList } from './MenuList';

export type { MenuEntry } from './menu-logic';

interface MenuButtonProps<T extends string> {
  label: string;
  /** Groups of items, drawn with separators between them. */
  sections: MenuSections<T>;
  /** Runs synchronously inside the click or key press, so it may open file pickers. */
  onChoose: (command: T) => void;
}

/** A menu button and its drop-down (WAI-ARIA menu button pattern). */
export function MenuButton<T extends string>({ label, sections, onChoose }: MenuButtonProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  // Which item to focus when the menu opens: first or last.
  const [focusOnOpen, setFocusOnOpen] = useState<'first' | 'last'>('first');

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openMenu = (focus: 'first' | 'last') => {
    setFocusOnOpen(focus);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (item: MenuEntry<T>) => {
    close();
    onChoose(item.command);
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu(e.key === 'ArrowDown' ? 'first' : 'last');
    }
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
        <MenuList
          id={menuId}
          label={label}
          sections={sections}
          focusOnOpen={focusOnOpen}
          onChoose={choose}
          onClose={close}
          onLeave={() => setOpen(false)}
        />
      )}
    </div>
  );
}
