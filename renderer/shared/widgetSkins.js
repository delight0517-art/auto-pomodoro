(function initWidgetSkins(root, factory) {
  const skins = factory();
  if (typeof module === 'object' && module.exports) module.exports = skins;
  else root.PomodoroWidgetSkins = skins;
}(typeof window === 'undefined' ? globalThis : window, () => {
  const COLOR_KEYS = [
    'surface', 'surfaceLight', 'surfaceDeep', 'ink', 'muted', 'border', 'track',
    'focus', 'break', 'grace', 'inner', 'button', 'buttonDeep', 'buttonInk',
  ];
  const SYSTEM_LIGHT = {
    surface: '#E6D3A3', surfaceLight: '#FFFAE6', surfaceDeep: '#D9C088',
    ink: '#43300F', muted: '#6B5225', border: '#8A6D3B', track: '#C5B78E',
    focus: '#7A2E1D', break: '#C7392A', grace: '#BD6B1E', inner: '#FFF4D6',
    button: '#8C5A2B', buttonDeep: '#6B3F1D', buttonInk: '#F3E6C8',
  };
  const SYSTEM_DARK = {
    surface: '#282219', surfaceLight: '#332A20', surfaceDeep: '#221D16',
    ink: '#E9E2D0', muted: '#AFA692', border: '#C79A5E', track: '#453D2E',
    focus: '#869E82', break: '#FF7259', grace: '#E6A05E', inner: '#332A20',
    button: '#9C7A45', buttonDeep: '#71552F', buttonInk: '#FAF9F4',
  };
  const PRESETS = {
    vintage: SYSTEM_LIGHT,
    forest: {
      surface: '#DCE8D7', surfaceLight: '#F3F8EF', surfaceDeep: '#B7CBAE',
      ink: '#20382A', muted: '#496754', border: '#527A5C', track: '#A9BEA4',
      focus: '#39734B', break: '#C75046', grace: '#C6872E', inner: '#EAF3E5',
      button: '#39734B', buttonDeep: '#28583A', buttonInk: '#F3F8EF',
    },
    ocean: {
      surface: '#D9EAF0', surfaceLight: '#F2FAFC', surfaceDeep: '#AACBD5',
      ink: '#173642', muted: '#426876', border: '#39778A', track: '#A4C5D0',
      focus: '#16758A', break: '#C75158', grace: '#BA813A', inner: '#E7F4F7',
      button: '#16758A', buttonDeep: '#10596B', buttonInk: '#F2FAFC',
    },
    rose: {
      surface: '#F2DFE4', surfaceLight: '#FFF6F7', surfaceDeep: '#DABAC4',
      ink: '#482A35', muted: '#76525F', border: '#A15E73', track: '#D3B2BD',
      focus: '#A64F6C', break: '#C44742', grace: '#B67D34', inner: '#FBECEF',
      button: '#A64F6C', buttonDeep: '#7C3C51', buttonInk: '#FFF6F7',
    },
    midnight: SYSTEM_DARK,
  };
  const FONTS = {
    editorial: { body: "'EB Garamond', Georgia, 'Nanum Myeongjo', serif", display: "'Playfair Display', Georgia, serif" },
    serif: { body: "Georgia, 'Nanum Myeongjo', serif", display: "Georgia, 'Nanum Myeongjo', serif" },
    sans: { body: "system-ui, -apple-system, 'Segoe UI', sans-serif", display: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
    mono: { body: "ui-monospace, 'SFMono-Regular', Consolas, monospace", display: "ui-monospace, 'SFMono-Regular', Consolas, monospace" },
  };

  function paletteFor(settings = {}, prefersDark = false) {
    if (settings.widgetSkin === 'system' || !settings.widgetSkin) {
      if (settings.widgetStyle === 'compact') {
        return prefersDark ? SYSTEM_DARK : {
          ...SYSTEM_LIGHT,
          surface: '#EEEAE0', surfaceLight: '#FAF9F4', surfaceDeep: '#DCD6C4',
          ink: '#332A20', muted: '#6F6759', border: '#9C7A45', track: '#DCD6C4',
          focus: '#4F6350', button: '#9C7A45', buttonDeep: '#765C34', buttonInk: '#FAF9F4',
        };
      }
      return SYSTEM_LIGHT;
    }
    if (settings.widgetSkin === 'custom') return sanitizeColors(settings.widgetColors, 'vintage');
    return PRESETS[settings.widgetSkin] || SYSTEM_LIGHT;
  }

  function sanitizeColors(colors, fallbackSkin = 'vintage') {
    const fallback = PRESETS[fallbackSkin] || SYSTEM_LIGHT;
    return Object.fromEntries(COLOR_KEYS.map((key) => [
      key,
      typeof colors?.[key] === 'string' && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(colors[key])
        ? colors[key].toUpperCase()
        : fallback[key],
    ]));
  }

  function apply(element, settings = {}) {
    if (!element) return;
    const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
    const colors = paletteFor(settings, prefersDark);
    element.dataset.widgetSkin = settings.widgetSkin || 'system';
    for (const key of COLOR_KEYS) {
      const cssKey = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      element.style.setProperty(`--skin-${cssKey}`, colors[key]);
    }
    const font = FONTS[settings.widgetFont] || FONTS.editorial;
    element.style.setProperty('--skin-body-font', font.body);
    element.style.setProperty('--skin-display-font', font.display);
  }

  return { COLOR_KEYS, PRESETS, FONTS, SYSTEM_LIGHT, SYSTEM_DARK, paletteFor, sanitizeColors, apply };
}));
