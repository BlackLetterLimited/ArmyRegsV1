"use client";

import { useEffect, useMemo, useState } from "react";
import SimpleBarChart from "../../../components/admin/simple-bar-chart";

interface RegulationSource {
  sourceId: string;
  count: number;
}

interface RegulationAggregate {
  regulation: string;
  count: number;
  sources: RegulationSource[];
}

interface RegulationEvent {
  id: string;
  regulation: string;
  sourceId: string;
  uid: string;
  question: string;
  askedAt: string | null;
}

interface RegulationMetricsResponse {
  aggregates: RegulationAggregate[];
  recentEvents: RegulationEvent[];
  error?: string;
}

export default function RegMetricsPage() {
  const [data, setData] = useState<RegulationMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setError(null);
      const response = await fetch("/api/admin/metrics/regulations?limit=25");
      const payload = (await response
        .json()
        .catch(() => ({}))) as RegulationMetricsResponse;
      if (!response.ok) {
        setError(payload.error ?? "Failed to load regulation metrics.");
        return;
      }
      setData(payload);
    };
    void load();
  }, []);

  const chartPoints = useMemo(
    () =>
      (data?.aggregates ?? []).map((aggregate) => ({
        key: aggregate.regulation,
        count: aggregate.count,
      })),
    [data],
  );

  return (
    <div className="admin-section">
      <div className="admin-section__header ds-panel">
        <h1 className="admin-section-title">Regulation Metrics</h1>
        <p className="admin-muted">
          Most cited regulations and source references extracted from assistant
          citations.
        </p>
      </div>
      {error ? <p className="chat-error">{error}</p> : null}
      <div className="admin-grid">
        <SimpleBarChart title="Top Regulations" points={chartPoints} />
      </div>

      <section className="admin-table-wrap ds-panel">
        <h2 className="admin-section-title">Regulation + Source Counts</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Regulation</th>
              <th>Total</th>
              <th>Top Sources</th>
            </tr>
          </thead>
          <tbody>
            {(data?.aggregates ?? []).map((aggregate) => (
              <tr key={aggregate.regulation}>
                <td>{aggregate.regulation}</td>
                <td>{aggregate.count.toLocaleString()}</td>
                <td>
                  {(aggregate.sources ?? [])
                    .slice(0, 3)
                    .map((source) => `${source.sourceId} (${source.count})`)
                    .join(", ") || "n/a"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="admin-table-wrap ds-panel">
        <h2 className="admin-section-title">Recent Citation Events</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Asked At</th>
              <th>Regulation</th>
              <th>Source ID</th>
              <th>User</th>
              <th>Question</th>
            </tr>
          </thead>
          <tbody>
            {(data?.recentEvents ?? []).map((event) => (
              <tr key={event.id}>
                <td>
                  {event.askedAt
                    ? new Date(event.askedAt).toLocaleString()
                    : "n/a"}
                </td>
                <td>{event.regulation}</td>
                <td>{event.sourceId}</td>
                <td>{event.uid}</td>
                <td>{event.question}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
