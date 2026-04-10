"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

interface AdminShellProps {
  userEmail: string | null;
  children: ReactNode;
}

const NAV_ITEMS = [
  { href: "/admin/users", label: "User Management" },
  { href: "/admin/user-metrics", label: "User Metrics" },
  { href: "/admin/qmetrics", label: "Question Metrics" },
  { href: "/admin/regmetrics", label: "Regulation Metrics" },
] as const;

export default function AdminShell({ userEmail, children }: AdminShellProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const nav = useMemo(
    () => (
      <nav className="admin-nav" aria-label="Admin sections">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="admin-nav__link"
            onClick={() => setIsMenuOpen(false)}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    ),
    [],
  );

  return (
    <div className="admin-page">
      <header
        className="site-header site-header--chat"
        aria-label="Admin header"
      >
        <div className="site-header__inner site-header__inner--chat">
          <div className="site-header__topline site-header__topline--chat">
            <div className="site-header__side-rail site-header__side-rail--start">
              <button
                type="button"
                className="ds-button ds-button--ghost admin-page__menu-button"
                onClick={() => setIsMenuOpen((current) => !current)}
                aria-expanded={isMenuOpen}
                aria-controls="admin-mobile-nav"
              >
                Menu
              </button>
            </div>
            <Link href="/admin/users" className="site-header__logo-link">
              <span className="site-header__brand-text">ArmyRegs.ai Admin</span>
            </Link>
            <div className="site-header__side-rail site-header__side-rail--end">
              <div className="site-header__actions site-header__actions--member">
                <Link
                  href="/chat"
                  className="ds-button ds-button--ghost site-header__clear-button"
                >
                  Back to Chat
                </Link>
              </div>
            </div>
          </div>
        </div>
      </header>

      {isMenuOpen ? (
        <div className="admin-mobile-drawer" id="admin-mobile-nav">
          <div className="admin-mobile-drawer__panel ds-panel">
            <div className="admin-mobile-drawer__header">
              <p className="admin-mobile-drawer__title">Admin Menu</p>
              <button
                type="button"
                className="document-preview__close--icon"
                onClick={() => setIsMenuOpen(false)}
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            {nav}
            <p className="admin-mobile-drawer__user">{userEmail ?? "Admin"}</p>
          </div>
        </div>
      ) : null}

      <main
        className="admin-layout workspace-shell"
        aria-label="Admin workspace"
      >
        <aside className="admin-sidebar ds-panel">
          <p className="admin-sidebar__label">Admin</p>
          {nav}
          <p className="admin-sidebar__user">{userEmail ?? "Admin"}</p>
        </aside>
        <section className="admin-content">{children}</section>
      </main>
    </div>
  );
}
