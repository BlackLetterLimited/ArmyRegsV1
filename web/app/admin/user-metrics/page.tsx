"use client";

import { useEffect, useState } from "react";
import SimpleBarChart from "../../../components/admin/simple-bar-chart";

interface MetricPoint {
  key: string;
  count: number;
}

interface UserMetricResponse {
  daily: MetricPoint[];
  monthly: MetricPoint[];
  yearly: MetricPoint[];
  providers: MetricPoint[];
  error?: string;
}

export default function UserMetricsPage() {
  const [data, setData] = useState<UserMetricResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setError(null);
      const response = await fetch("/api/admin/metrics/users");
      const payload = (await response.json().catch(() => ({}))) as UserMetricResponse;
      if (!response.ok) {
        setError(payload.error ?? "Failed to load user metrics.");
        return;
      }
      setData(payload);
    };
    void load();
  }, []);

  return (
    <div className="admin-section">
      <div className="admin-section__header ds-panel">
        <h1 className="admin-section-title">User Metrics</h1>
        <p className="admin-muted">Account creation trends by day, month, year, and provider.</p>
      </div>
      {error ? <p className="chat-error">{error}</p> : null}
      <div className="admin-grid">
        <SimpleBarChart title="Accounts by Day" points={data?.daily ?? []} />
        <SimpleBarChart title="Accounts by Month" points={data?.monthly ?? []} />
        <SimpleBarChart title="Accounts by Year" points={data?.yearly ?? []} />
        <SimpleBarChart title="Provider Breakdown" points={data?.providers ?? []} />
      </div>
    </div>
  );
}
