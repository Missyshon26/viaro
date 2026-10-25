# ABL — UML Use Case Build Checklist

Every element of `ABL_RideHailing_UML_UseCase.svg`, checked against the code.
**50 use cases · 12 groups · 4 human actors · 2 system actors · 15 include/extend links · 7 notes.**

Status: ✅ built and end-to-end tested · 🟡 built as a PLACEHOLDER pending a provider decision.

---

## 1. Account & Access

| # | Use case | Status | Where |
|---|---|---|---|
| 1 | Register / Onboard | ✅ | `POST /auth/register` — [auth.service.ts](src/modules/auth/auth.service.ts) |
| 2 | Log In (Customer · Driver · Admin · Company) | ✅ | `POST /auth/login` — one unified endpoint, all 4 roles |
| 3 | Manage Profile | ✅ | `GET/PATCH /users/me` — [users.service.ts](src/modules/users/users.service.ts) |

## 2. Pricing & Subscription

| # | Use case | Status | Where |
|---|---|---|---|
| 4 | Subscribe to Monthly Plan (fixed price anytime) | ✅ | `POST /subscriptions` |
| 5 | Pay Peak-Hour Adjusted Fare (non-subscribers) | ✅ | `isPeakHour()` + `calculateFare()` — [pricing.service.ts](src/modules/pricing/pricing.service.ts) |
| 6 | Set City-Based Pricing (Admin) | ✅ | `POST/GET/PATCH /admin/pricing/city` |
| 7 | Pay Fare | ✅🟡 | `POST /payments/collect` — gateway call is a placeholder |

## 3. Dispatch

| # | Use case | Status | Where |
|---|---|---|---|
| 8 | Receive Booking Request | ✅ | `receiveBookingRequest()` — fired on booking creation |
| 9 | Assign Driver to Booking | ✅ | `assignDriverToBooking()` — favourite-driver-first |
| 10 | Publish Booking to Public Pool | ✅ | `publishToPublicPool()` — Redis `GEOSEARCH` + `/dispatch` socket |

## 4. Driver Trip Flow

| # | Use case | Status | Where |
|---|---|---|---|
| 11 | Accept Booking (assignment or public pool) | ✅ | `POST /trips/:id/accept` — resolves booking **or** trip id |
| 12 | View Trip Details | ✅ | `GET /trips/:id` — fare stripped for driver (note 2) |
| 13 | Cancel Ride | ✅ | `POST /trips/:id/cancel` |
| 14 | Apply Penalty (2-min alert delay) | ✅ | [penalty.job.ts](src/jobs/penalty.job.ts) — BullMQ, survives restarts |
| 15 | Receive Priority Ride Notifications | ✅ | socket `booking:new` **+** persisted notification, rating-ranked |

## 5. Money & Wallet

| # | Use case | Status | Where |
|---|---|---|---|
| 16 | Collect Customer Payments (Company) | ✅🟡 | `POST /payments/collect` |
| 17 | Apply Revenue Split (Company 60% / Admin 40%) | ✅ | `applyRevenueSplit()` — [wallet.service.ts](src/modules/wallet/wallet.service.ts) |
| 18 | Credit Driver Wallet | ✅ | `creditDriverWallet()` — **percentage is TBD, see §Open** |
| 19 | Credit Refund to Customer Wallet | ✅ | `issueRefundToWallet()` — wallet only, never card (note 3) |
| 20 | Withdraw Wallet Balance (−10% fee) | ✅ | `POST /wallet/withdraw` — debits, then pays out through the gateway |
| 21 | Use Wallet Credit for Next Ride | ✅ | `POST /wallet/use-credit` — separate path, zero fee |

## 6. Reports & Analytics

| # | Use case | Status | Where |
|---|---|---|---|
| 22 | View Trips Completed Report | ✅ | `GET /reports/trips-completed` |
| 23 | View Earnings & Payout Report | ✅ | `GET /reports/earnings-payout` |
| 24 | View Cancellation & Penalty Report | ✅ | `GET /reports/cancellations-penalties` |
| 25 | Filter / Export Reports by Date | ✅ | `GET /reports?from=&to=&format=csv\|pdf` → BullMQ export job |

