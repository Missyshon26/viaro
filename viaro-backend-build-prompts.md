# ABL Backend — Build Prompts (one per step)

Each prompt below is self-contained — paste it into Claude Code (or whatever you're building with) one at a time, in order. Each one only references what's already been built in prior steps, so nothing gets ahead of itself. All endpoints, models, and rules are pulled directly from `viaro-backend-full-spec.md` — nothing added, nothing skipped.

---

## Prompt 0 — Project Scaffold

```
Set up a new Node.js + TypeScript + Express backend project called "viaro-backend".

Install: express, mongoose, ioredis, socket.io, bullmq, jsonwebtoken, bcrypt, dotenv,
zod (for validation), cors, helmet, morgan. Dev deps: typescript, ts-node-dev,
@types/express, @types/node, @types/jsonwebtoken, @types/bcrypt, @types/cors.

Create this exact folder structure under src/:
config/ (db.ts, redis.ts, env.ts, timezone.ts)
middlewares/ (authGuard.ts, roleGuard.ts, errorHandler.ts, rateLimiter.ts)
models/
modules/ (empty folders: auth, users, pricing, booking, dispatch, trip, cancellation,
  wallet, notifications, chat, reports, admin, flight)
sockets/
jobs/
integrations/ (flightApi.ts, paymentGateway.ts, smsPush.ts — empty stub files with a
  TODO comment noting these are placeholder providers, real implementation pending)
utils/
app.ts
server.ts

config/timezone.ts must export a single shared helper (e.g. using a library like
luxon or dayjs with timezone plugin) that all date/time logic elsewhere will use —
fixed to America/Los_Angeles. Do not let any other file call `new Date()` directly
for business-rule comparisons; they must go through this helper.

middlewares/authGuard.ts: verifies JWT access token from Authorization header,
attaches decoded { userId, role } to req.user.

middlewares/roleGuard.ts: exports a function roleGuard(...allowedRoles: string[])
that returns Express middleware, checks req.user.role against allowedRoles, 403 if
not allowed.

Create .env.example with exactly these keys:
PORT, MONGO_URI, REDIS_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
FLIGHT_API_PROVIDER, FLIGHT_API_KEY, PAYMENT_GATEWAY_PROVIDER,
PAYMENT_GATEWAY_SECRET_KEY, PAYMENT_GATEWAY_WEBHOOK_SECRET, SMS_PUSH_PROVIDER,
SMS_PUSH_API_KEY, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, APP_TIMEZONE=America/Los_Angeles

app.ts: Express app with helmet, cors, morgan, json body parsing, and a central
errorHandler middleware mounted last.
server.ts: connects Mongo + Redis, then starts the HTTP server with Socket.io attached
(sockets themselves come later — just get the Socket.io server instance created and
exported from here so later steps can attach namespaces to it).

Do not build any routes or models yet — this step is scaffold only.
```

---

## Prompt 1 — Auth, Users, RBAC

```
Building on the existing viaro-backend scaffold, implement the auth and users modules.

Create models/User.ts (Mongoose schema):
{ role: enum[customer,driver,admin,company], name, email (unique), phone,
  passwordHash, favorites: [ObjectId ref Driver], walletId: ObjectId, status,
  timestamps: true }

Create models/Driver.ts:
{ userId: ObjectId ref User, vehicleClass, status: enum[available,busy,offline],
  rating: number default 0, penaltyCount: number default 0, documents: [String] }

Create models/Company.ts:
{ userId: ObjectId ref User, driverIds: [ObjectId ref Driver],
  revenueSharePct: number default 60 }

Implement module modules/auth with routes/controller/service/validation:
- POST /auth/register — public. Body: { role, name, email, phone, password, ...
  role-specific fields }. If role === 'driver', also create a Driver doc and mark
  status as pending document upload. Hash password with bcrypt.
- POST /auth/login — public. Unified across all 4 roles. Returns JWT access +
  refresh token pair and the user's role.
- POST /auth/refresh — public, validates refresh token, issues new access token.
- POST /auth/logout — authGuard only. Blacklist the refresh token in Redis
  (store jti with TTL matching refresh token expiry).

Implement module modules/users with routes/controller/service:
- GET /users/me — authGuard only. Returns current user profile.
- PATCH /users/me — authGuard only. Update profile fields.
- POST /users/me/documents — authGuard + roleGuard('driver'). Accepts file upload
  metadata; call a stub uploadToS3() function in a new utils/s3.ts that just
  returns a fake URL for now (real S3 wiring is a placeholder, note this in a
  TODO comment).
- POST /users/me/favorites/:driverId — authGuard + roleGuard('customer'). Adds
  driverId to the user's favorites array (validate the driverId exists in Driver
  collection first).
- GET /users/me/favorites — authGuard + roleGuard('customer'). Populates and
  returns favorite drivers.
- DELETE /users/me/favorites/:driverId — authGuard + roleGuard('customer').

Wire both modules' routers into app.ts under /auth and /users.
Use zod schemas in each *.validation.ts file to validate request bodies before
they hit the controller.
```

---

## Prompt 2 — Booking & Pricing

```
Building on the existing viaro-backend project (auth/users already implemented),
add the pricing and booking modules. No dispatch or trip logic yet — bookings are
created but not yet assigned to a driver.

Create models/PricingRule.ts:
{ city, baseFare: number, peakMultiplier: number, timestamps: true }

Create models/Subscription.ts:
{ userId: ObjectId ref User, plan, status: enum[active,cancelled,expired],
  startDate, renewalDate }

Create models/Booking.ts:
{ customerId: ObjectId ref User, pickup: {lat,lng,address}, drop: {lat,lng,address},
  vehicleClass, tripType: enum[point2point,airport,hourly],
  flightDetails: { flightNumber, scheduledArrival } (optional, only for airport type),
  favoriteDriverId: ObjectId ref Driver (optional), status:
  enum[pending,dispatched,assigned,cancelled], scheduledAt: Date (stored and always
  displayed in America/Los_Angeles via the shared timezone util), createdAt }

Implement modules/pricing:
- POST /subscriptions — authGuard + roleGuard('customer'). Creates a Subscription.
- GET /subscriptions/me — authGuard + roleGuard('customer').
- DELETE /subscriptions/me — authGuard + roleGuard('customer'). Sets status cancelled.
- GET /pricing/fare-estimate — authGuard + roleGuard('customer'). Query params:
  city, tripType, requestedAt. Business rule: if the requesting customer has an
  active subscription, return the flat PricingRule.baseFare for that city. If not,
  return baseFare * peakMultiplier when requestedAt falls in a peak window (define
  a simple peak-hour check, e.g. 7-9am/5-7pm local PT time, in a shared
  pricing.service.ts function so it can be reused later for actual fare
  calculation, not duplicated).
- POST /admin/pricing/city — authGuard + roleGuard('admin'). Create a PricingRule.
- GET /admin/pricing/city — authGuard + roleGuard('admin'). List all.
- PATCH /admin/pricing/city/:id — authGuard + roleGuard('admin').

Implement modules/booking:
- POST /bookings — authGuard + roleGuard('customer'). Creates a Booking with
  status 'pending'. If tripType is 'airport', flightDetails is required. Stamp
  scheduledAt using the shared timezone util.
- GET /bookings/:id — authGuard + roleGuard('customer','admin','company') only —
  per the spec's RBAC matrix, drivers have NO direct booking access (marked ❌).
  Customers are owner-only (403 unless it's their own booking); admin/company
  can fetch any. Drivers instead get booking details (pickup/drop, etc.) via the
  populated Booking data already included on GET /trips/:id once they're
  assigned — do not add a driver path to this endpoint.
- PATCH /bookings/:id — authGuard + roleGuard('customer'), owner-only. Only
  allowed while status is 'pending' (pre-dispatch) — reject with 409 if already
  dispatched/assigned.
- POST /bookings/:id/favorite-driver — authGuard + roleGuard('customer'),
  owner-only. Sets favoriteDriverId on the booking IF that driver's status is
  'available' in the Driver collection; otherwise return a clear error indicating
  the favorite driver is busy so the client can fall back to normal dispatch.
- GET /users/me/rides — authGuard + roleGuard('customer'). Lists the customer's
  own bookings, most recent first.
- GET /users/me/rides/:id/receipt — authGuard + roleGuard('customer'), owner-only.
  Return a JSON receipt shape for now (PDF generation is a later concern, not this
  step) — { bookingId, fare, tripType, date, status }.

Wire routers into app.ts.
```

---

## Prompt 3 — Dispatch (Redis GEO + Socket.io)

```
Building on the existing viaro-backend project, implement the dispatch module.
This is where a 'pending' Booking gets turned into a driver assignment.

In config/redis.ts (already scaffolded), make sure the Redis client supports GEO
commands (ioredis does natively — just confirm usage).

On Driver, whenever a driver's Socket.io connection sends a location update (this
socket event itself will be built more fully in the trip/tracking step, but the
dispatch module needs to read driver positions now), maintain a Redis GEO set
keyed 'drivers:available' with driver location, only including drivers whose
status is 'available'.

Create modules/dispatch/dispatch.service.ts with three internal functions:
- receiveBookingRequest(bookingId): looks up the Booking, decides the assignment
  path.
- assignDriverToBooking(bookingId): if booking.favoriteDriverId is set AND that
  driver is currently 'available', assign directly to them (set booking.status =
  'assigned', create the Trip record — Trip model comes in the next step, so for
  now just stub a TODO comment here referencing that the next step wires this up).
  If no favorite driver or they're busy, fall through to publishToPublicPool.
- publishToPublicPool(bookingId): finds nearest available drivers via Redis
  GEOSEARCH from the booking's pickup lat/lng, sets booking.status = 'dispatched',
  and broadcasts the booking over the Socket.io '/dispatch' namespace to those
  drivers.

Wire receiveBookingRequest to fire automatically right after a Booking is created
in modules/booking/booking.service.ts (add the call there — this is the one
cross-module wiring point).

Create sockets/dispatch.socket.ts: sets up the '/dispatch' Socket.io namespace.
Drivers connect and authenticate via their JWT (reuse authGuard logic adapted for
socket handshake). Server emits 'booking:new' to eligible drivers. When a driver
emits 'booking:claimed' with a bookingId, the server should broadcast
'booking:claimed' to the other drivers in the pool so they know it's taken (actual
claim persistence happens in the Trip accept endpoint in the next step — this
socket layer is just the real-time broadcast, not the source of truth).

Add GET /admin/dispatch/pool — authGuard + roleGuard('admin'). Returns all
Bookings currently in 'dispatched' status, for ops visibility.

Attach the dispatch namespace to the Socket.io server instance exported from
server.ts.
```

---

## Prompt 4 — Trip Lifecycle, Penalty Job, Live Tracking

```
Building on the existing viaro-backend project, implement the trip module — this
is the core driver-facing flow plus live tracking.

Create models/Trip.ts:
{ bookingId: ObjectId ref Booking, driverId: ObjectId ref Driver, status:
  enum[accepted,started,completed,cancelled], fareAmount: number,
  timestamps: { requested, assigned, accepted, started, completed } (all Date,
  optional until reached), penaltyApplied: boolean default false,
  cancellation: { reason, refundPct, refundedAt } (optional, populated by the
  cancellation module later) }

Implement modules/trip routes/controller/service:
- POST /trips/:bookingId/accept — authGuard + roleGuard('driver'). Creates the
  Trip record (this is where the TODO from the dispatch step gets resolved),
  sets driver status to 'busy', sets timestamps.accepted, sets booking.status =
  'assigned'.
- GET /trips/:id — authGuard, all four roles, but with BOTH an ownership check
  AND response shaping, per the spec's RBAC matrix (customer: own, driver: own,
  admin/company: all):
  * if req.user.role === 'customer': 403 unless req.user.userId matches the
    linked booking's customerId.
  * if req.user.role === 'driver': 403 unless req.user.userId matches the
    trip's driverId.
  * admin/company: no ownership restriction.
  * separately from the ownership check, response shaping still applies: strip
    fareAmount when role is 'driver', strip the driver's real phone number from
    the populated driver info when role is 'customer' (masked placeholder like
    "Contact via app" instead), full unredacted response for admin/company.
  Build both the ownership check and the field-stripping as shared functions in
  trip.service.ts, not duplicated inline in the controller.
- POST /trips/:id/start — authGuard + roleGuard('driver'), owner-only (must be
  the assigned driver). Sets status 'started', timestamps.started.
- POST /trips/:id/complete — authGuard + roleGuard('driver'), owner-only. Sets
  status 'completed', timestamps.completed, sets driver status back to
  'available'. Add a TODO comment here noting this must trigger wallet credit +
  revenue split — that logic is built in the wallet step, just leave the call
  site stubbed for now.
- POST /trips/:id/cancel — authGuard + roleGuard('driver'), owner-only. Sets
  status 'cancelled'.
- PATCH /trips/:id/vehicle-class — authGuard + roleGuard('customer'), only the
  booking owner. Updates the linked Booking's vehicleClass while trip is not yet
  'started'.
- PATCH /trips/:id/location — authGuard + roleGuard('customer'), only the
  booking owner. Updates the linked Booking's pickup or drop while trip is not
  yet 'started'.
- POST /trips/:id/rate — authGuard + roleGuard('customer'), owner-only, only
  after status is 'completed'. Create a Rating doc (add models/Rating.ts:
  { tripId, customerId, driverId, score: number 1-5, comment }), and update the
  Driver's rating (simple running average).

Penalty job: create jobs/penalty.job.ts using BullMQ. When a Trip's booking is
published to the public pool (hook this from the dispatch step — add the enqueue
call in dispatch.service.ts's publishToPublicPool), schedule a delayed job for 2
minutes. If no driver has accepted by the time the job runs, set penaltyApplied
= true on the relevant driver-side tracking (since no Trip exists yet if nobody
accepted, log the penalty against the booking/driver pairing that was offered it —
use your judgment on exact shape, but the event must end up queryable by Admin
and Company later in the reports step).

Live tracking: create sockets/tracking.socket.ts. Namespace '/tracking/:tripId'.
Driver client emits 'location:update' with {lat,lng}; server re-broadcasts
'location:update' to any customer clients subscribed to that tripId room. Also
persist the latest location onto the Trip document (or a lightweight separate
collection if you prefer) so a REST fallback is possible later — your call, note
the choice in a comment.

Attach the tracking namespace to the Socket.io server instance.
```

---

## Prompt 5 — Wallet, Revenue Split, Cancellation & Refunds

```
Building on the existing viaro-backend project, implement the wallet and
cancellation modules together, since they share the refund-to-wallet path.

Create models/Wallet.ts:
{ ownerId: ObjectId, ownerType: enum[driver,customer], balance: number default 0 }

Create models/Transaction.ts:
{ walletId: ObjectId ref Wallet, type: enum[credit,debit,refund,withdrawal],
  amount: number, feeApplied: number default 0, meta: Object, createdAt }

Implement modules/wallet:
- applyRevenueSplit(tripId) — internal function in wallet.service.ts. On Trip
  completion (wire this into the TODO left in trip.service.ts's complete
  handler): looks up the trip's fareAmount, splits 60% to the Company's
  wallet and 40% to Admin's (use a single designated admin/platform wallet —
  note this assumption in a comment), and ALSO calls creditDriverWallet.
- creditDriverWallet(tripId) — internal. Credits the driver's wallet with their
  earned portion of the fare (define driver's cut explicitly — since the diagram
  only specifies the 60/40 Company/Admin split on revenue, treat driver earnings
  as a separate, clearly-commented business decision you're flagging as
  TBD-with-Anvar, not silently invented).
- POST /payments/collect — internal/system endpoint (not customer-facing;
  authGuard + roleGuard('admin','company') for now as a safe default), calls the
  paymentGateway.ts placeholder stub (just returns a fake success object for now,
  clearly marked PLACEHOLDER) to represent collecting the customer's payment,
  then creates a Transaction record.
- GET /wallet/me — authGuard, roleGuard('customer','driver'). Returns own wallet
  balance + transaction history.
- POST /wallet/withdraw — authGuard + roleGuard('driver'). Deducts requested
  amount from wallet, applies a 10% fee (feeApplied = amount * 0.10, net payout =
  amount - feeApplied), creates a Transaction of type 'withdrawal'. Keep this as
  a clearly separate code path from use-credit below — do not merge them.
- POST /wallet/use-credit — authGuard + roleGuard('customer'). Applies wallet
  balance toward a specified booking/trip's fare, NO fee applied, creates a
  Transaction of type 'debit' with feeApplied = 0.
- POST /payments/webhook — public route but must verify a signature header
  against PAYMENT_GATEWAY_WEBHOOK_SECRET (stub the verification logic, mark
  PLACEHOLDER, but still enforce the check exists so it's not accidentally left
  wide open).

Implement modules/cancellation:
- cancellationPolicy.evaluate(tripType, scheduledAt) — shared internal function
  in cancellation.service.ts. Uses the shared timezone util (America/Los_Angeles)
  to compute hours between now and scheduledAt. Rule: for tripType
  point2point or airport, if hoursUntilPickup >= 24, refundPct = 90, else 0. For
  tripType hourly, if hoursUntilPickup >= 72, refundPct = 90, else 0. This must
  be ONE function parameterized by tripType — do not write three separate
  near-duplicate functions.
- POST /trips/:id/cancel/point-to-point — authGuard + roleGuard('customer'),
  owner-only.
- POST /trips/:id/cancel/airport — authGuard + roleGuard('customer'), owner-only.
- POST /trips/:id/cancel/hourly — authGuard + roleGuard('customer'), owner-only.
  All three: look up the trip's linked booking's tripType, call
  cancellationPolicy.evaluate, set trip.status='cancelled',
  trip.cancellation={reason, refundPct, refundedAt: now}, and if refundPct > 0,
  call issueRefundToWallet.
- issueRefundToWallet(tripId, refundPct) — internal in cancellation.service.ts.
  Computes refund amount from the trip's fareAmount, credits the CUSTOMER's
  wallet (never the original payment method), creates a Transaction of type
  'refund'.

Double check: withdrawal fee (10%) and refund-to-wallet are two genuinely
different flows in the code — a refund credits the wallet with no fee at credit
time; the 10% only applies later, if and when the customer/driver withdraws that
balance out. Do not apply the fee at refund time.
```

---

## Prompt 6 — Notifications & Flight API Integration

```
Building on the existing viaro-backend project, implement the notifications and
flight modules.

Create models/Notification.ts:
{ userId: ObjectId ref User, type: String, payload: Object, read: Boolean
  default false, createdAt }

Implement modules/notifications:
- notify.send(userId, type, payload) — internal shared function in
  notifications.service.ts. Creates a Notification doc AND emits it over the
  '/notify/:userId' Socket.io namespace to that user if they're connected. This
  is the single fanout point — go back and wire calls to notify.send() from the
  key trip lifecycle events already built: booking created, driver assigned,
  trip started, trip completed, penalty applied, cancellation processed. Add
  these calls into the relevant existing services rather than duplicating logic.
- GET /notifications — authGuard. Lists the current user's own notifications.
- PATCH /notifications/:id/read — authGuard, owner-only. Marks read = true.

Also call the smsPush.ts placeholder stub from inside notify.send() (clearly
marked PLACEHOLDER — just log what would have been sent for now) so the delivery
channel call-site exists even though no real provider is wired yet.

Implement modules/flight:
- integrations/flightApi.ts — placeholder client with a single exported function
  fetchFlightDetails(flightNumber) that currently returns mock data shaped like
  { flightNumber, status, scheduledArrival, actualArrival }, clearly marked
  PLACEHOLDER, easy to swap for a real provider (aviationstack/flightaware) later
  by only changing this file.
- GET /flight/:flightNumber — authGuard, roles driver and admin. Calls
  fetchFlightDetails and returns the result.
- flight.showArrivalTimeToDriver(tripId) — internal function in
  flight.service.ts. Looks up the linked booking's flightDetails.flightNumber,
  calls fetchFlightDetails, and calls notify.send() to push the arrival time to
  the assigned driver. Wire a call to this into the trip accept flow (from step
  4) when the booking's tripType is 'airport' — add this call now that both
  pieces exist.

Confirm config/timezone.ts's shared helper is what's used anywhere a time is
displayed in a notification payload (e.g. arrival time, trip scheduled time) —
do not format dates ad hoc in the notification payload builder.
```

---

## Prompt 7 — Chat

```
Building on the existing viaro-backend project, implement the chat module.

Create models/ChatMessage.ts:
{ tripId: ObjectId ref Trip, senderId: ObjectId ref User, senderRole: String,
  message: String, createdAt }

Create sockets/chat.socket.ts: Socket.io namespace '/chat/:tripId'.
- customer and driver clients can connect if they are the customer/driver on
  that specific trip (verify via JWT + trip lookup on connection), and can both
  emit 'message:new' (persist to ChatMessage, then broadcast to the room) and
  receive 'message:new'.
- admin clients can connect to the same namespace/room in a READ-ONLY capacity —
  they should never be allowed to emit 'message:new', only receive it (this is
  the "Monitor Chats" requirement — enforce it server-side, not just by omitting
  a send button on a hypothetical client).

Add GET /trips/:id/chat/history — authGuard, roles customer/driver (must be a
participant on that trip) or admin (read access to any trip's history). Returns
persisted ChatMessage docs for the trip, oldest first.

Attach the chat namespace to the Socket.io server instance.
```

---

## Prompt 8 — Reports & Admin Dashboard

```
Building on the existing viaro-backend project, implement the reports and admin
modules. These are read-heavy, query the data already created by prior steps —
no new core write logic here.

Implement modules/reports:
- GET /reports/trips-completed — authGuard, roles driver/admin/company. If role
  is 'driver', scope query to trips where driverId === req.user's linked Driver
  doc. If admin/company, return all. Support ?from=&to= date filters (using the
  shared timezone util for the boundary comparisons).
- GET /reports/earnings-payout — same role scoping. Driver: their own wallet
  Transactions of type credit/withdrawal. Admin/company: aggregate revenue split
  transactions.
- GET /reports/cancellations-penalties — same role scoping. Pulls from Trip
  documents where status='cancelled' or penaltyApplied=true.
- GET /reports?from=&to=&format=csv|pdf — a generic export endpoint, same role
  scoping as above, that reuses whichever of the three queries the client
  requests via a `type` query param, and formats the result as CSV or a simple
  PDF (create jobs/reportExport.job.ts using BullMQ so large exports run async
  and the endpoint returns a job/download reference rather than blocking).

Implement modules/admin:
- POST /admin/drivers — authGuard + roleGuard('company'). Creates a Driver
  linked to a new or existing User with role 'driver', adds to the Company's
  driverIds.
- GET /admin/drivers — authGuard + roleGuard('company','admin'). Company sees
  only their own driverIds; admin sees all.
- PATCH /admin/drivers/:id — authGuard + roleGuard('company'), must be one of
  the company's own drivers.
- GET /admin/dashboard/bookings — authGuard + roleGuard('admin'). All bookings,
  paginated.
- GET /admin/dashboard/users — authGuard + roleGuard('admin'). All users,
  paginated.
- GET /admin/revenue/subscriptions — authGuard + roleGuard('admin','company').
  Aggregate active Subscription revenue by month.
- GET /admin/drivers/penalties — authGuard + roleGuard('admin','company').
  Lists drivers with penaltyCount > 0 and their related Trip penalty events.

Enforce the report-visibility rule explicitly with a code comment at the top of
reports.service.ts: driver sees own data only, admin/company see full/aggregate
— this is a named business rule from the spec, not an incidental default.
```

---

## Notes for using these

- Run them in order — several later prompts assume models/functions from earlier ones exist (e.g. step 4's penalty job hooks into step 3's dispatch service; step 5's wallet credit hooks into step 4's trip complete handler).
- Every **PLACEHOLDER** integration (flight API, payment gateway, SMS/push, S3) is intentionally stubbed with mock data so the whole system runs end-to-end locally before you've picked real providers. Swapping a provider later only touches the one file in `integrations/`.
- One thing flagged mid-spec that's a genuine open question, not just a placeholder: **driver earnings split** — the diagram only specifies the Company 60% / Admin 40% revenue split, not what percentage the driver themselves earns per trip. Step 5's prompt calls this out explicitly so it doesn't get silently invented — decide that number before or during that step.
