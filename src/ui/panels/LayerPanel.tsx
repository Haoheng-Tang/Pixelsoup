import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor, ImageDocument, Layer, LayerId } from '../../core';
import {
  SetLayerOpacityCommand,
  SetLayerVisibilityCommand,
  findLayer,
  findLayerIndex,
  renameLayerCommand,
  reorderLayerCommand,
} from '../../core';
import type { LayerAction } from '../layer-actions';
import { canRunLayerAction, runLayerAction } from '../layer-actions';
import { useEditorRevision } from '../use-editor-revision';
import { formatShortcut } from '../use-file-shortcuts';
import { DRAG_THRESHOLD, dropSlot, isNoOpDrop, stackIndexForDrop } from './layer-drag';
import { LayerThumbnails } from './layer-thumbnails';

interface LayerPanelProps {
  editor: Editor;
  /** True while a dialog is open or a file operation is running. */
  blocked: boolean;
}

/** The layer being dragged, and the gap between rows it would drop into (null: no move). */
interface RowDrag {
  readonly layerId: LayerId;
  readonly slot: number | null;
}

/** Marks controls inside a row that handle their own pointer input: no activating, no drag. */
const ROW_CONTROL = '[data-row-control]';

export function LayerPanel({ editor, blocked }: LayerPanelProps) {
  useEditorRevision(editor);
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);
  const thumbnails = useMemo(() => new LayerThumbnails(editor), [editor]);
  useEffect(() => thumbnails.start(), [thumbnails]);

  // Top of the stack first, like most editors.
  const layers = [...editor.document.layers].reverse();
  const floatingId = editor.floating?.layerId ?? null;

  // A press activates the row's layer; moving the pointer far enough then drags the row.
  // Window listeners follow the pointer; the row captures it only once a drag starts, so
  // a plain click or double-click still reaches the element under the pointer.
  const onRowPointerDown = (e: ReactPointerEvent<HTMLLIElement>, layerId: LayerId) => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest(ROW_CONTROL))) return;
    activate(editor, layerId);
    endDrag.current?.();
    // A floating selection stays directly above the layer it came from.
    if (layerId === editor.floating?.layerId) return;

    const row = e.currentTarget;
    const { pointerId } = e;
    const start = { x: e.clientX, y: e.clientY };
    const doc = editor.document;
    let dragging = false;
    let slot: number | null | undefined;

    function onMove(ev: PointerEvent): void {
      if (ev.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
        dragging = true;
        capturePointer(row, pointerId);
      }
      const rows = rowElements(listRef.current);
      const fromRow = rows.findIndex((el) => el.dataset['layerId'] === layerId);
      const gap = dropSlot(rows.map(midpointY), ev.clientY);
      const next = fromRow < 0 || isNoOpDrop(fromRow, gap) ? null : gap;
      if (next === slot) return;
      slot = next;
      setDrag({ layerId, slot });
    }

    function onUp(ev: PointerEvent): void {
      if (ev.pointerId !== pointerId) return;
      const gap = slot;
      stop();
      if (gap == null || editor.document !== doc) return;
      const index = findLayerIndex(doc, layerId);
      const count = doc.layers.length;
      if (index < 0 || gap > count) return;
      const command = reorderLayerCommand(
        doc,
        layerId,
        stackIndexForDrop(count, count - 1 - index, gap),
      );
      if (command) editor.history.execute(command);
    }

    function onKeyDown(ev: KeyboardEvent): void {
      if (ev.key !== 'Escape' || !dragging) return;
      ev.preventDefault();
      ev.stopPropagation();
      stop();
    }

    function stop(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      window.removeEventListener('keydown', onKeyDown, true);
      if (endDrag.current === stop) endDrag.current = null;
      setDrag(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    window.addEventListener('keydown', onKeyDown, true);
    endDrag.current = stop;
  };

  return (
    <section className="panel layers-panel" aria-labelledby="layers-heading">
      <h2 id="layers-heading" className="panel-title">
        Layers
      </h2>
      <ul
        // Layer IDs repeat across documents; a new document must not inherit row state.
        key={documentKey(editor.document)}
        ref={listRef}
        className={drag ? 'layer-list is-reordering' : 'layer-list'}
      >
        {layers.map((layer, row) => (
          <LayerRow
            key={layer.id}
            editor={editor}
            thumbnails={thumbnails}
            layer={layer}
            active={layer.id === editor.activeLayerId}
            floating={layer.id === floatingId}
            dragging={drag?.layerId === layer.id}
            dropEdge={dropEdgeAt(drag, row, layers.length)}
            onPointerDown={(e) => onRowPointerDown(e, layer.id)}
          />
        ))}
      </ul>
      <LayerActions editor={editor} blocked={blocked} />
    </section>
  );
}