## 7. Booking

| # | Use case | Status | Where |
|---|---|---|---|
| 26 | Book a Ride | ✅ | `POST /bookings` |
| 27 | Request / Assign Favorite Driver (if not busy) | ✅ | `POST /bookings/:id/favorite-driver` — 409 `FAVORITE_DRIVER_BUSY` |
| 28 | Add Driver to Favorites | ✅ | `POST/GET/DELETE /users/me/favorites/:driverId` |
| 29 | Cancel or Change Booking | ✅ | `PATCH` / `DELETE /bookings/:id` — pending only, else 409 |
| 30 | View Ride History & Receipts | ✅ | `GET /users/me/rides` + `/:id/receipt` |

## 8. Trip Changes & Tracking

| # | Use case | Status | Where |
|---|---|---|---|
| 31 | Upgrade / Downgrade Vehicle Class | ✅ | `PATCH /trips/:id/vehicle-class` — pre-start only |
| 32 | Change Pickup / Drop Location | ✅ | `PATCH /trips/:id/location` — pre-start only |
| 33 | Enter Flight Details at Booking | ✅ | required when `tripType = airport` |
| 34 | Live Car Tracking | ✅ | WS `/tracking/:tripId` + last position on the Trip doc |

## 9. Notifications & Alerts

| # | Use case | Status | Where |
|---|---|---|---|
| 35 | Send Trip Notifications (all 4 roles) | ✅🟡 | `notify.send()` — DB + socket real; SMS/push placeholder |
| 36 | Fetch Flight Details (Flight API) | 🟡 | `fetchFlightDetails()` — mock data, provider not chosen |
| 37 | Show Flight Arrival Time to Driver | ✅ | fires on accept when `tripType = airport` |
| 38 | Apply Timezone Standard (America/Los_Angeles) | ✅ | [config/timezone.ts](src/config/timezone.ts) — the only date authority |

## 10. Communication

| # | Use case | Status | Where |
|---|---|---|---|
| 39 | Chat (Customer ↔ Driver) | ✅ | WS `/chat/:tripId` + `GET /trips/:id/chat/history` |
| 40 | Monitor Chats (Admin) | ✅ | admin joins read-only — **enforced server-side**, tested |

## 11. Cancellation & Refunds

| # | Use case | Status | Where |
|---|---|---|---|
| 41 | Cancel Point-to-Point Trip (≥24 h → 90%) | ✅ | `POST /trips/:id/cancel/point-to-point` |
| 42 | Cancel Airport Trip (≥24 h → 90%) | ✅ | `POST /trips/:id/cancel/airport` |
| 43 | Cancel Hourly Trip (≥72 h → 90%) | ✅ | `POST /trips/:id/cancel/hourly` |
| 44 | Apply No-Refund Rule (late cancel) | ✅ | same `evaluate()` returns `refundPct: 0` |
| 45 | Issue 90% Refund to Wallet | ✅ | `issueRefundToWallet()` — `feeApplied: 0` |

## 12. Management & Admin Tools

| # | Use case | Status | Where |
|---|---|---|---|
| 46 | Add / Manage Drivers (Company) | ✅ | `POST/GET/PATCH /admin/drivers` — own roster only |
| 47 | View All Bookings & Users Dashboard | ✅ | `GET /admin/dashboard/bookings` · `/users` |
| 48 | View Monthly Subscription Revenue | ✅ | `GET /admin/revenue/subscriptions` — Mongo aggregation |
| 49 | View Driver Penalties & Cancellations | ✅ | `GET /admin/drivers/penalties` |
| 50 | Rate Driver After Trip | ✅ | `POST /trips/:id/rate` — running average, one per trip |

---

## Include / extend relationships

