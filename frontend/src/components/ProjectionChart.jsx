import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { kgToLb } from "../lib/units";

// Which body-comp number to plot. `field` is the key on each ProjectionPoint.
const METRICS = [
  { key: "weight", label: "Weight", field: "weight_kg", isMass: true },
  { key: "fat", label: "Fat mass", field: "fat_mass_kg", isMass: true },
  { key: "lean", label: "Lean mass", field: "lean_mass_kg", isMass: true },
  { key: "bodyfat", label: "Body fat %", field: "body_fat_pct", isMass: false },
];

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Line chart of the chosen metric over the plan, one line per scenario
 * (conservative / expected / optimistic). Local state only holds which metric
 * is shown - the data all comes from props.
 */
export default function ProjectionChart({ result, units, markerWeek }) {
  const [metricKey, setMetricKey] = useState("weight");
  const metric = METRICS.find((m) => m.key === metricKey);

  const toDisplay = (value) =>
    metric.isMass && units === "imperial" ? kgToLb(value) : value;

  // Recharts wants ONE array of objects, each row = one week with all 3 lines.
  // Memoized: this doesn't depend on markerWeek, so scrubbing/playing the
  // timeline (which re-renders this component every ~130ms) shouldn't rebuild
  // and reallocate up to 260 rows on every tick.
  const data = useMemo(
    () =>
      result.expected.map((point, i) => ({
        week: point.week,
        conservative: round2(toDisplay(result.conservative[i][metric.field])),
        expected: round2(toDisplay(result.expected[i][metric.field])),
        optimistic: round2(toDisplay(result.optimistic[i][metric.field])),
      })),
    // toDisplay/metric are cheap re-derivations of units/metricKey each render,
    // so depending on those two primitives instead is equivalent and simpler.
    [result, units, metricKey]
  );

  const unit = metric.isMass ? (units === "imperial" ? "lb" : "kg") : "%";

  // Use 1 decimal on the Y axis when the whole series fits in a narrow band
  // (e.g. lean mass barely moving), otherwise whole numbers. Memoized for the
  // same reason `data` is: scrubbing/playing the timeline re-renders this
  // component every ~130ms without `data` itself changing, so re-scanning up
  // to 260*3 values on every tick would be pure waste.
  const yDecimals = useMemo(() => {
    const allValues = data.flatMap((d) => [d.conservative, d.expected, d.optimistic]);
    const span = Math.max(...allValues) - Math.min(...allValues);
    return span < 8 ? 1 : 0;
  }, [data]);

  return (
    <div>
      <div className="chart-tabs" role="group" aria-label="Chart metric">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            className={m.key === metricKey ? "active" : ""}
            aria-pressed={m.key === metricKey}
            onClick={() => setMetricKey(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="week"
            stroke="var(--text-dim)"
            tick={{ fontSize: 12 }}
          />
          <YAxis
            stroke="var(--text-dim)"
            tick={{ fontSize: 12 }}
            width={52}
            domain={["auto", "auto"]}
            tickFormatter={(v) => v.toFixed(yDecimals)}
          />
          <Tooltip
            contentStyle={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
            }}
            formatter={(v, name) => [`${v} ${unit}`, cap(name)]}
            labelFormatter={(w) => `Week ${w}`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} formatter={cap} />
          {markerWeek > 0 && (
            <ReferenceLine
              x={markerWeek}
              stroke="var(--text)"
              strokeDasharray="2 3"
              strokeOpacity={0.6}
            />
          )}
          <Line
            type="monotone"
            dataKey="conservative"
            stroke="var(--warn)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="expected"
            stroke="var(--accent)"
            strokeWidth={2.5}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="optimistic"
            stroke="var(--good)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
