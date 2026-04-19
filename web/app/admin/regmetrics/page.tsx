"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SimpleBarChart from "../../../components/admin/simple-bar-chart";

const EVENTS_PAGE_SIZE = 20;

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
  const [eventsPage, setEventsPage] = useState(0);

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
      setEventsPage(0);
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

  const recentEvents = data?.recentEvents ?? [];
  const eventsPageCount = Math.max(1, Math.ceil(recentEvents.length / EVENTS_PAGE_SIZE));
  const safeEventsPage = Math.min(eventsPage, eventsPageCount - 1);
  const pagedEvents = useMemo(() => {
    const start = safeEventsPage * EVENTS_PAGE_SIZE;
    return recentEvents.slice(start, start + EVENTS_PAGE_SIZE);
  }, [recentEvents, safeEventsPage]);

  const goEventsPrev = useCallback(() => {
    setEventsPage((page) => Math.max(0, page - 1));
  }, []);

  const goEventsNext = useCallback(() => {
    setEventsPage((page) => Math.min(eventsPageCount - 1, page + 1));
  }, [eventsPageCount]);

  useEffect(() => {
    setEventsPage((page) => Math.min(page, Math.max(0, eventsPageCount - 1)));
  }, [eventsPageCount]);

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
                <td data-label="Regulation">{aggregate.regulation}</td>
                <td data-label="Total">{aggregate.count.toLocaleString()}</td>
                <td data-label="Top Sources">
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
            {pagedEvents.map((event) => (
              <tr key={event.id}>
                <td data-label="Asked At">
                  {event.askedAt
                    ? new Date(event.askedAt).toLocaleString()
                    : "n/a"}
                </td>
                <td data-label="Regulation">{event.regulation}</td>
                <td data-label="Source ID">{event.sourceId}</td>
                <td data-label="User">{event.uid}</td>
                <td data-label="Question">{event.question}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div
        className="admin-pagination ds-panel"
        aria-label="Recent citation events pagination"
      >
        <button
          type="button"
          className="ds-button ds-button--ghost"
          disabled={safeEventsPage <= 0}
          onClick={goEventsPrev}
        >
          Previous
        </button>
        <span className="admin-muted">
          Page {safeEventsPage + 1} of {eventsPageCount} · Up to {EVENTS_PAGE_SIZE} events per
          page
          {recentEvents.length > 0 ? ` · ${recentEvents.length} loaded` : ""}
        </span>
        <button
          type="button"
          className="ds-button ds-button--ghost"
          disabled={safeEventsPage >= eventsPageCount - 1}
          onClick={goEventsNext}
        >
          Next
        </button>
      </div>
    </div>
  );
}
