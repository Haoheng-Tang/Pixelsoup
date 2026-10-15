import { describe, expect, it } from 'vitest';
import { createDocument, Editor } from '../../core';
import { Colors } from '../color/colors';
import { createToolManager } from '../tools/create-tools';
import type { ToolGroup, ToolManager } from '../tools/tool-manager';
import { toolButtonView, toolFlyoutSections, toolGroupLabel } from './tool-groups';

function setup() {
  const tools = createToolManager(new Editor(createDocument(40, 30)), new Colors());
  const group = (key: string): ToolGroup => {
    const found = tools.groups.find((g) => g.key === key);
    if (!found) throw new Error(`no group for ${key}`);
    return found;
  };
  return { tools, group };
}

/** What each button shows, in toolbar order: the tool's ID, starred when pressed. */
function buttons(tools: ToolManager): string[] {
  return tools.groups.map((group) => {
    const view = toolButtonView(tools, group);
    return `${view.tool.id}${view.pressed ? '*' : ''}`;
  });
}

function flyout(tools: ToolManager, group: ToolGroup) {
  return toolFlyoutSections(tools, group, (tool) => `icon:${tool.id}`);
}

describe('toolbar tool groups', () => {
  it('shows one button per shortcut key, grouping the marquees and the lassos', () => {
    const { tools } = setup();
    expect(tools.groups.map((g) => [g.key, g.tools.map((tool) => tool.id)])).toEqual([
      ['M', ['rect-marquee', 'ellipse-marquee']],
      ['L', ['lasso', 'polygon-lasso']],
      ['W', ['magic-wand']],
      ['V', ['move']],
      ['B', ['brush']],
      ['E', ['eraser']],
      ['G', ['paint-bucket']],
      ['I', ['eyedropper']],
      ['C', ['crop']],
    ]);
    expect(buttons(tools)).toEqual([
      'rect-marquee*',
      'lasso',
      'magic-wand',
      'move',
      'brush',
      'eraser',
      'paint-bucket',
      'eyedropper',
      'crop',
    ]);
    expect(tools.groups.map((g) => toolButtonView(tools, g).grouped)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("shows the group's last-used tool after its key, Shift+key and other tools", () => {
    const { tools, group } = setup();
    const marquee = group('M');
    const lasso = group('L');
    expect(toolButtonView(tools, marquee).title).toBe('Rectangular Marquee (M)');

    tools.handleShortcut('m', true);
    expect(buttons(tools).slice(0, 2)).toEqual(['ellipse-marquee*', 'lasso']);
    expect(toolButtonView(tools, marquee).title).toBe('Elliptical Marquee (M)');

    // L picks the group's last-used tool; only then does Shift+L cycle.
    tools.handleShortcut('l', true);
    expect(buttons(tools).slice(0, 2)).toEqual(['ellipse-marquee', 'lasso*']);
    tools.handleShortcut('l', true);
    expect(buttons(tools).slice(0, 2)).toEqual(['ellipse-marquee', 'polygon-lasso*']);
    expect(toolButtonView(tools, lasso).title).toBe('Polygonal Lasso (L)');

    tools.handleShortcut('v', false);
    expect(buttons(tools).slice(0, 4)).toEqual([
      'ellipse-marquee',
      'polygon-lasso',
      'magic-wand',
      'move*',
    ]);
    tools.handleShortcut('m', false);
    expect(tools.activeTool.id).toBe('ellipse-marquee');
    tools.handleShortcut('m', true);
    expect(buttons(tools)[0]).toBe('rect-marquee*');
  });

  it('lists the group in its flyout, with icons and keys, ticking the last used', () => {
    const { tools, group } = setup();
    tools.handleShortcut('v', false);
    const sections = flyout(tools, group('L'));
    expect(sections).toHaveLength(1);
    expect(
      sections[0]?.map(({ command, label, icon, shortcut, plain, checked, radio }) => ({
        command,
        label,
        icon,
        shortcut,
        plain,
        checked,
        radio,
      })),
    ).toEqual([
      {
        command: 'lasso',
        label: 'Lasso',
        icon: 'icon:lasso',
        shortcut: 'L',
        plain: true,
        checked: true,
        radio: true,
      },
      {
        command: 'polygon-lasso',
        label: 'Polygonal Lasso',
        icon: 'icon:polygon-lasso',
        shortcut: 'L',
        plain: true,
        checked: false,
        radio: true,
      },
    ]);
    expect(toolGroupLabel('L')).toBe('Lasso tools');
    expect(toolGroupLabel('M')).toBe('Marquee tools');
  });

  it("activates the tool chosen from the flyout and makes it the group's last used", () => {
    const { tools, group } = setup();
    const lasso = group('L');
    flyout(tools, lasso)[0]?.[1]?.run();
    expect(tools.activeTool.id).toBe('polygon-lasso');
    expect(buttons(tools).slice(0, 2)).toEqual(['rect-marquee', 'polygon-lasso*']);
    expect(flyout(tools, lasso)[0]?.map((item) => item.checked)).toEqual([false, true]);

    // The key now selects it, and Shift+key cycles on from it.
    tools.handleShortcut('b', false);
    tools.handleShortcut('l', false);
    expect(tools.activeTool.id).toBe('polygon-lasso');
    tools.handleShortcut('l', true);
    expect(tools.activeTool.id).toBe('lasso');

    // Choosing the tool the button already shows activates it too.
    tools.handleShortcut('b', false);
    flyout(tools, lasso)[0]?.[0]?.run();
    expect(buttons(tools).slice(0, 2)).toEqual(['rect-marquee', 'lasso*']);
  });
});
