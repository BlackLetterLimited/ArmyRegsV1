"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SimpleBarChart from "../../../components/admin/simple-bar-chart";

const EVENTS_PAGE_SIZE = 20;

interface MetricPoint {
  key: string;
  count: number;
}

interface QuestionEvent {
  id: string;
  uid: string;
  conversationId: string | null;
  question: string;
  askedAt: string | null;
}

interface QuestionMetricsResponse {
  daily: MetricPoint[];
  monthly: MetricPoint[];
  yearly: MetricPoint[];
  events: QuestionEvent[];
  error?: string;
}

export default function QMetricsPage() {
  const [data, setData] = useState<QuestionMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventsPage, setEventsPage] = useState(0);

  useEffect(() => {
    const load = async () => {
      setError(null);
      const response = await fetch("/api/admin/metrics/questions?limit=500");
      const payload = (await response
        .json()
        .catch(() => ({}))) as QuestionMetricsResponse;
      if (!response.ok) {
        setError(payload.error ?? "Failed to load question metrics.");
        return;
      }
      setData(payload);
      setEventsPage(0);
    };
    void load();
  }, []);

  const questionEvents = data?.events ?? [];
  const eventsPageCount = Math.max(1, Math.ceil(questionEvents.length / EVENTS_PAGE_SIZE));
  const safeEventsPage = Math.min(eventsPage, eventsPageCount - 1);
  const pagedQuestionEvents = useMemo(() => {
    const start = safeEventsPage * EVENTS_PAGE_SIZE;
    return questionEvents.slice(start, start + EVENTS_PAGE_SIZE);
  }, [questionEvents, safeEventsPage]);

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
        <h1 className="admin-section-title">Question Metrics</h1>
        <p className="admin-muted">
          Question volume and latest prompts sent to the RAG system.
        </p>
      </div>
      {error ? <p className="chat-error">{error}</p> : null}
      <div className="admin-grid">
        <SimpleBarChart title="Questions by Day" points={data?.daily ?? []} />
        <SimpleBarChart
          title="Questions by Month"
          points={data?.monthly ?? []}
        />
        <SimpleBarChart title="Questions by Year" points={data?.yearly ?? []} />
      </div>
      <section className="admin-table-wrap ds-panel">
        <h2 className="admin-section-title">Recent Questions</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Asked At</th>
              <th>User</th>
              <th>Question</th>
              <th>Conversation</th>
            </tr>
          </thead>
          <tbody>
            {pagedQuestionEvents.map((event) => (
              <tr key={event.id}>
                <td>
                  {event.askedAt
                    ? new Date(event.askedAt).toLocaleString()
                    : "n/a"}
                </td>
                <td>{event.uid}</td>
                <td>{event.question}</td>
                <td>{event.conversationId ?? "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div
        className="admin-pagination ds-panel"
        aria-label="Recent questions pagination"
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
          Page {safeEventsPage + 1} of {eventsPageCount} · Up to {EVENTS_PAGE_SIZE} questions per
          page
          {questionEvents.length > 0 ? ` · ${questionEvents.length} loaded` : ""}
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
