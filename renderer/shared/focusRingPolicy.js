(function focusRingPolicy(root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.PomodoroFocusRingPolicy = policy;
}(typeof window === 'undefined' ? globalThis : window, () => {
  const contractId = 'focus-ring-final-seventh/v3';
  const finalColor = '#242424';
  function isFinalFocusWindow(state, totalMs) {
    const remainingSec = Math.ceil(Number(state?.remainingMs) / 1000);
    const totalSec = Math.round(Number(totalMs) / 1000);
    return state?.mode === 'focus' && Number.isFinite(totalSec) && totalSec > 0 &&
      Number.isFinite(remainingSec) && remainingSec > 0 && remainingSec * 7 <= totalSec;
  }
  function normalFocusColor(settings = {}, darkSystem = false, themeFocus) {
    const custom = settings.widgetColors?.focus;
    if (typeof custom === 'string' && /^#[0-9a-f]{6}$/i.test(custom)) return custom;
    if (settings.widgetSkin && !['system', 'vintage'].includes(settings.widgetSkin) && themeFocus) return themeFocus;
    const dark = settings.themeMode === 'dark' || (settings.themeMode !== 'light' && darkSystem);
    return dark ? '#869E82' : '#4F6350';
  }
  return Object.freeze({ contractId, finalColor, isFinalFocusWindow, normalFocusColor });
}));
