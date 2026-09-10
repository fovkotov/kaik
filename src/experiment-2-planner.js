import { normalizeExperiment2Layout, normalizeGridSpan, normalizeWorkType } from "./works/taxonomy.js";

/**
 * Plans the currently visible feed from scratch, so filtering never leaves
 * holes from hidden cards. Each visual type advances its own cadence:
 * N normal cards, then one large card. Manual sizing changes presentation
 * only, so that item still advances the relevant type counter.
 */
export function planExperiment2(items, settings) {
  const layout = normalizeExperiment2Layout(settings);
  const counters = new Map();

  return (items || []).map((item) => {
    const override = normalizeGridSpan(item?.gridSpan);
    const type = normalizeWorkType(item?.type);
    const pattern = layout.typePatterns[type] ?? { interval: 1, span: 1 };
    const position = counters.get(type) ?? 0;
    const automaticSpan = position === pattern.interval ? pattern.span : 1;
    counters.set(type, position === pattern.interval ? 0 : position + 1);
    const span = override === "auto" ? automaticSpan : override;
    return { item, span: Math.min(layout.columns, Math.max(1, span)) };
  });
}