interface LayerRowProps {
  editor: Editor;
  thumbnails: LayerThumbnails;
  layer: Layer;
  active: boolean;
  /**
   * The layer holds a floating selection: it can't be renamed, reordered, hidden or faded
   * until it's committed.
   */
  floating: boolean;
  dragging: boolean;
  /** Where to show the drop indicator: above this row, below it (last row only), or not. */
  dropEdge: 'before' | 'after' | null;
  onPointerDown: (e: ReactPointerEvent<HTMLLIElement>) => void;
}

function LayerRow({
  editor,
  thumbnails,
  layer,
  active,
  floating,
  dragging,
  dropEdge,
  onPointerDown,
}: LayerRowProps) {
  // Each pointer/keyboard gesture on the slider gets its own merge key, so one drag
  // becomes one undo step while separate adjustments stay separate.
  const gesture = useRef(0);
  const nameButton = useRef<HTMLButtonElement>(null);
  const refocusName = useRef(false);
  const [renaming, setRenaming] = useState(false);
  const percent = Math.round(layer.opacity * 100);
  const sliderId = `opacity-${layer.id}`;
  // The renderer draws into the canvas itself, so re-renders never repaint it.
  const thumbnailRef = useCallback(
    (canvas: HTMLCanvasElement | null) =>
      canvas ? thumbnails.attach(layer.id, canvas) : undefined,
    [thumbnails, layer.id],
  );

  useEffect(() => {
    if (renaming || !refocusName.current) return;
    refocusName.current = false;
    nameButton.current?.focus();
  }, [renaming]);

  const endRename = (refocus: boolean) => {
    refocusName.current = refocus;
    setRenaming(false);
  };

  const onNameKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'F2' || floating) return;
    e.preventDefault();
    setRenaming(true);
  };

  const toggleVisibility = () => {
    editor.history.execute(new SetLayerVisibilityCommand(layer.id, !layer.visible));
  };

  const changeOpacity = (value: number) => {
    const opacity = value / 100;
    if (opacity === layer.opacity) return;
    const mergeKey = `opacity:${layer.id}:${gesture.current}`;
    editor.history.execute(new SetLayerOpacityCommand(layer.id, opacity, mergeKey));
  };

  const className = [
    'layer',
    active && 'is-active',
    floating && 'is-floating',
    !layer.visible && 'is-hidden',
    dragging && 'is-dragging',
    dropEdge && `drop-${dropEdge}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={className}
      data-layer-id={layer.id}
      aria-current={active || undefined}
      onPointerDown={onPointerDown}
    >
      <button
        type="button"
        className="visibility-toggle"
        data-row-control
        aria-pressed={layer.visible}
        aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
        title={layer.visible ? 'Hide layer' : 'Show layer'}
        disabled={floating}
        onClick={toggleVisibility}
      >
        <EyeIcon open={layer.visible} />
      </button>
      <div className="layer-thumbnail" aria-hidden="true">
        <canvas ref={thumbnailRef} />
      </div>
      <div className="layer-body">
        {renaming ? (
          <RenameField editor={editor} layer={layer} onDone={endRename} />
        ) : (
          <button
            ref={nameButton}
            type="button"
            className="layer-name"
            title={
              floating
                ? `${layer.name}: commit it with ${formatShortcut('Enter')}`
                : `${layer.name} (double-click or F2 to rename)`
            }
            onClick={() => activate(editor, layer.id)}
            onDoubleClick={() => setRenaming(!floating)}
            onKeyDown={onNameKeyDown}
          >
            {layer.name}
          </button>
        )}
        <div className="layer-opacity" data-row-control>
          <label htmlFor={sliderId}>Opacity</label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={percent}
            disabled={floating}
            onPointerDown={() => gesture.current++}
            onKeyDown={() => gesture.current++}
            onChange={(e) => changeOpacity(Number(e.currentTarget.value))}
          />
          <output htmlFor={sliderId}>{percent}%</output>
        </div>
      </div>
    </li>
  );
}

interface RenameFieldProps {
  editor: Editor;
  layer: Layer;
  /** Called once when editing ends; `refocus` asks for focus back on the layer name. */
  onDone: (refocus: boolean) => void;
}

/**
 * Inline name editor: Enter commits, Escape cancels, an empty name is refused. Leaving the
 * field keeps a valid name and drops an empty one.
 */
function RenameField({ editor, layer, onDone }: RenameFieldProps) {
  const [value, setValue] = useState(layer.name);
  const [invalid, setInvalid] = useState(false);
  const done = useRef(false);

  const finish = (commit: boolean, refocus: boolean) => {
    if (done.current) return;
    const name = value.trim();
    if (commit && name === '') {
      setInvalid(true);
      return;
    }
    done.current = true;
    const command = commit ? renameLayerCommand(editor.document, layer.id, name) : null;
    if (command) editor.history.execute(command);
    onDone(refocus);
  };

  return (
    <input
      className="layer-name-input"
      data-row-control
      aria-label={`Name of layer ${layer.name}`}
      aria-invalid={invalid || undefined}
      title={invalid ? 'A layer needs a name' : undefined}
      value={value}
      maxLength={256}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setValue(e.currentTarget.value);
        setInvalid(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false, true);
        }
      }}
      onBlur={() => finish(value.trim() !== '', false)}
    />
  );
}

interface PanelAction {
  action: LayerAction;
  label: string;
  /** Shortcut without the platform modifier, as in the menus. */
  shortcut?: string;
  icon: ReactNode;
}

const PANEL_ACTIONS: readonly PanelAction[] = [
  {
    action: 'new',
    label: 'New layer',
    shortcut: 'Shift+N',
    icon: (
      <ActionIcon d="M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM8 5.5v5M5.5 8h5" />
    ),
  },
  {
    action: 'duplicate',
    label: 'Duplicate layer',
    shortcut: 'J',
    icon: (
      <ActionIcon d="M2.5 10.5v-8h8M6.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" />
    ),
  },
  {
    action: 'delete',
    label: 'Delete layer',
    icon: <ActionIcon d="M2.5 4.5h11M6 4.5v-2h4v2M4 4.5l.8 9h6.4l.8-9M6.75 7v4M9.25 7v4" />,
  },
  {
    action: 'merge-down',
    label: 'Merge down',
    shortcut: 'E',
    icon: <ActionIcon d="M8 2.5v7M5 6.5l3 3 3-3M2.5 13.5h11" />,
  },
];

function LayerActions({ editor, blocked }: LayerPanelProps) {
  return (
    <div className="layer-actions" role="group" aria-label="Layer actions">
      {PANEL_ACTIONS.map(({ action, label, shortcut, icon }) => (
        <button
          key={action}
          type="button"
          aria-label={label}
          title={shortcut === undefined ? label : `${label} (${formatShortcut(shortcut)})`}
          disabled={blocked || !canRunLayerAction(editor, action)}
          onClick={() => runLayerAction(editor, action)}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

function activate(editor: Editor, layerId: LayerId): void {
  if (findLayer(editor.document, layerId)) editor.setActiveLayer(layerId);
}

const documentKeys = new WeakMap<ImageDocument, number>();
let lastDocumentKey = 0;

function documentKey(doc: ImageDocument): number {
  let key = documentKeys.get(doc);
  if (key === undefined) {
    key = ++lastDocumentKey;
    documentKeys.set(doc, key);
  }
  return key;
}

function dropEdgeAt(drag: RowDrag | null, row: number, rows: number): 'before' | 'after' | null {
  if (drag?.slot == null) return null;
  if (drag.slot === row) return 'before';
  return drag.slot === rows && row === rows - 1 ? 'after' : null;
}

function rowElements(list: HTMLUListElement | null): HTMLElement[] {
  return list ? [...list.querySelectorAll<HTMLElement>(':scope > [data-layer-id]')] : [];
}

function midpointY(element: Element): number {
  const rect = element.getBoundingClientRect();
  return rect.top + rect.height / 2;
}

function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // The pointer is already gone; the window listeners still see the release.
  }
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        opacity={open ? 1 : 0.35}
      />
      {open ? (
        <circle cx="8" cy="8" r="2.2" fill="currentColor" />
      ) : (
        <path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.3" />
      )}
    </svg>
  );
}

function ActionIcon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
