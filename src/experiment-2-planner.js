import {
  TYPE_DAILY,
  normalizeExperiment2Layout,
  normalizeGridSpan,
} from "./works/taxonomy.js";

/**
 * Plans the currently visible feed from scratch, so filtering never leaves
 * holes from hidden cards. Manual 1/3 wins. Daily uses its own alternating
 * sequence and never increments the non-daily 6 → 5 → 7 counter.
 */
export function planExperiment2(items, settings) {
  const layout = normalizeExperiment2Layout(settings);
  let dailyIndex = 0;
  let intervalIndex = 0;
  let normalSinceLarge = 0;

  return (items || []).map((item) => {
    const override = normalizeGridSpan(item?.gridSpan);
    let automaticSpan;
    if (item?.type === TYPE_DAILY) {
      automaticSpan = layout.dailySpans[dailyIndex % layout.dailySpans.length];
      dailyIndex += 1;
    } else {
      normalSinceLarge += 1;
      const threshold =
        layout.largeIntervals[intervalIndex % layout.largeIntervals.length];
      if (normalSinceLarge > threshold) {
        automaticSpan = layout.largeSpan;
        normalSinceLarge = 0;
        intervalIndex += 1;
      } else {
        automaticSpan = 1;
      }
    }
    // Overrides only affect presentation. The item's automatic classification
    // above still advances its relevant cadence.
    const span = override === "auto" ? automaticSpan : override;
    return { item, span: Math.min(layout.columns, Math.max(1, span)) };
  });
}
