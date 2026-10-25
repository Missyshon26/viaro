# ABL — Operations console

Next.js 16.3 · React 19 · TypeScript · Tailwind 4 · App Router
Role: **`admin`** only. Runs on **:3003**.

```bash
npm install
npm run dev
```

Configure `NEXT_PUBLIC_API_URL` in `.env.local` with the ABL backend URL. Use the test account provided for this portal.

---

## One API, four products

| Product | Project | Port | Roles |
|---|---|---|---|
| Passenger site | `viaro-frontend` | 3000 | `customer` |
| Chauffeur portal | `viaro-driver` | 3001 | `driver` |
| Fleet console | `viaro-company` | 3002 | `company` |
| Operations console | `viaro-admin` | 3003 | `admin` |

All four authenticate against the same backend, so a valid session for the wrong role is
possible. `RequireRole` catches that and says which app to use instead of rendering a
console where every request 403s.

---

## Pages

| Page | Route | Endpoints |
|---|---|---|
| Dashboard | `/` | dashboards, revenue, dispatch pool, pricing, cancellations |
| Bookings | `/bookings` | `GET /admin/dashboard/bookings` |
| Users | `/users` | `GET /admin/dashboard/users` |
| Dispatch | `/dispatch` | `GET /admin/dispatch/pool` (polled) |
| City pricing | `/pricing` | `GET/POST/PATCH /admin/pricing/city` |
| Drivers | `/drivers` | `GET /admin/drivers`, `PATCH /admin/drivers/:id`, penalties |
| Revenue | `/revenue` | `GET /admin/revenue/subscriptions`, `/reports/earnings-payout` |
| Reports | `/reports` | all three reports + CSV/PDF export jobs |
| Support | `/support` | ticket queue, reply, and admin-only status triage |

## What an admin cannot do

`POST /admin/drivers` is **company-only** — an admin can review every chauffeur and set
their payout terms, but cannot add one to a roster. The drivers page says so rather than
offering a form that would 403.

---

## Response shapes worth knowing

Traced against the running API — several are not what the models suggest:

| Endpoint | Returns |
|---|---|
| `GET /admin/dashboard/bookings` | `Paginated<Booking>` — `total` is the count, not a summary object |
| `GET /admin/dashboard/users` | `Paginated<User>` |
| `GET /admin/revenue/subscriptions` | `{ months, totalActive, totalRevenue }` |
| `GET /admin/drivers/penalties` | `{ drivers, totalDrivers, totalEvents }` — not an array |
| `GET /admin/dispatch/pool` | `Paginated<Booking>` — full booking documents |
| `GET /reports/cancellations-penalties` | `{ cancellations, penalties, counts }` |

---

## Not connected yet

Every screen that needs one of these is **built and reachable** — it renders a labelled
placeholder until the environment value is set:

| Variable | What it unlocks |
|---|---|
| `NEXT_PUBLIC_MAP_PROVIDER` + `NEXT_PUBLIC_MAP_API_KEY` | live map rendering |
| `NEXT_PUBLIC_REALTIME_ENABLED` | socket streams for dispatch and tracking; lists poll until then |

Report exports already work: the request returns a job id and the page polls the status
endpoint, then links to the download.


## UI/UX update and local preview

The existing role, API contracts, authentication and operational actions are preserved.
The shared UI now includes a readable type scale, light/dark surface hierarchy, Lucide
icons, responsive logo sizing, grouped navigation, keyboard focus management, mobile
record cards with sorting, clear-search recovery, and accessible reporting-period controls.
Sign-in has role-specific context, a password visibility control, and delayed-server feedback.
Dashboards provide real-data next steps and retry states instead of interpreting failed
requests as empty datasets. Notifications offer recovery and roll back failed read actions.

### Preview configuration

Create `.env.local` (ignored by Git):

```dotenv
NEXT_PUBLIC_API_URL=https://viaro-backend.onrender.com
NEXT_PUBLIC_DEV_API_PROXY=1
```

The optional proxy runs only under `npm run dev`; it lets localhost use the backend
without changing its CORS allowlist. Production continues to call the configured backend
directly. Development refresh cookies are isolated per portal so all three previews can
be used side by side. Never put account passwords or tokens in source files.

### Verification

```bash
npm run typecheck
npm run lint
npm run build
```

### Scope and remaining dependencies

No backend routes, permissions or database models were changed. Company-level platform
reporting, fleet upcoming assignments, and chauffeur driving-distance totals remain
unavailable where the current API does not supply them. These states now explain the
limitation in user-facing language. The passenger app is a separate repository and is
not part of these three console changes. Existing hook lint warnings remain for a
separate lifecycle cleanup; do not interpret a successful lint exit as zero warnings.

The overview and trips pipeline share `src/lib/trips/stage.ts`: completed journeys no
longer count as active, and pickups missed earlier today are flagged as overdue.
Run `npm test` (Node 22.18+ or Node 24+) for the lifecycle regression checks.

### White theme and responsive records

The default is light mode with a standard Arial/Helvetica sans-serif stack. The updated theme preference uses `viaro-theme-v2`, so older automatic dark-mode preferences do not override the white default. An explicitly selected dark theme is still remembered.

Shared lists use container-width breakpoints: labeled cards below 1200px, with dense lists retaining cards below 1440px. Earnings and performance reports stack labeled fields in narrow sections, without horizontal scrolling. Sorting, pagination, links, and record actions remain available.
