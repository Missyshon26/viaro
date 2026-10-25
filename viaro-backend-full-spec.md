# ABL Backend — Full Build Spec

Rechecked against `ABL_RideHailing_UML_UseCase.svg` end-to-end: 4 human actors, 2 system actors, 12 use-case groups, all `<<include>>`/`<<extend>>` links, and all 7 UML notes. This is the complete spec to start building from — one backend, role-based, no per-actor folder split (per earlier discussion). Any endpoint the diagram implies but doesn't fully specify (payment gateway, flight API, SMS/push) is marked **PLACEHOLDER** — build the route now, wire the real provider later.

---

## 1. Stack

- Node.js + TypeScript + Express
- MongoDB + Mongoose
- Redis (driver geolocation, BullMQ queue backend, session/token blacklist)
- Socket.io (dispatch, live tracking, chat, notifications)
- BullMQ (penalty timer, cancellation-window checks, scheduled payouts, report generation)
- JWT (access + refresh), bcrypt
- Deployment: your existing aaPanel + Git auto-deploy VPS flow — **note: not `x1.xelocorp.com`, that's a different project's box; this needs its own subdomain/server decided separately**

---

## 2. Roles & RBAC matrix

| Endpoint group | customer | driver | admin | company |
|---|---|---|---|---|
| Booking | ✅ own | ❌ | 👁 read all | 👁 read all |
| Trip lifecycle | 👁 own | ✅ own | 👁 all | 👁 all |
| Pricing (set) | ❌ | ❌ | ✅ | ❌ |
| Wallet | ✅ own | ✅ own | 👁 all | 👁 all |
| Chat | ✅ own trip | ✅ own trip | 👁 monitor only | ❌ |
| Reports | ❌ | 👁 own only | ✅ full | ✅ full |
| Driver management | ❌ | ❌ | 👁 | ✅ |
| Revenue split view | ❌ | ❌ | ✅ | ✅ |

Enforced via `authGuard` (JWT verify) + `roleGuard(...roles)` middleware on every route below.

---

## 3. Project Structure

```
viaro-backend/
├── src/
│   ├── config/          # db, redis, env, timezone (fixed: America/Los_Angeles)
│   ├── middlewares/      # authGuard, roleGuard, errorHandler, rateLimiter
│   ├── models/            # Mongoose schemas — §6
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── pricing/
│   │   ├── booking/
│   │   ├── dispatch/
│   │   ├── trip/
│   │   ├── cancellation/
│   │   ├── wallet/
│   │   ├── notifications/
│   │   ├── chat/
│   │   ├── reports/
│   │   ├── admin/
│   │   └── flight/
│   ├── sockets/           # dispatch.socket.ts, tracking.socket.ts, chat.socket.ts, notify.socket.ts
│   ├── jobs/              # penalty.job.ts, cancellationWindow.job.ts, payout.job.ts, reportExport.job.ts
│   ├── integrations/
│   │   ├── flightApi.ts        # PLACEHOLDER provider
│   │   ├── paymentGateway.ts   # PLACEHOLDER provider
│   │   └── smsPush.ts          # PLACEHOLDER provider (not in diagram explicitly, but "Send Trip Notifications" implies it)
│   ├── utils/
│   ├── app.ts
│   └── server.ts
├── .env.example
├── package.json
└── tsconfig.json
```

Each module: `*.routes.ts`, `*.controller.ts`, `*.service.ts`, `*.validation.ts`.

---

## 4. Full API Endpoint List

### 4.1 Auth & Access (module: `auth`, `users`)
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | body includes `role`; driver role triggers doc upload flow |
| POST | `/auth/login` | public | unified login for all 4 roles |
| POST | `/auth/refresh` | public (refresh token) | |
| POST | `/auth/logout` | authenticated | blacklist refresh token in Redis |
| GET | `/users/me` | authenticated | |
| PATCH | `/users/me` | authenticated | Manage Profile |
| POST | `/users/me/documents` | driver | license/insurance upload — **PLACEHOLDER** S3 integration |
| POST | `/users/me/favorites/:driverId` | customer | Add Driver to Favorites |
| GET | `/users/me/favorites` | customer | |
| DELETE | `/users/me/favorites/:driverId` | customer | |

### 4.2 Pricing & Subscription (module: `pricing`)
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/subscriptions` | customer | Subscribe to Monthly Plan |
| GET | `/subscriptions/me` | customer | |
| DELETE | `/subscriptions/me` | customer | cancel subscription |
| GET | `/pricing/fare-estimate` | customer | branches: subscriber flat rate vs peak-hour adjusted |
| POST | `/admin/pricing/city` | admin | Set City-Based Pricing |
| GET | `/admin/pricing/city` | admin | list all city pricing rules |
| PATCH | `/admin/pricing/city/:id` | admin | |

### 4.3 Booking (module: `booking`)
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/bookings` | customer | Book a Ride; includes flight details (if airport) + timezone stamp |
| GET | `/bookings/:id` | customer/driver/admin/company | scoped |
| PATCH | `/bookings/:id` | customer | Cancel or Change Booking (pre-dispatch) |
| POST | `/bookings/:id/favorite-driver` | customer | Request/Assign Favorite Driver (if not busy) — `<<extend>>` |
| GET | `/users/me/rides` | customer | View Ride History & Receipts |
| GET | `/users/me/rides/:id/receipt` | customer | PDF/JSON receipt |

