// Aggregation of runOnce() results (spec §13.3 metrics).

export function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
export function median(xs) { return percentile(xs, 50); }
export function percentile(xs, p) {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function aggregate(results) {
  const ok = results.filter((r) => !r.error);
  const n = results.length;
  const cleared = ok.filter((r) => r.cleared).length;
  const failAts = ok.filter((r) => !r.cleared && r.failAtSec != null).map((r) => r.failAtSec);
  const frameMax = results.map((r) => r.frameMaxMs || 0);
  const curves = ok.map((r) => r.satisfactionCurve).filter(Boolean);
  let meanCurve = null;
  if (curves.length) {
    const len = Math.max(...curves.map((c) => c.length));
    meanCurve = [];
    for (let i = 0; i < len; i++) {
      const vals = [];
      for (const c of curves) if (i < c.length) vals.push(c[i]);
      meanCurve.push(Math.round(mean(vals) * 10) / 10);
    }
  }
  return {
    n,
    errors: results.filter((r) => r.error).length,
    clearRate: ok.length ? cleared / ok.length : NaN,
    failRate: ok.length ? 1 - cleared / ok.length : NaN,
    medianFailAtSec: failAts.length ? median(failAts) : null,
    meanFailAtSec: failAts.length ? mean(failAts) : null,
    medianPlayCount: ok.length ? median(ok.map((r) => r.playCount)) : NaN,
    meanPlayCount: ok.length ? mean(ok.map((r) => r.playCount)) : NaN,
    meanHiyari: ok.length ? mean(ok.map((r) => r.hiyari)) : NaN,
    meanInterventions: ok.length ? mean(ok.map((r) => r.interventions)) : NaN,
    comboHiyariRate: ok.length ? ok.filter((r) => r.comboHiyari >= 1).length / ok.length : NaN,
    meanSatLowRatio: ok.length ? mean(ok.map((r) => r.satLowRatio)) : NaN,
    frameMaxMs: frameMax.length ? Math.max(...frameMax) : 0,
    frameP95Ms: frameMax.length ? percentile(frameMax, 95) : 0,
    meanSatisfactionCurve: meanCurve
  };
}

export function fmt(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '-';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(digits);
  return String(v);
}
export function pct(v) { return v == null || Number.isNaN(v) ? '-' : `${(v * 100).toFixed(1)}%`; }

/** Render rows (arrays of strings) as an aligned text table with a header row. */
export function table(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)));
  const line = (r) => r.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

export function summaryRow(label, a) {
  return [
    label, a.n, pct(a.clearRate), fmt(a.medianFailAtSec, 1), fmt(a.medianPlayCount, 1), fmt(a.meanHiyari, 2),
    fmt(a.meanInterventions, 1), pct(a.comboHiyariRate), pct(a.meanSatLowRatio), fmt(a.frameMaxMs, 2), a.errors
  ];
}
export const SUMMARY_HEADER = ['cell', 'n', 'clear', 'medFailSec', 'medPlay', 'hiyari', 'interv', 'comboRate', 'satLow', 'maxFrameMs', 'errors'];
