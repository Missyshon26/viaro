"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Logo } from "@/components/brand/Logo";
import { useTheme } from "@/components/theme/ThemeToggle";
import { useAuth } from "@/lib/auth/AuthProvider";
import { listNotifications, markNotificationRead } from "@/lib/api/notifications";
import { Avatar } from "@/components/ui/Dashboard";
import { useNavBadges } from "@/lib/nav/useNavBadges";
import type { Notification } from "@/lib/api/types";
import {
  IconBell,
  IconCalendar,
  IconCar,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconDispatch,
  IconDocument,
  IconHome,
  IconInbox,
  IconLogout,
  IconMenu,
  IconMoney,
  IconMoon,
  IconPackage,
  IconPanelLeft,
  IconPenalty,
  IconPricing,
  IconReport,
  IconRoute,
  IconSearch,
  IconSun,
  IconSupport,
  IconUsers,
} from "@/components/ui/Icons";

/**
 * Console chrome: a collapsible rail, a top bar and the page body.
 *
 * Shared verbatim across the three consoles so the product reads as one platform; what
 * changes per app is the `nav` array and the `title`, nothing else. Nav items carry an
 * icon *key* rather than an element so the array can be declared in a server component
 * and still cross the boundary into this client component.
 */

export type NavIcon =
  | "home"
  | "calendar"
  | "route"
  | "users"
  | "dispatch"
  | "pricing"
  | "car"
  | "money"
  | "report"
  | "support"
  | "document"
  | "penalty"
  | "package";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

const ICONS: Record<NavIcon, (p: { size?: number; className?: string }) => ReactNode> = {
  home: IconHome,
  calendar: IconCalendar,
  route: IconRoute,
  users: IconUsers,
  dispatch: IconDispatch,
  pricing: IconPricing,
  car: IconCar,
  money: IconMoney,
  report: IconReport,
  support: IconSupport,
  document: IconDocument,
  penalty: IconPenalty,
  package: IconPackage,
};

const COLLAPSE_KEY = "abl-console-collapsed";

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