### 4.4 Dispatch (module: `dispatch`) — mostly internal + socket
| Method | Path | Role | Notes |
|---|---|---|---|
| — | `dispatch.receiveBookingRequest()` | internal | triggered post-booking |
| — | `dispatch.assignDriverToBooking()` | internal | favorite-driver-first, else nearest via Redis GEO |
| — | `dispatch.publishToPublicPool()` | internal | broadcast over `/dispatch` socket namespace |
| WS | `/dispatch` (socket) | driver | subscribe to pool broadcasts |
| GET | `/admin/dispatch/pool` | admin | current unassigned bookings — debugging/ops visibility |

### 4.5 Driver Trip Flow + Trip Changes & Tracking (module: `trip`)
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/trips/:id/accept` | driver | from assignment or public pool |
| GET | `/trips/:id` | customer/driver/admin/company | **fareAmount stripped for driver**, **driver phone stripped for customer** |
| POST | `/trips/:id/start` | driver | |
| POST | `/trips/:id/complete` | driver | triggers wallet credit + revenue split |
| POST | `/trips/:id/cancel` | driver | driver-side cancel |
| PATCH | `/trips/:id/vehicle-class` | customer | Upgrade/Downgrade Vehicle Class |
| PATCH | `/trips/:id/location` | customer | Change Pickup/Drop Location |
| WS | `/tracking/:tripId` (socket) | driver emits, customer subscribes | Live Car Tracking |
| POST | `/trips/:id/rate` | customer | Rate Driver After Trip |
| — | penalty job (BullMQ) | internal | fires if driver doesn't respond within 2-min window |

### 4.6 Cancellation & Refunds (module: `cancellation`)
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/trips/:id/cancel/point-to-point` | customer | ≥24h → 90% refund |
| POST | `/trips/:id/cancel/airport` | customer | ≥24h → 90% refund |
| POST | `/trips/:id/cancel/hourly` | customer | ≥72h → 90% refund |
| — | `cancellationPolicy.evaluate()` | internal | shared policy fn — time delta vs threshold per trip type, PT timezone |
| — | `issueRefundToWallet()` | internal | always wallet, never original payment method |

### 4.7 Money & Wallet (module: `wallet`)
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/payments/collect` | system (post-trip) | Collect Customer Payments — **PLACEHOLDER** payment gateway call |
| — | `applyRevenueSplit()` | internal | Company 60% / Admin 40%, on every completed trip |
| GET | `/wallet/me` | customer/driver | balance + transaction history |
| POST | `/wallet/withdraw` | driver | −10% fee applied |
| POST | `/wallet/use-credit` | customer | apply wallet credit to next ride, no fee |
| POST | `/payments/webhook` | public (signature-verified) | **PLACEHOLDER** payment gateway webhook receiver |

### 4.8 Notifications & Alerts (module: `notifications`, `flight`)
| Method | Path | Role | Notes |
|---|---|---|---|
| — | `notify.send()` | internal | fanout on trip events to relevant roles |
| GET | `/notifications` | authenticated | list own |
| PATCH | `/notifications/:id/read` | authenticated | |
| GET | `/flight/:flightNumber` | internal/driver | Fetch Flight Details — **PLACEHOLDER** flight API provider (e.g. AviationStack/FlightAware — pick one) |
| — | `flight.showArrivalTimeToDriver()` | internal | pushes to driver via notify.send |
| — | `applyTimezoneStandard()` | internal util | shared across booking/cancellation/notifications |
| — | `sms/push.send()` | internal | **PLACEHOLDER** — diagram implies delivery channel but doesn't name provider (Twilio/FCM typical choice) |

### 4.9 Communication (module: `chat`)
| Method | Path | Role | Notes |
|---|---|---|---|
| WS | `/chat/:tripId` (socket) | customer, driver | scoped to active trip room |
| WS | `/chat/:tripId` (subscribe, read-only) | admin | Monitor Chats |
| GET | `/trips/:id/chat/history` | customer/driver/admin | persisted message log |

### 4.10 Reports & Analytics (module: `reports`)
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/reports/trips-completed` | driver (own)/admin/company (all) | |
| GET | `/reports/earnings-payout` | driver (own)/admin/company (all) | |
| GET | `/reports/cancellations-penalties` | driver (own)/admin/company (all) | |
| GET | `/reports?from=&to=&format=csv\|pdf` | driver/admin/company | Filter/Export by Date |

