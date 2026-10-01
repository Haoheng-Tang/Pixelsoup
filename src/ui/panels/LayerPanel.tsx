import { useRef } from 'react';
import type { Editor, Layer } from '../../core';
import { SetLayerOpacityCommand, SetLayerVisibilityCommand } from '../../core';
import { useEditorRevision } from '../use-editor-revision';

export function LayerPanel({ editor }: { editor: Editor }) {
  useEditorRevision(editor);
  // Top of the stack first, like most editors.
  const layers = [...editor.document.layers].reverse();

  return (
    <section className="panel" aria-labelledby="layers-heading">
      <h2 id="layers-heading" className="panel-title">
        Layers
      </h2>
      <ul className="layer-list">
        {layers.map((layer) => (
          <LayerRow key={layer.id} editor={editor} layer={layer} />
        ))}
      </ul>
    </section>
  );
}

function LayerRow({ editor, layer }: { editor: Editor; layer: Layer }) {
  // Each pointer/keyboard gesture on the slider gets its own merge key, so one drag
  // becomes one undo step while separate adjustments stay separate.
  const gesture = useRef(0);
  const percent = Math.round(layer.opacity * 100);
  const sliderId = `opacity-${layer.id}`;

  const toggleVisibility = () => {
    editor.history.execute(new SetLayerVisibilityCommand(layer.id, !layer.visible));
  };

  const changeOpacity = (value: number) => {
    const opacity = value / 100;
    if (opacity === layer.opacity) return;
    const mergeKey = `opacity:${layer.id}:${gesture.current}`;
    editor.history.execute(new SetLayerOpacityCommand(layer.id, opacity, mergeKey));
  };

  return (
    <li className={layer.visible ? 'layer' : 'layer is-hidden'}>
      <button
        type="button"
        className="visibility-toggle"
        aria-pressed={layer.visible}
        aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
        title={layer.visible ? 'Hide layer' : 'Show layer'}
        onClick={toggleVisibility}
      >
        <EyeIcon open={layer.visible} />
      </button>
      <div className="layer-body">
        <span className="layer-name">{layer.name}</span>
        <div className="layer-opacity">
          <label htmlFor={sliderId}>Opacity</label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={percent}
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