export function ConsoleShell({
  nav,
  title,
  children,
}: {
  nav: NavItem[];
  title: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  // Counts of items that arrived since each section was last opened.
  const badges = useNavBadges();

  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drawer) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, summary, [tabindex="0"]') ?? []).filter((element) => element.offsetParent !== null);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(false);
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, [drawer]);

  // Restored after mount rather than during render: the value lives in localStorage,
  // which the server cannot see, so reading it in render would mismatch hydration.
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSE_KEY, prev ? "0" : "1");
      return !prev;
    });
  }, []);

  // A tap on a nav item should not leave the drawer sitting open over the new page.
  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  const current = nav.find((item) => isActive(pathname, item.href));
  const pageTitle = current?.label ?? title;

  return (
    <div className="flex min-h-dvh bg-surface">
      <a href="#main-content" className="skip-link">Skip to content</a>
      {/* ------------------------------ desktop rail ------------------------- */}
      <aside
        id="desktop-sidebar"
        aria-label="Workspace sidebar"
        className={`workspace-rail sticky top-0 z-40 hidden h-dvh shrink-0 flex-col border-r border-border bg-bg transition-[width] duration-200 lg:flex ${
          collapsed ? "w-[76px]" : "w-[248px]"
        }`}
      >
        <div
          className={`flex h-[80px] shrink-0 items-center border-b border-border-subtle ${
            collapsed ? "justify-center px-3" : "px-5"
          }`}
        >
          <Link href="/" aria-label={title} className="flex min-w-0 items-center gap-3 rounded-lg">
            <Logo width={collapsed ? 38 : 48} />
            {!collapsed && <span className="border-l border-border pl-3"><span className="block text-meta font-bold tracking-tight text-fg">ABL Console</span><span className="mt-0.5 block text-[11px] text-fg-muted">Operations workspace</span></span>}
          </Link>
        </div>

        <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
          <Navigation nav={nav} pathname={pathname} collapsed={collapsed} badges={badges} />
        </nav>

        <div className="shrink-0 border-t border-border-subtle p-3">
          <UserBlock
            collapsed={collapsed}
            onLogout={logout}
            name={user?.name}
            email={user?.email}
          />

        </div>
      </aside>

      {/* ------------------------------ mobile drawer ------------------------ */}
      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close the menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-panel/50 backdrop-blur-[2px]"
          />
          <div ref={drawerRef} role="dialog" aria-modal="true" aria-label="Navigation" className="absolute inset-y-0 left-0 flex w-[min(300px,85vw)] flex-col bg-bg shadow-[var(--shadow-raised)]">
            <div className="flex h-[80px] shrink-0 items-center justify-between border-b border-border-subtle px-5">
              <Logo width={64} />
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Close the menu"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-fg-muted hover:bg-surface hover:text-fg"
              >
                <IconClose />
              </button>
            </div>
            <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
              <Navigation nav={nav} pathname={pathname} collapsed={false} badges={badges} />
            </nav>
            <div className="shrink-0 border-t border-border-subtle p-3">
              <UserBlock
                collapsed={false}
                onLogout={logout}
                name={user?.name}
                email={user?.email}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* --------------------------------- body ------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="workspace-topbar sticky top-0 z-30 flex h-[80px] shrink-0 items-center gap-2 border-b border-border bg-bg/85 px-4 backdrop-blur lg:gap-4 lg:px-7">
          <button type="button" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="desktop-sidebar" className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-field border border-border bg-surface-raised text-fg-muted transition-colors hover:border-accent/40 hover:bg-surface hover:text-accent lg:inline-flex">
            <IconPanelLeft size={18} className={collapsed ? "rotate-180" : ""} />
          </button>
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open the menu"
            aria-expanded={drawer}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-field text-fg-muted hover:bg-surface hover:text-fg lg:hidden"
          >
            <IconMenu />
          </button>
          <Link href="/" aria-label="ABL home" className="shrink-0 lg:hidden"><Logo width={40} /></Link>

          <div className="min-w-0 flex-1">
            <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 sm:flex">
              <span className="text-label font-bold uppercase tracking-wider text-fg-muted">
                {title}
              </span>
              {current && current.href !== "/" ? (
                <>
                  <IconChevronRight size={12} className="text-fg-faint" />
                  <span className="text-label font-bold uppercase tracking-wider text-accent-strong">
                    {current.label}
                  </span>
                </>
              ) : null}
            </nav>
            <h1 className="truncate text-[1.0625rem] font-bold tracking-tight text-fg">
              {pageTitle}
            </h1>
          </div>

          <SearchBox nav={nav} />
          <NotificationBell />
          <ThemeButton />
          <ProfileMenu
            name={user?.name}
            email={user?.email}
            role={user?.role}
            onLogout={logout}
          />
        </header>

        <main id="main-content" tabIndex={-1} className="workspace-main min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>

        <footer className="border-t border-border-subtle bg-bg px-4 py-3.5 lg:px-7">
          <div className="flex flex-col gap-1 text-micro text-fg-muted sm:flex-row sm:items-center">
            <p>© 2026 ABL · {title}</p>
            <p className="sm:ml-auto">Your ABL workspace</p>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* --------------------------------- fragments ------------------------------- */

function Navigation({ nav, pathname, collapsed, badges }: { nav: NavItem[]; pathname: string; collapsed: boolean; badges: Record<string, number> }) {
  const groups = [
    { label: "Workspace", paths: ["/", "/trips", "/requests", "/schedule", "/drivers"] },
    { label: "Finance & insights", paths: ["/revenue", "/earnings", "/pricing", "/reports", "/penalties", "/cancellations"] },
    { label: "Management", paths: ["/users", "/clients", "/vehicles", "/packages", "/documents", "/support", "/apply"] },
  ];
  return <div className={collapsed ? "space-y-4" : "space-y-5"}>{groups.map((group, index) => {
    const items = nav.filter((item) => group.paths.includes(item.href));
    if (!items.length) return null;
    return <div key={group.label} role="group" aria-label={group.label}>
      {collapsed ? (index > 0 && <div aria-hidden className="mx-3 mb-4 h-px bg-border-subtle" />) : <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-muted">{group.label}</p>}
      <ul className="space-y-1">{items.map((item) => <li key={item.href}><NavLink item={item} active={isActive(pathname, item.href)} collapsed={collapsed} badge={badges[item.href] ?? 0} /></li>)}</ul>
    </div>;
  })}</div>;
}

function NavLink({
  item,
  active,
  collapsed,
  badge = 0,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  /** Items that arrived since this section was last opened. 0 renders nothing. */
  badge?: number;
}) {
  const Glyph = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={`relative flex h-11 items-center gap-3 rounded-[10px] border text-meta font-medium transition-colors ${
        collapsed ? "justify-center px-0" : "px-3"
      } ${
        active
          ? "border-accent/15 bg-accent-soft font-semibold text-accent-strong"
          : "border-transparent text-fg-body hover:border-border-subtle hover:bg-surface hover:text-fg"
      }`}
    >
      {/* The active marker is a rail tick rather than a full-height bar, so a collapsed
          sidebar still shows which page you are on without the label. */}
      {active ? (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent"
        />
      ) : null}
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center ${active ? "text-accent" : "text-fg-muted"}`}><Glyph size={18} /></span>
      {collapsed ? <span className="sr-only">{item.label}</span> : item.label}

      {badge > 0 ? (
        <>
          {/* Two presentations of one number: a pill beside the label, and a dot on the
              icon when the rail is collapsed and there is no label to sit next to. */}
          {collapsed ? (
            <span
              aria-hidden
              className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-bg"
            />
          ) : (
            <span
              aria-hidden
              className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-accent-soft px-1.5 text-[10px] font-bold text-accent-strong"
            >
              {badge > 9 ? "9+" : badge}
            </span>
          )}
          <span className="sr-only">
            {badge} new {badge === 1 ? "item" : "items"}
          </span>
        </>
      ) : null}
    </Link>
  );
}

function UserBlock({
  collapsed,
  name,
  email,
  onLogout,
}: {
  collapsed: boolean;
  name?: string;
  email?: string;
  onLogout: () => Promise<void>;
}) {
  return <ProfileMenu name={name} email={email} onLogout={onLogout} sidebar collapsed={collapsed} />;
}

/**
 * Jumps between console screens. Deliberately scoped to navigation rather than
 * pretending to search records: there is no cross-entity search endpoint, and a box
 * that looks like it searches trips but only filters menu labels would be a lie.
 */
function SearchBox({ nav }: { nav: NavItem[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, close);

  const matches = query
    ? nav.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
    : nav;

  return (
    <div ref={ref} className="relative hidden md:block">
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
      >
        <IconSearch size={16} />
      </span>
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Find a section…"
        aria-label="Jump to a screen"
        className="h-9 w-[190px] rounded-field border border-border bg-surface pl-9 pr-3 text-meta text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
      />
      {open ? (
        <ul className="absolute right-0 top-11 z-40 w-[240px] overflow-hidden rounded-card border border-border bg-surface-raised py-1 shadow-[var(--shadow-raised)]">
          {matches.length === 0 ? <li className="px-4 py-3 text-note text-fg-muted">No sections found. Try another name.</li> : null}
          {matches.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => {
                  setQuery("");
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-meta text-fg-body hover:bg-surface hover:text-fg"
              >
                {ICONS[item.icon]({ size: 16 })}
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function NotificationBell() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, close);

  const [error, setError] = useState<string | null>(null);
  const loadNotifications = useCallback(async () => {
    try { setItems(await listNotifications()); setError(null); }
    catch { setError("Notifications could not be loaded. Please try again."); }
  }, []);
  useEffect(() => { void loadNotifications(); }, [loadNotifications]);

  const unread = (items ?? []).filter((n) => !n.read).length;

  async function readOne(id: string) {
    setItems((prev) => prev?.map((n) => (n._id === id ? { ...n, read: true } : n)) ?? prev);
    try {
      await markNotificationRead(id);
    } catch {
      setItems((prev) => prev?.map((n) => (n._id === id ? { ...n, read: false } : n)) ?? prev);
      setError("Could not mark this notification as read. Please try again.");
    }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-field text-fg-muted transition-colors hover:bg-surface hover:text-fg"
      >
        <IconBell />
        {unread > 0 ? (
          <span className="absolute right-1.5 top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.5625rem] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed inset-x-4 top-24 z-40 sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[21rem] overflow-hidden rounded-card border border-border bg-surface-raised shadow-[var(--shadow-raised)]">
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
            <p className="text-meta font-bold text-fg">Notifications</p>
            {unread > 0 ? (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-label font-bold text-accent-strong">
                {unread} new
              </span>
            ) : null}
          </div>

          {error ? <div role="alert" className="px-4 py-5 text-note"><p className="text-danger">{error}</p><button type="button" onClick={() => void loadNotifications()} className="mt-3 rounded-field border border-border px-4 py-2 font-bold text-accent">Try again</button></div> : items === null ? (
            <p className="px-4 py-6 text-note text-fg-muted">Loading…</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-8 text-center">
              <IconInbox size={22} className="mb-2 text-fg-muted" />
              <p className="text-note text-fg-muted">Nothing to catch up on.</p>
            </div>
          ) : (
            <ul className="max-h-[22rem] divide-y divide-border-subtle overflow-y-auto">
              {items.map((n) => (
                <li key={n._id}>
                  <button
                    type="button"
                    onClick={() => readOne(n._id)}
                    className="flex w-full gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        n.read ? "bg-transparent" : "bg-accent"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block text-note leading-snug text-fg">
                        {n.payload?.message ?? n.type.replace(/[._]/g, " ")}
                      </span>
                      <span className="mt-0.5 block text-label text-fg-muted">
                        {new Date(n.createdAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ThemeButton() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to the ${theme === "dark" ? "light" : "dark"} theme`}
      className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-field text-fg-muted transition-colors hover:bg-surface hover:text-fg sm:inline-flex"
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}

function ProfileMenu({
  name,
  email,
  role,
  onLogout,
  sidebar = false,
  collapsed = false,
}: {
  sidebar?: boolean;
  collapsed?: boolean;
  name?: string;
  email?: string;
  role?: string | null;
  onLogout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, close);

  return (
    <div ref={ref} className="relative shrink-0" onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Account menu"
        className={sidebar ? `flex min-h-12 w-full items-center gap-2.5 rounded-field border border-transparent text-left transition-colors hover:border-border hover:bg-surface ${collapsed ? "justify-center p-1" : "bg-surface/60 p-2"}` : "flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full p-0.5 transition-colors hover:bg-surface"}
      >
        <Avatar name={name} size={32} />
        {sidebar && !collapsed && <span className="min-w-0 flex-1"><span className="block truncate text-meta font-bold text-fg">{name ?? "Account"}</span><span className="mt-0.5 block truncate text-[11px] text-fg-muted">{email ?? "Manage your account"}</span></span>}
        {(!sidebar || !collapsed) && <IconChevronDown size={14} className={`${sidebar ? "shrink-0 rotate-180" : "hidden sm:block"} text-fg-muted`} />}
      </button>

      {open ? (
        <div className={`absolute z-40 w-[15rem] overflow-hidden rounded-card border border-border bg-surface-raised shadow-[var(--shadow-raised)] ${sidebar ? "bottom-full left-0 mb-2" : "right-0 top-12"}`}>
          <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3">
            <Avatar name={name} size={36} />
            <div className="min-w-0">
              <p className="truncate text-meta font-bold text-fg">{name ?? "—"}</p>
              <p className="truncate text-label text-fg-muted">{email ?? ""}</p>
            </div>
          </div>
          {role ? (
            <p className="px-4 pt-3 text-label font-bold uppercase tracking-wider text-fg-muted">
              Signed in as {role}
            </p>
          ) : null}
          <div className="p-2">
            <button
              type="button"
              onClick={onLogout}
              className="flex h-9 w-full items-center gap-2.5 rounded-field px-2.5 text-meta font-bold text-fg-body transition-colors hover:bg-surface hover:text-danger"
            >
              <IconLogout size={16} />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Closes a popover on an outside click or Escape. */
function useDismiss(ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, close]);
}
