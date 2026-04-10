"use client";

import { useEffect, useState } from "react";
import SimpleBarChart from "../../../components/admin/simple-bar-chart";

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

  useEffect(() => {
    const load = async () => {
      setError(null);
      const response = await fetch("/api/admin/metrics/questions?limit=200");
      const payload = (await response
        .json()
        .catch(() => ({}))) as QuestionMetricsResponse;
      if (!response.ok) {
        setError(payload.error ?? "Failed to load question metrics.");
        return;
      }
      setData(payload);
    };
    void load();
  }, []);

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
            {(data?.events ?? []).map((event) => (
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
    </div>
  );
}
