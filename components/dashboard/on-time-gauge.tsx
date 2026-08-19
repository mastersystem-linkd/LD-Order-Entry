"use client";

// Split out of dashboard-charts.tsx because it draws raw SVG and pulls in no
// charting library: keeping it here lets the Recharts-backed charts be loaded
// lazily without dragging this gauge (or a loading state) along with them.
// On-time delivery as a semicircular gauge (reserved status colour by band).
export function OnTimeGauge({
  pct,
  onTime,
  late,
}: {
  pct: number;
  onTime: number;
  late: number;
}) {
  const done = onTime + late;
  const R = 70;
  const cx = 90;
  const cy = 96;
  const sw = 16;
  const len = Math.PI * R; // semicircle arc length
  const frac = Math.max(0, Math.min(100, pct)) / 100;
  const color =
    pct >= 90 ? "var(--success)" : pct >= 70 ? "var(--warning)" : "var(--danger)";
  const trackPath = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`;
  return (
    <div className="flex flex-col items-center">
      <div
        role="img"
        aria-label={`On-time delivery ${pct}% — ${onTime} on time, ${late} late`}
        className="relative"
      >
        <svg width="180" height="112" viewBox="0 0 180 112">
          <path
            d={trackPath}
            fill="none"
            stroke="var(--inset)"
            strokeWidth={sw}
            strokeLinecap="round"
          />
          <path
            d={trackPath}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={`${frac * len} ${len}`}
            style={{ transition: "stroke-dasharray 700ms ease" }}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-2 flex flex-col items-center">
          <span className="num font-display text-[28px] font-semibold leading-none text-ink">
            {done === 0 ? "—" : `${pct}%`}
          </span>
          <span className="mt-0.5 text-[11px] text-ink-muted">on time</span>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-success" />
          <span className="text-ink-soft">On time</span>
          <span className="num font-medium text-ink">{onTime}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-danger" />
          <span className="text-ink-soft">Late</span>
          <span className="num font-medium text-ink">{late}</span>
        </span>
      </div>
    </div>
  );
}
