import { useSyncExternalStore } from 'react';
import { NumberSlider } from './NumberSlider';
import type { RegionOptions, RegionSettings } from './region-options';

type Toggle = 'antiAlias' | 'contiguous' | 'sampleAll';

const TOGGLES: readonly { setting: Toggle; label: string; hint: string }[] = [
  { setting: 'antiAlias', label: 'Anti-alias', hint: "Soften the region's edge by a pixel" },
  {
    setting: 'contiguous',
    label: 'Contiguous',
    hint: 'Only colours connected to the pixel clicked; off, every matching pixel',
  },
  {
    setting: 'sampleAll',
    label: 'Sample all layers',
    hint: 'Compare what you see, all visible layers, rather than the active layer',
  },
];

/**
 * Options bar for the Magic Wand and the Paint Bucket: how they pick the region around
 * the pixel clicked, and with `opacity` the Paint Bucket's opacity.
 */
export function RegionOptionsPanel({
  options,
  opacity = false,
}: {
  options: RegionOptions;
  opacity?: boolean;
}) {
  const settings: RegionSettings = useSyncExternalStore(options.subscribe, () => options.settings);
  return (
    <>
      {opacity && (
        <NumberSlider
          label="Opacity"
          unit="%"
          value={settings.opacity}
          min={1}
          max={100}
          onChange={(value) => options.set({ opacity: value })}
        />
      )}
      <NumberSlider
        label="Tolerance"
        unit=""
        value={settings.tolerance}
        min={0}
        max={255}
        hint="How far each channel may be from the pixel clicked, 0–255"
        onChange={(tolerance) => options.set({ tolerance })}
      />
      <div className="options-field">
        {TOGGLES.map(({ setting, label, hint }) => (
          <button
            key={setting}
            type="button"
            className="options-toggle"
            aria-pressed={settings[setting]}
            title={hint}
            onClick={() => options.set({ [setting]: !settings[setting] })}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
