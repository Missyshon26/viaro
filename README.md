# viaro-backend

Ride-hailing backend for ABL. Node.js + TypeScript + Express + MongoDB + Redis + Socket.io + BullMQ.

Specs live alongside the code:

- [viaro-backend-full-spec.md](viaro-backend-full-spec.md) — endpoints, models, RBAC matrix, business rules
- [viaro-backend-build-prompts.md](viaro-backend-build-prompts.md) — the step-by-step build order

## Prerequisites

- Node.js 20+
- MongoDB (Atlas cluster or local install)
- Redis (Redis Cloud, Memurai, Docker or WSL)

Redis is not optional — it backs driver geo-search for dispatch, the BullMQ job queues
(penalty timer, report exports), and the refresh-token blacklist.

## Setup

```bash
npm install
cp .env.example .env    # fill in MONGO_URI, REDIS_URL and both JWT secrets
npm run dev
```

The process exits immediately with a list of missing keys if the environment is incomplete.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | ts-node-dev with respawn on change |
| `npm run build` | compile TypeScript to `dist/` |
| `npm start` | run the compiled build |
| `npm run typecheck` | type check without emitting |
| `npm run seed` | populate realistic test data (accounts, trips, wallets, chat) |
| `npm run seed:clean` | remove everything the seed created |
| `npm run test:api` | run the Postman collection headlessly via Newman |
| `npm run postman:generate` | regenerate the collection after route changes |

## Testing the API

```bash
npm run seed     # test accounts + a completed trip, a refund, a penalty
npm run dev      # in another terminal
npm run test:api # 97 requests, 237 assertions
```

**In Postman**, import both files from [postman/](postman/):

- `ABL-Backend.postman_collection.json` — 11 folders, every endpoint, all asserted
- `ABL-Local.postman_environment.json` — points at `http://localhost:5000`

Run the **`00 · Setup`** folder first (it logs in as each role and stores the tokens), or hit
**Run collection** to execute the whole flow in order — the requests chain into each other,
so a booking created in folder 04 is accepted in 05, cancelled in 06 and settled in 07.

Seeded accounts, all with password `test1234`:

| Email | Role | Notes |
|---|---|---|
| `admin@abl.test` | admin | |
| `company@abl.test` | company | owns the fleet driver |
| `driver.company@abl.test` | driver | company roster, flat 30/trip, has a penalty |
| `driver.platform@abl.test` | driver | platform-owned, 70% of the platform share |
| `customer1@abl.test` | customer | completed trip, cancelled trip + 90% refund |
| `customer2@abl.test` | customer | active subscription (flat fares) |

Note that dispatch is asynchronous — after creating a booking, the collection polls until
it reaches `dispatched` before a driver accepts. Accepting instantly returns 409 by design.

## Layout

```
src/
├── config/        env, db, redis, timezone (America/Los_Angeles helper)
├── middlewares/   authGuard, roleGuard, errorHandler, rateLimiter
├── models/        Mongoose schemas
├── modules/       feature modules — *.routes / *.controller / *.service / *.validation
├── sockets/       io registry, socketAuth, and the four namespaces
├── jobs/          BullMQ queues + penalty, cancellationWindow, payout, reportExport workers
├── integrations/  flightApi, paymentGateway, smsPush (all PLACEHOLDER)
├── utils/
├── app.ts         Express app — all routers mount here
└── server.ts      HTTP + Socket.io + queue workers bootstrap
```

## API

All responses are `{ success, data }` or `{ success: false, message, details? }`.
Auth is `Authorization: Bearer <accessToken>`.

| Group | Endpoints |
|---|---|
| Auth | `POST /auth/register` · `/auth/login` · `/auth/refresh` · `/auth/logout` |
| Users | `GET|PATCH /users/me` · `POST /users/me/documents` · `GET|POST|DELETE /users/me/favorites[/:driverId]` |
| Pricing | `POST|GET|DELETE /subscriptions[/me]` · `GET /pricing/fare-estimate` · `POST|GET|PATCH /admin/pricing/city[/:id]` |
| Booking | `POST /bookings` · `GET|PATCH|DELETE /bookings/:id` · `POST /bookings/:id/favorite-driver` · `GET /users/me/rides[/:id/receipt]` |
| Dispatch | `GET /admin/dispatch/pool` · WS `/dispatch` |
| Trip | `POST /trips/:bookingId/accept` · `GET /trips/:id` · `POST /trips/:id/start|complete|cancel|rate` · `PATCH /trips/:id/vehicle-class|location` |
| Cancellation | `POST /trips/:id/cancel/point-to-point|airport|hourly` |
| Wallet | `GET /wallet/me` · `POST /wallet/withdraw` · `POST /wallet/use-credit` · `POST /payments/collect` · `POST /payments/webhook` |
| Notifications | `GET /notifications` · `PATCH /notifications/:id/read` |
| Flight | `GET /flight/:flightNumber` |
| Chat | `GET /trips/:id/chat/history` · WS `/chat/:tripId` |
| Reports | `GET /reports/trips-completed|earnings-payout|cancellations-penalties` · `GET /reports?type=&format=csv\|pdf` · `GET /reports/exports/:jobId[/download]` |
| Admin | `POST|GET|PATCH /admin/drivers[/:id]` · `GET /admin/drivers/penalties` · `GET /admin/dashboard/bookings|users` · `GET /admin/revenue/subscriptions` |