### 4.11 Management & Admin Tools (module: `admin`)
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/admin/drivers` | company | Add/Manage Drivers |
| GET | `/admin/drivers` | company/admin | |
| PATCH | `/admin/drivers/:id` | company | |
| GET | `/admin/dashboard/bookings` | admin | View All Bookings & Users |
| GET | `/admin/dashboard/users` | admin | |
| GET | `/admin/revenue/subscriptions` | admin/company | View Monthly Subscription Revenue |
| GET | `/admin/drivers/penalties` | admin/company | View Driver Penalties & Cancellations |

---

## 5. Socket.io Namespaces

| Namespace | Purpose | Emits |
|---|---|---|
| `/dispatch` | new bookings broadcast to eligible drivers | `booking:new`, `booking:claimed` |
| `/tracking/:tripId` | live location | `location:update` |
| `/chat/:tripId` | trip chat | `message:new` |
| `/notify/:userId` | personal notification feed | `notification:new` |

---

## 6. Core Data Models

```
User            { role, name, email, phone, passwordHash, favorites[], walletId, status }
Driver          { userId, vehicleClass, status(available|busy|offline), rating, penaltyCount, documents[] }
Company         { userId, driverIds[], revenueSharePct: 60 }
Wallet          { ownerId, ownerType(driver|customer), balance, transactions[] }
Transaction     { walletId, type(credit|debit|refund|withdrawal), amount, feeApplied, meta, createdAt }
Subscription    { userId, plan, status, startDate, renewalDate }
PricingRule     { city, baseFare, peakMultiplier }
Booking         { customerId, pickup, drop, vehicleClass, tripType(point2point|airport|hourly),
                  flightDetails?, favoriteDriverId?, status, scheduledAt(PT) }
Trip            { bookingId, driverId, status, fareAmount, timestamps{requested,assigned,accepted,started,completed},
                  penaltyApplied, cancellation{ reason, refundPct, refundedAt } }
ChatMessage     { tripId, senderId, senderRole, message, createdAt }
Notification    { userId, type, payload, read, createdAt }
Rating          { tripId, customerId, driverId, score, comment }
```

---

## 7. Environment Variables (`.env.example`)

```
PORT=5000
MONGO_URI=
REDIS_URL=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

# PLACEHOLDER — fill in once provider is chosen
FLIGHT_API_PROVIDER=            # e.g. aviationstack | flightaware
FLIGHT_API_KEY=

PAYMENT_GATEWAY_PROVIDER=       # e.g. stripe | checkout.com | tap
PAYMENT_GATEWAY_SECRET_KEY=
PAYMENT_GATEWAY_WEBHOOK_SECRET=

SMS_PUSH_PROVIDER=              # e.g. twilio | firebase
SMS_PUSH_API_KEY=

S3_BUCKET=                      # driver document uploads
S3_ACCESS_KEY=
S3_SECRET_KEY=

APP_TIMEZONE=America/Los_Angeles
```

---

## 8. Hard-coded Business Rules (diagram notes 1–7)

1. Every time comparison (booking, cancellation, refund) uses `America/Los_Angeles` — one shared util, never raw `new Date()`.
2. `Trip` responses strip `fareAmount` for role `driver`.
3. Refunds always credit wallet, never original payment method. 10% fee applies only on withdrawal; 0% when reused for next ride — two separate code paths.
4. `Trip`/`Booking` responses strip driver's real phone from customer payloads — use masked number or in-app chat.
5. Penalty = driver's ride alerts delayed 2 minutes; event visible on Admin & Company dashboards.
6. Refund thresholds: point-to-point & airport ≥24h → 90%; hourly ≥72h → 90%; below → no refund. One shared policy function parameterized by trip type.
7. Reports scoped by role: driver sees own only; admin/company see full/aggregate.

---

## 9. Build Order

1. Auth + Users + RBAC middleware
2. Booking + Pricing (no dispatch yet)
3. Dispatch + Socket.io wiring
4. Trip lifecycle + penalty job + live tracking
5. Wallet + revenue split + cancellation/refund policy engine
6. Notifications + Flight API integration (placeholder provider first, swap later)
7. Chat
8. Reports + Admin dashboard
9. Rating

---

## 10. Open Decisions Before Coding Starts

- Which Payment Gateway provider (affects `paymentGateway.ts` and webhook shape)
- Which Flight Data API provider (affects `flightApi.ts` request/response shape)
- Which SMS/push provider for notification delivery
- Hosting: confirmed **not** `x1.xelocorp.com` — need the actual target server/subdomain before deployment config is written

Everything else in this doc is buildable now without those answers — the placeholders keep the routes and service boundaries in place so swapping a provider later is a one-file change, not a refactor.
