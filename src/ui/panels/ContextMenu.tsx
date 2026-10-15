import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ContextMenuItem, ContextMenuSections, MenuDismissal, MenuEntry } from './menu-logic';
import { clampMenuPosition, closesContextMenu } from './menu-logic';
import { MenuList } from './MenuList';

interface ContextMenuProps {
  /** Where it opened, in client coordinates: the pointer's position. */
  x: number;
  y: number;
  label: string;
  /** Rebuilt on each render, so items enable and disable as things change. */
  sections: ContextMenuSections;
  /**
   * Closes the menu (unmounts it) and returns the focus where it belongs. Called for
   * Escape, Tab, a press or wheel outside it, a scroll, a resize, the window losing focus,
   * and before a chosen item runs.
   */
  onClose: () => void;
  /**
   * Whether a press outside the menu, on `target`, should only close it: it's stopped
   * there, so dismissing the menu over the canvas never starts a tool's gesture.
   */
  swallowsPress?: (target: EventTarget | null) => boolean;
}

/**
 * A context menu at the pointer (WAI-ARIA menu), kept inside the window. Its items carry
 * what they do (`ContextMenuItem.run`); they're drawn like the menu bar's, by `MenuList`.
 */
export function ContextMenu({ x, y, label, sections, onClose, swallowsPress }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const swallowsRef = useRef(swallowsPress);
  useEffect(() => {
    onCloseRef.current = onClose;
    swallowsRef.current = swallowsPress;
  });

  // Placed before it's painted, once its size is known (and again if its items change).
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { left, top } = clampMenuPosition(
      x,
      y,
      menu.offsetWidth,
      menu.offsetHeight,
      window.innerWidth,
      window.innerHeight,
    );
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  });

  useEffect(() => {
    const dismiss = (event: MenuDismissal, target: EventTarget | null): boolean => {
      const inside = target instanceof Node && (menuRef.current?.contains(target) ?? false);
      const closes = closesContextMenu(event, inside);
      if (closes) onCloseRef.current();
      return closes;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (dismiss('pointerdown', e.target) && swallowsRef.current?.(e.target)) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    const onWheel = (e: WheelEvent) => dismiss('wheel', e.target);
    const onScroll = (e: Event) => dismiss('scroll', e.target);
    const onResize = () => dismiss('resize', null);
    const onBlur = () => dismiss('blur', null);
    // A right-click on the menu itself shows no browser menu.
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const menu = menuRef.current;
    menu?.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);
    return () => {
      menu?.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const items = new Map(sections.flat().map((item) => [item.command, item]));
  const choose = (entry: MenuEntry<string>) => {
    const item: ContextMenuItem | undefined = items.get(entry.command);
    onClose();
    item?.run();
  };

  return (
    <MenuList
      menuRef={menuRef}
      className="menu-list context-menu"
      style={{ left: x, top: y }}
      label={label}
      sections={sections}
      onChoose={choose}
      onClose={onClose}
      onLeave={onClose}
    />
  );
}