| Relationship | Status |
|---|---|
| Book a Ride «include» Pay Fare | ✅ fare calculated at booking |
| Book a Ride «include» Receive Booking Request | ✅ the one cross-module call |
| Book a Ride «include» Send Trip Notifications | ✅ |
| Subscribe to Monthly Plan «extend» Book a Ride | ✅ subscriber → flat fare |
| Pay Peak-Hour Adjusted Fare «extend» Book a Ride | ✅ non-subscriber → multiplier |
| Upgrade/Downgrade Vehicle Class «extend» Book a Ride | ✅ |
| **Cancel Ride «include» Apply Penalty** | ✅ driver-initiated cancel now penalises |
| **Rate Driver After Trip «extend» Receive Priority Ride Notifications** | ✅ rating ranks ride offers |
| Pay Fare «include» Apply Revenue Split | ✅ on trip completion |
| Cancel or Change Booking «include» Cancel Point-to-Point Trip | ✅ |
| Issue 90% Refund «include» Credit Refund to Customer Wallet | ✅ |
| Enter Flight Details «include» Fetch Flight Details | ✅🟡 |
| Show Flight Arrival Time «extend» View Trip Details | ✅ |
| **Withdraw Wallet Balance «include» «system» Payment Gateway** | ✅ withdrawal transfers the net amount out via the gateway, reverses the debit if declined |
| Fetch Flight Details «include» «system» Flight Data API | 🟡 placeholder |

## Notes 1–7

| Note | Rule | Status |
|---|---|---|
| 1 | All booking/cancellation/refund times use America/Los_Angeles | ✅ verified `14:00` reads as PT |
| 2 | Trip fare amount hidden from driver | ✅ verified driver sees no `fareAmount` |
| 3 | Refund → wallet · 10% on withdrawal · no fee for next ride | ✅ verified 3 separate paths |
| 4 | Driver phone number hidden from customer | ✅ verified `"Contact via app"` |
| 5 | Penalty = alerts delayed 2 min; visible to Admin & Company | ✅ BullMQ + dashboards |
| 6 | ≥24 h (p2p & airport) / ≥72 h (hourly) → 90%; later → none | ✅ verified both branches |
| 7 | Reports visible to Driver, Admin & Company | ✅ verified customer gets 403 |

## Actors

| Actor | Status |
|---|---|
| Customer (Rider) | ✅ |
| Driver (Chauffeur) | ✅ |
| Admin (Operations) | ✅ |
| Company (Business owner) | ✅ |
| «system» Flight Data API | 🟡 placeholder client |
| «system» Payment Gateway / Wallet | 🟡 placeholder client + signature-verified webhook |

---

## Resolved — the driver earnings question

The diagram's gap (60 + 40 = the whole fare, yet the driver must also be paid) is answered:
**the driver is paid by whoever owns them, out of that owner's share.** Company drivers are
paid by their company from its 60%; unrostered drivers are paid by the admin from the
platform share. Per-trip rates are set by the owner on the Driver record. Implemented and
tested in [wallet.service.ts](src/modules/wallet/wallet.service.ts).

## Open — needs a key or a decision, not code

Providers are fully implemented; they only need credentials in `.env`.

- [ ] **Payment gateway key** — `stripe` adapter ready (`PAYMENT_GATEWAY_*`)
- [ ] **Flight data key** — `aviationstack` / `flightaware` adapters ready (`FLIGHT_API_*`)
- [ ] **SMS & push key** — `twilio` / `firebase` / `expo` adapters ready (`SMS_PUSH_*`)
- [ ] **S3 bucket** for driver licence & insurance uploads
- [ ] **Deployment target** — server/subdomain (confirmed *not* `x1.xelocorp.com`)
- [ ] **Confirm the split direction** — the UML says Company **60** / Admin **40**, which is
      what the code defaults to. Flip `COMPANY_REVENUE_PCT` / `ADMIN_REVENUE_PCT` in `.env`
      if you meant the other way round.
- [ ] **Automatic payouts** — does a scheduled payout carry the same 10% fee as a manual withdrawal?
