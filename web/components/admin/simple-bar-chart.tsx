interface ChartPoint {
  key: string;
  count: number;
}

interface SimpleBarChartProps {
  title: string;
  points: ChartPoint[];
  emptyLabel?: string;
}

export default function SimpleBarChart({ title, points, emptyLabel }: SimpleBarChartProps) {
  const maxCount = points.reduce((max, point) => Math.max(max, point.count), 0);

  return (
    <section className="admin-chart ds-panel" aria-label={title}>
      <h2 className="admin-section-title">{title}</h2>
      {points.length === 0 ? (
        <p className="admin-muted">{emptyLabel ?? "No data yet."}</p>
      ) : (
        <ul className="admin-chart__list">
          {points.map((point) => {
            const width = maxCount > 0 ? Math.max(6, Math.round((point.count / maxCount) * 100)) : 0;
            return (
              <li key={point.key} className="admin-chart__item">
                <div className="admin-chart__row">
                  <span className="admin-chart__label">{point.key}</span>
                  <span className="admin-chart__value">{point.count.toLocaleString()}</span>
                </div>
                <div className="admin-chart__bar-wrap">
                  <div className="admin-chart__bar" style={{ width: `${width}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
