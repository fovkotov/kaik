import { normalizeExperiment2Layout, normalizeGridSpan, normalizeWorkType } from "./works/taxonomy.js";

/**
 * Plans the currently visible feed from scratch, so filtering never leaves
 * holes from hidden cards. Each visual type advances its own cadence:
 * N base-span cards, then one large card. Fonts only use their base span.
 * Manual sizing changes presentation
 * only, so that item still advances the relevant type counter.
 * `columns` is the live track count (desktop `columns` or `mobileColumns`);
 * every span clamps to it so a 10-wide font card becomes 4-wide on a phone.
 */
export function planExperiment2(items, settings, columns) {
  const layout = normalizeExperiment2Layout(settings);
  const tracks = Number.isInteger(columns) && columns > 0 ? columns : layout.columns;
  const counters = new Map();

  return (items || []).map((item) => {
    const override = normalizeGridSpan(item?.gridSpan);
    const type = normalizeWorkType(item?.type);
    const pattern = layout.typePatterns[type] ?? { baseSpan: 1, interval: 1, span: 1 };
    const position = counters.get(type) ?? 0;
    const hasCadence = Number.isInteger(pattern.interval) && Number.isInteger(pattern.span);
    const atCadence = hasCadence && position === pattern.interval;
    const automaticSpan = atCadence ? pattern.span : pattern.baseSpan;
    if (hasCadence) counters.set(type, atCadence ? 0 : position + 1);
    const span = override === "auto" ? automaticSpan : override;
    return { item, span: Math.min(tracks, Math.max(1, span)) };
  });
}