### Socket namespaces

| Namespace | Who connects | Events |
|---|---|---|
| `/dispatch` | drivers only | server → `booking:new`, `booking:claimed`; client → `location:update`, `booking:claimed` |
| `/tracking/:tripId` | assigned driver emits, customer/admin subscribe | `location:update` |
| `/chat/:tripId` | customer + driver read/write, **admin read-only** | `message:new`, `chat:error` |
| `/notify/:userId` | that user only | `notification:new` |

Authenticate the handshake with `io(url, { auth: { token } })`.

## Business rules that are easy to break

1. **Never call `new Date()` for business logic.** Every booking, cancellation, refund,
   peak-hour and report comparison goes through [src/config/timezone.ts](src/config/timezone.ts),
   fixed to `America/Los_Angeles` (spec §8 rule 1).
2. **Never read `process.env` outside [src/config/env.ts](src/config/env.ts).**
3. **`GET /trips/:id` strips `fareAmount` for drivers and masks the driver's phone for
   customers** — both live in `shapeTripForRole()` in
   [trip.service.ts](src/modules/trip/trip.service.ts), not in controllers.
4. **Refunds credit the wallet with zero fee; the 10% fee exists only on withdrawal.**
   These are two separate functions on purpose — do not merge them.
5. **One refund policy function**, `cancellationPolicy.evaluate(tripType, scheduledAt)` in
   [cancellation.service.ts](src/modules/cancellation/cancellation.service.ts):
   point-to-point/airport ≥24h → 90%, hourly ≥72h → 90%, otherwise 0.
6. **Reports are role-scoped in one place** — `buildScope()` in
   [reports.service.ts](src/modules/reports/reports.service.ts).
7. **Routers sharing the `/trips` prefix attach guards per route, never `router.use()`** —
   router-level middleware also runs for requests destined for a sibling router.

## Background jobs

| Job | Trigger | What it does |
|---|---|---|
| `penalty.job` | armed when a booking hits the public pool | after 2 min with no acceptance, records a `PenaltyEvent` per silent driver and delays their future ride alerts |
| `cancellationWindow.job` | armed when a booking is created | fires when the 90%-refund window closes, so the customer is warned instead of surprised |
| `payout.job` | repeatable, Mondays 09:00 PT | sweeps driver balances ≥ 25 and notifies them earnings are ready — **does not move money**, see below |
| `reportExport.job` | `GET /reports?format=csv\|pdf` | renders the export off the request thread |

## How the money moves

Settlement runs in [wallet.service.ts](src/modules/wallet/wallet.service.ts) on trip completion:

1. **The customer's fare is split once** — `COMPANY_REVENUE_PCT` / `ADMIN_REVENUE_PCT`
   (default 60 / 40). A public-pool ride taken by a company's driver still splits this way.
2. **The driver is paid by whoever owns them, out of that owner's share.** A company pays
   its roster drivers from its 60; the admin/platform pays unrostered drivers from its share.
   The driver is never paid straight from the fare, so the fare is allocated exactly once
   and the ledgers reconcile.
3. **The rate is per driver**, set by the owner via `PATCH /admin/drivers/:id`:
   `{ "payout": { "mode": "flat", "value": 25 } }` — a fixed charge per trip — or
   `{ "mode": "percentage", "value": 70 }` — a share of the owner's cut.
   `DRIVER_PAYOUT_MODE` / `DRIVER_PAYOUT_VALUE` are the defaults until an owner sets one.

A company can only set terms for its own roster; the admin can only set terms for drivers
on no roster. If a flat rate exceeds what a trip earned the owner, the owner's balance goes
negative — a visible debt rather than a silently skipped payment.

## Provider integrations

All three are real clients now, selected by env var, each falling back to safe local
behaviour when no key is set — so the app runs end to end before you have accounts.

| File | Providers | Without a key |
|---|---|---|
| [flightApi.ts](src/integrations/flightApi.ts) | `aviationstack`, `flightaware` | mock flight, arriving in 90 min |
| [paymentGateway.ts](src/integrations/paymentGateway.ts) | `stripe` (PaymentIntents + real webhook signature check) | mock charge, no money moves |
| [smsPush.ts](src/integrations/smsPush.ts) | `twilio`, `firebase`/`fcm`, `expo` | logs what would have been sent |

Fill the keys in `.env` and set the matching `*_PROVIDER` value — no code change needed.
Register your gateway webhook against `POST /payments/webhook`; the exact request bytes are
captured in [app.ts](src/app.ts) so Stripe's `t=…,v1=…` signature verifies correctly.

## Open decisions

- **Automatic payouts and the 10% fee** — spec §8 rule 3 defines the fee as a *withdrawal*
  charge, and withdrawals are driver-initiated. Whether a scheduled payout carries the same
  fee is unanswered, so [payout.job.ts](src/jobs/payout.job.ts) notifies rather than transfers.
- Payment gateway, flight data API and SMS/push providers — all stubbed in
  [src/integrations/](src/integrations/); swapping in a real provider touches one file each.
- S3 bucket for driver documents ([utils/s3.ts](src/utils/s3.ts)).
- Deployment target (subdomain/server) — not `x1.xelocorp.com`.

## Health check

`GET /health` returns service name, environment, active timezone and current app time.
