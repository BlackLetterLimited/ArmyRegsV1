"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

interface AdminUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  providerIds: string[];
  createdAt: string | null;
  lastSignInAt: string | null;
  isAnonymous: boolean;
  isAdmin: boolean;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPageToken, setCurrentPageToken] = useState<string | null>(null);
  const [previousPageTokens, setPreviousPageTokens] = useState<
    (string | null)[]
  >([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"user" | "provider" | "role" | "status">(
    "user",
  );
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const loadUsers = useCallback(
    async (pageToken: string | null = null) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", "20");
        if (query.trim()) params.set("q", query.trim());
        if (pageToken) params.set("pageToken", pageToken);
        const response = await fetch(`/api/admin/users?${params.toString()}`);
        const payload = (await response.json().catch(() => ({}))) as {
          users?: AdminUser[];
          nextPageToken?: string | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load users.");
        }
        setUsers(Array.isArray(payload.users) ? payload.users : []);
        setNextPageToken(payload.nextPageToken ?? null);
        setCurrentPageToken(pageToken);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Failed to load users.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    setPreviousPageTokens([]);
    setCurrentPageToken(null);
    setNextPageToken(null);
    void loadUsers(null);
  }, [loadUsers]);

  const sortedUsers = useMemo(() => {
    const normalized = [...users];
    normalized.sort((left, right) => {
      const providerLeft =
        left.providerIds.join(", ") ||
        (left.isAnonymous ? "anonymous" : "unknown");
      const providerRight =
        right.providerIds.join(", ") ||
        (right.isAnonymous ? "anonymous" : "unknown");
      const roleLeft = left.isAdmin ? "admin" : "member";
      const roleRight = right.isAdmin ? "admin" : "member";
      const statusLeft = left.disabled ? "disabled" : "active";
      const statusRight = right.disabled ? "disabled" : "active";
      const userLeft = (left.email ?? left.uid).toLowerCase();
      const userRight = (right.email ?? right.uid).toLowerCase();

      const values = {
        user: [userLeft, userRight],
        provider: [providerLeft.toLowerCase(), providerRight.toLowerCase()],
        role: [roleLeft, roleRight],
        status: [statusLeft, statusRight],
      } as const;
      const [a, b] = values[sortBy];
      const compare = a.localeCompare(b);
      return sortDirection === "asc" ? compare : -compare;
    });
    return normalized;
  }, [users, sortBy, sortDirection]);

  const summary = useMemo(() => {
    const admins = sortedUsers.filter((entry) => entry.isAdmin).length;
    const disabled = sortedUsers.filter((entry) => entry.disabled).length;
    return { total: users.length, admins, disabled };
  }, [sortedUsers, users.length]);

  const pageNumber = previousPageTokens.length + 1;

  const onSortChange = useCallback(
    (key: "user" | "provider" | "role" | "status") => {
      setSortBy((previous) => {
        if (previous === key) {
          setSortDirection((oldDirection) =>
            oldDirection === "asc" ? "desc" : "asc",
          );
          return previous;
        }
        setSortDirection("asc");
        return key;
      });
    },
    [],
  );

  const goNextPage = useCallback(() => {
    if (!nextPageToken) return;
    setPreviousPageTokens((current) => [...current, currentPageToken]);
    void loadUsers(nextPageToken);
  }, [currentPageToken, loadUsers, nextPageToken]);

  const goPreviousPage = useCallback(() => {
    if (previousPageTokens.length === 0) return;
    const nextHistory = [...previousPageTokens];
    const previousToken = nextHistory.pop() ?? null;
    setPreviousPageTokens(nextHistory);
    void loadUsers(previousToken);
  }, [loadUsers, previousPageTokens]);

  const sortIndicator = useCallback(
    (key: "user" | "provider" | "role" | "status"): string => {
      if (sortBy !== key) return "";
      return sortDirection === "asc" ? "▲" : "▼";
    },
    [sortBy, sortDirection],
  );

  return (
    <div className="admin-section">
      <div className="admin-section__header ds-panel">
        <div>
          <h1 className="admin-section-title">User Management</h1>
          <p className="admin-muted">
            Manage Firebase users, roles (like admin or member), and recovery
            actions.
          </p>
        </div>
        <div className="admin-summary">
          <span>Total: {summary.total}</span>
          <span>Admins: {summary.admins}</span>
          <span>Disabled: {summary.disabled}</span>
        </div>
      </div>

      <div className="admin-tools ds-panel">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="admin-input"
          placeholder="Search by email, name, or UID..."
          aria-label="Search users"
        />
        <button
          type="button"
          className="ds-button ds-button--primary"
          onClick={() => {
            setPreviousPageTokens([]);
            setCurrentPageToken(null);
            setNextPageToken(null);
            void loadUsers(null);
          }}
        >
          Refresh
        </button>
      </div>

      {error ? <p className="chat-error">{error}</p> : null}

      <div className="admin-table-wrap ds-panel">
        {isLoading ? (
          <p className="admin-muted">Loading users...</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>
                  <button
                    type="button"
                    className={`admin-table__sort-link${sortBy === "user" ? " is-active" : ""}`}
                    onClick={() => onSortChange("user")}
                  >
                    User
                    <span
                      className="admin-table__sort-indicator"
                      aria-hidden="true"
                    >
                      {sortIndicator("user")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className={`admin-table__sort-link${sortBy === "provider" ? " is-active" : ""}`}
                    onClick={() => onSortChange("provider")}
                  >
                    Provider
                    <span
                      className="admin-table__sort-indicator"
                      aria-hidden="true"
                    >
                      {sortIndicator("provider")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className={`admin-table__sort-link${sortBy === "role" ? " is-active" : ""}`}
                    onClick={() => onSortChange("role")}
                  >
                    Role
                    <span
                      className="admin-table__sort-indicator"
                      aria-hidden="true"
                    >
                      {sortIndicator("role")}
                    </span>
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className={`admin-table__sort-link${sortBy === "status" ? " is-active" : ""}`}
                    onClick={() => onSortChange("status")}
                  >
                    Status
                    <span
                      className="admin-table__sort-indicator"
                      aria-hidden="true"
                    >
                      {sortIndicator("status")}
                    </span>
                  </button>
                </th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((user) => (
                <tr key={user.uid}>
                  <td>
                    <p className="admin-table__main">
                      {user.email ?? user.uid}
                    </p>
                    <p className="admin-table__sub">{user.uid}</p>
                  </td>
                  <td>
                    {user.providerIds.join(", ") ||
                      (user.isAnonymous ? "anonymous" : "unknown")}
                  </td>
                  <td>{user.isAdmin ? "admin" : "member"}</td>
                  <td>{user.disabled ? "disabled" : "active"}</td>
                  <td>
                    <Link
                      className="ds-button ds-button--ghost"
                      href={`/admin/users/${encodeURIComponent(user.uid)}`}
                    >
                      View User
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div
        className="admin-pagination ds-panel"
        aria-label="Users pagination controls"
      >
        <button
          type="button"
          className="ds-button ds-button--ghost"
          disabled={isLoading || previousPageTokens.length === 0}
          onClick={goPreviousPage}
        >
          Previous
        </button>
        <span className="admin-muted">
          Page {pageNumber} · Showing up to 20 users per page
        </span>
        <button
          type="button"
          className="ds-button ds-button--ghost"
          disabled={isLoading || !nextPageToken}
          onClick={goNextPage}
        >
          Next
        </button>
      </div>
    </div>
  );
}
