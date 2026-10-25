/* eslint-disable */
/**
 * Generates the Postman collection + environment for the ABL API.
 *
 *   npm run postman:generate
 *
 * The collection is a RUNNABLE FLOW, not just a list of endpoints: requests are ordered so
 * each one sets up the next (login -> token -> booking -> trip -> wallet), and every
 * request carries assertions. That means it works both for clicking around in Postman and
 * for `npm run test:api` (Newman) in CI.
 *
 * Log in with the seeded accounts — run `npm run seed` first.
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '..', 'postman');
const SEED_PASSWORD = 'Passw0rd!23';

/* ----------------------------------- helpers ------------------------------ */

const url = (p, query) => {
  const clean = p.replace(/^\//, '');
  const item = {
    raw: `{{baseUrl}}/${clean}${query ? '?' + query.map((q) => `${q.key}=${q.value}`).join('&') : ''}`,
    host: ['{{baseUrl}}'],
    path: clean.split('/').filter(Boolean),
  };
  if (query) item.query = query;
  return item;
};

/**
 * @param name    request label
 * @param method  HTTP verb
 * @param p       path after baseUrl
 * @param o.token variable name holding the bearer token
 * @param o.body  request body object
 * @param o.query array of {key,value}
 * @param o.tests array of javascript lines run as Postman tests
 */
const req = (name, method, p, o = {}) => {
  const header = [];
  if (o.body) header.push({ key: 'Content-Type', value: 'application/json' });
  if (o.token) header.push({ key: 'Authorization', value: `Bearer {{${o.token}}}` });
  if (o.headers) header.push(...o.headers);

  const request = { method, header, url: url(p, o.query) };
  if (o.body) {
    request.body = {
      mode: 'raw',
      raw: JSON.stringify(o.body, null, 2),
      options: { raw: { language: 'json' } },
    };
  }

  const item = { name, request };
  if (o.tests) {
    item.event = [{ listen: 'test', script: { type: 'text/javascript', exec: o.tests } }];
  }
  return item;
};

const folder = (name, items) => ({ name, item: items });

/**
 * Dispatch runs asynchronously after a booking is created (booking.service fires it
 * without awaiting, so a slow dispatch can never fail the customer's request). A driver
 * therefore cannot accept the instant the booking returns — in production they accept
 * from the socket broadcast, which only happens once dispatch has run.
 *
 * This request polls the booking until dispatch has picked it up, re-running itself via
 * setNextRequest. Without it the next request races and gets a 409.
 */
const waitForDispatch = (name, bookingVar, tokenVar) =>
  req(name, 'GET', `/bookings/{{${bookingVar}}}`, {
    token: tokenVar,
    tests: [
      'const status = pm.response.json().data.status;',
      'const tries = Number(pm.collectionVariables.get("dispatchTries") || 0);',
      'if (status === "dispatched" || status === "assigned") {',
      '  pm.collectionVariables.set("dispatchTries", 0);',
      '  pm.test("booking reached dispatch", () => pm.expect(["dispatched","assigned"]).to.include(status));',
      '} else if (tries < 12) {',
      '  pm.collectionVariables.set("dispatchTries", tries + 1);',
      `  postman.setNextRequest("${name}");`,
      '} else {',
      '  pm.test("booking reached dispatch", () => pm.expect.fail("still " + status + " after 12 polls"));',
      '}',
    ],
  });

// Common assertion snippets
const ok = (code = 200) => [
  `pm.test("status ${code}", () => pm.response.to.have.status(${code}));`,
  'pm.test("envelope has success:true", () => pm.expect(pm.response.json().success).to.eql(true));',
];
const denied = (code, why) => [
  `pm.test("${why} -> ${code}", () => pm.response.to.have.status(${code}));`,
  'pm.test("error envelope", () => pm.expect(pm.response.json().success).to.eql(false));',
];
const save = (varName, jsonPath) => `pm.collectionVariables.set("${varName}", pm.response.json()${jsonPath});`;

/* ------------------------------- collection ------------------------------- */

const collection = {
  info: {
    name: 'ABL Backend — Full API',
    description:
      'Complete ABL API: auth, users, pricing, booking, dispatch, trip lifecycle, ' +
      'cancellation & refunds, wallet, notifications, flight, chat, reports and admin.\n\n' +
      '**Run `npm run seed` first** — the seeded accounts all use the password `' + SEED_PASSWORD + '`.\n\n' +
      'Requests are ordered as a working flow, so "Run collection" exercises the whole system ' +
      'end to end. Every request asserts its result.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [],
  variable: [
    { key: 'baseUrl', value: 'http://localhost:5000' },
    { key: 'seedPassword', value: SEED_PASSWORD },
    ...['adminToken', 'companyToken', 'customerToken', 'customer2Token', 'driverToken', 'fleetDriverToken',
      'customerRefresh', 'customerUserId', 'driverId', 'fleetDriverId', 'bookingId', 'tripId',
      'cancelBookingId', 'cancelTripId', 'notificationId', 'exportJobId', 'newDriverId', 'testCity',
    ].map((key) => ({ key, value: '' })),
  ],
};

/* 00 — health + logins ----------------------------------------------------- */

collection.item.push(
  folder('00 · Setup (run first)', [
    req('Health check', 'GET', '/health', {
      tests: [
        ...ok(),
        'pm.test("runs in America/Los_Angeles", () => pm.expect(pm.response.json().timezone).to.eql("America/Los_Angeles"));',
        'pm.collectionVariables.set("testCity", "los angeles");',
      ],
    }),
    req('Login — admin', 'POST', '/auth/login', {
      body: { email: 'admin@abl.test', password: '{{seedPassword}}' },
      tests: [...ok(), 'pm.test("role is admin", () => pm.expect(pm.response.json().data.role).to.eql("admin"));', save('adminToken', '.data.accessToken')],
    }),
    req('Login — company', 'POST', '/auth/login', {
      body: { email: 'company@abl.test', password: '{{seedPassword}}' },
      tests: [...ok(), save('companyToken', '.data.accessToken')],
    }),
    req('Login — customer', 'POST', '/auth/login', {
      body: { email: 'customer1@abl.test', password: '{{seedPassword}}' },
      tests: [
        ...ok(),
        save('customerToken', '.data.accessToken'),
        save('customerRefresh', '.data.refreshToken'),
        save('customerUserId', '.data.user._id'),
      ],
    }),
    req('Login — customer 2 (subscriber)', 'POST', '/auth/login', {
      body: { email: 'customer2@abl.test', password: '{{seedPassword}}' },
      tests: [...ok(), save('customer2Token', '.data.accessToken')],
    }),
    req('Login — platform driver', 'POST', '/auth/login', {
      body: { email: 'driver.platform@abl.test', password: '{{seedPassword}}' },
      tests: [...ok(), save('driverToken', '.data.accessToken')],
    }),
    req('Login — company driver', 'POST', '/auth/login', {
      body: { email: 'driver.company@abl.test', password: '{{seedPassword}}' },
      tests: [...ok(), save('fleetDriverToken', '.data.accessToken')],
    }),
  ]),
);

/* 01 — auth ---------------------------------------------------------------- */

collection.item.push(
  folder('01 · Auth', [
    req('Register — new customer', 'POST', '/auth/register', {
      body: {
        role: 'customer',
        name: 'Postman Customer',
        email: '{{$randomExampleEmail}}',
        phone: '+1555{{$randomInt}}',
        password: 'Passw0rd!23',
      },
      tests: [...ok(201), 'pm.test("returns a token pair", () => { const d = pm.response.json().data; pm.expect(d.accessToken).to.be.a("string"); pm.expect(d.refreshToken).to.be.a("string"); });'],
    }),
    req('Register — driver requires vehicleClass', 'POST', '/auth/register', {
      body: { role: 'driver', name: 'No Vehicle', email: '{{$randomExampleEmail}}', phone: '+15551110000', password: 'Passw0rd!23' },
      tests: denied(400, 'missing vehicleClass'),
    }),
    req('Register — duplicate email rejected', 'POST', '/auth/register', {
      body: { role: 'customer', name: 'Dup', email: 'customer1@abl.test', phone: '+15551110001', password: 'Passw0rd!23' },
      tests: denied(409, 'email already exists'),
    }),
    req('Login — wrong password', 'POST', '/auth/login', {
      body: { email: 'customer1@abl.test', password: 'wrong-password' },
      tests: denied(401, 'bad credentials'),
    }),
    req('Refresh access token', 'POST', '/auth/refresh', {
      body: { refreshToken: '{{customerRefresh}}' },
      tests: [...ok(), 'pm.test("new access token issued", () => pm.expect(pm.response.json().data.accessToken).to.be.a("string"));'],
    }),
    req('Logout (blacklists refresh token)', 'POST', '/auth/logout', {
      token: 'customerToken',
      body: { refreshToken: '{{customerRefresh}}' },
      tests: ok(),
    }),
    req('Refresh after logout is rejected', 'POST', '/auth/refresh', {
      body: { refreshToken: '{{customerRefresh}}' },
      tests: denied(401, 'revoked refresh token'),
    }),
    req('Login again (restore session)', 'POST', '/auth/login', {
      body: { email: 'customer1@abl.test', password: '{{seedPassword}}' },
      tests: [...ok(), save('customerToken', '.data.accessToken'), save('customerRefresh', '.data.refreshToken')],
    }),
    req('No token is rejected', 'GET', '/users/me', { tests: denied(401, 'missing bearer token') }),
  ]),
);

/* 02 — users --------------------------------------------------------------- */

collection.item.push(
  folder('02 · Users & Profile', [
    req('Get my profile', 'GET', '/users/me', {
      token: 'customerToken',
      tests: [...ok(), 'pm.test("password hash never leaves the server", () => pm.expect(pm.response.json().data.passwordHash).to.be.undefined);'],
    }),
    req('Update my profile', 'PATCH', '/users/me', {
      token: 'customerToken',
      body: { name: 'Carla Customer (updated)', phone: '+15550100055' },
      tests: [...ok(), 'pm.test("name updated", () => pm.expect(pm.response.json().data.name).to.include("updated"));'],
    }),
    req('Driver profile includes driver record', 'GET', '/users/me', {
      token: 'driverToken',
      tests: [...ok(), 'pm.test("driver sub-document present", () => pm.expect(pm.response.json().data.driver).to.be.an("object"));', save('driverId', '.data.driver._id')],
    }),
    req('Upload driver document (S3 stub)', 'POST', '/users/me/documents', {
      token: 'driverToken',
      body: { fileName: 'licence.jpg', mimeType: 'image/jpeg', sizeBytes: 240000 },
      tests: [...ok(201), 'pm.test("document stored", () => pm.expect(pm.response.json().data.documents).to.be.an("array").that.is.not.empty);'],
    }),
    req('Customer cannot upload driver documents', 'POST', '/users/me/documents', {
      token: 'customerToken',
      body: { fileName: 'x.jpg', mimeType: 'image/jpeg' },
      tests: denied(403, 'role not permitted'),
    }),
    req('Add favourite driver', 'POST', '/users/me/favorites/{{driverId}}', {
      token: 'customerToken',
      tests: ok(201),
    }),
    req('List favourite drivers', 'GET', '/users/me/favorites', {
      token: 'customerToken',
      tests: [...ok(), 'pm.test("favourites returned", () => pm.expect(pm.response.json().data).to.be.an("array"));'],
    }),
    req('Remove favourite driver', 'DELETE', '/users/me/favorites/{{driverId}}', {
      token: 'customerToken',
      tests: ok(),
    }),
  ]),
);

/* 03 — pricing ------------------------------------------------------------- */

collection.item.push(
  folder('03 · Pricing & Subscription', [
    req('Admin: list city pricing', 'GET', '/admin/pricing/city', {
      token: 'adminToken',
      tests: [...ok(), 'pm.test("rules returned", () => pm.expect(pm.response.json().data).to.be.an("array"));'],
    }),
    req('Admin: create city pricing', 'POST', '/admin/pricing/city', {
      token: 'adminToken',
      body: { city: 'san diego', baseFare: 80, peakMultiplier: 1.5 },
      tests: ['pm.test("created or already exists", () => pm.expect([201, 409]).to.include(pm.response.code));'],
    }),
    req('Customer cannot set pricing', 'POST', '/admin/pricing/city', {
      token: 'customerToken',
      body: { city: 'nope', baseFare: 1, peakMultiplier: 1 },
      tests: denied(403, 'admin only'),
    }),
    req('Fare estimate — off-peak (12:00 PT)', 'GET', '/pricing/fare-estimate', {
      token: 'customerToken',
      query: [{ key: 'city', value: '{{testCity}}' }, { key: 'tripType', value: 'point2point' }, { key: 'requestedAt', value: '2026-09-10T12:00' }],
      tests: [...ok(), 'pm.test("base fare, no peak", () => { const d = pm.response.json().data; pm.expect(d.isPeak).to.eql(false); pm.expect(d.fare).to.eql(100); });'],
    }),
    req('Fare estimate — peak (08:00 PT)', 'GET', '/pricing/fare-estimate', {
      token: 'customerToken',
      query: [{ key: 'city', value: '{{testCity}}' }, { key: 'tripType', value: 'point2point' }, { key: 'requestedAt', value: '2026-09-10T08:00' }],
      tests: [...ok(), 'pm.test("peak multiplier applied", () => { const d = pm.response.json().data; pm.expect(d.isPeak).to.eql(true); pm.expect(d.fare).to.eql(200); });'],
    }),
    req('Fare estimate — subscriber pays flat rate in peak', 'GET', '/pricing/fare-estimate', {
      token: 'customer2Token',
      query: [{ key: 'city', value: '{{testCity}}' }, { key: 'tripType', value: 'point2point' }, { key: 'requestedAt', value: '2026-09-10T08:00' }],
      tests: [...ok(), 'pm.test("subscriber avoids the uplift", () => { const d = pm.response.json().data; pm.expect(d.subscriber).to.eql(true); pm.expect(d.fare).to.eql(100); });'],
    }),
    req('My subscription', 'GET', '/subscriptions/me', {
      token: 'customer2Token',
      tests: [...ok(), 'pm.test("active plan", () => pm.expect(pm.response.json().data.status).to.eql("active"));'],
    }),
    req('Subscribe (customer 1)', 'POST', '/subscriptions', {
      token: 'customerToken',
      body: { plan: 'monthly', price: 49.99 },
      tests: ['pm.test("created or already subscribed", () => pm.expect([201, 409]).to.include(pm.response.code));'],
    }),
    req('Cancel subscription', 'DELETE', '/subscriptions/me', {
      token: 'customerToken',
      tests: [...ok(), 'pm.test("status cancelled", () => pm.expect(pm.response.json().data.status).to.eql("cancelled"));'],
    }),
  ]),
);

/* 04 — booking ------------------------------------------------------------- */

collection.item.push(
  folder('04 · Booking (CRUD)', [
    req('CREATE booking', 'POST', '/bookings', {
      token: 'customerToken',
      body: {
        pickup: { lat: 34.0522, lng: -118.2437, address: '500 S Main St, Los Angeles' },
        drop: { lat: 33.9416, lng: -118.4085, address: 'LAX Terminal 4' },
        vehicleClass: 'sedan',
        tripType: 'point2point',
        city: '{{testCity}}',
        scheduledAt: '2026-12-24T15:00',
      },
      tests: [...ok(201), 'pm.test("fare quoted", () => pm.expect(pm.response.json().data.fareBreakdown.fare).to.be.a("number"));', save('bookingId', '.data.booking._id')],
    }),
    req('Airport booking requires flight details', 'POST', '/bookings', {
      token: 'customerToken',
      body: {
        pickup: { lat: 34.05, lng: -118.24, address: 'Somewhere in LA' },
        drop: { lat: 33.94, lng: -118.4, address: 'LAX' },
        vehicleClass: 'sedan', tripType: 'airport', city: '{{testCity}}',
      },
      tests: denied(400, 'flightDetails missing'),
    }),
    req('READ booking (owner)', 'GET', '/bookings/{{bookingId}}', {
      token: 'customerToken',
      tests: [...ok(), 'pm.test("returns the booking", () => pm.expect(pm.response.json().data._id).to.eql(pm.collectionVariables.get("bookingId")));'],
    }),
    req('READ booking (admin sees any)', 'GET', '/bookings/{{bookingId}}', { token: 'adminToken', tests: ok() }),
    req('Driver has NO booking access (RBAC)', 'GET', '/bookings/{{bookingId}}', {
      token: 'driverToken',
      tests: denied(403, 'drivers read trips, not bookings'),
    }),
    req('UPDATE booking (pre-dispatch)', 'PATCH', '/bookings/{{bookingId}}', {
      token: 'customerToken',
      body: { vehicleClass: 'suv' },
      tests: ['pm.test("updated, or already dispatched", () => pm.expect([200, 409]).to.include(pm.response.code));'],
    }),
    req('Request favourite driver', 'POST', '/bookings/{{bookingId}}/favorite-driver', {
      token: 'customerToken',
      body: { driverId: '{{driverId}}' },
      tests: ['pm.test("assigned, busy, or too late", () => pm.expect([200, 409]).to.include(pm.response.code));'],
    }),
    req('My ride history', 'GET', '/users/me/rides', {
      token: 'customerToken',
      query: [{ key: 'page', value: '1' }, { key: 'limit', value: '10' }],
      tests: [...ok(), 'pm.test("paginated", () => { const d = pm.response.json().data; pm.expect(d.items).to.be.an("array"); pm.expect(d.total).to.be.a("number"); });'],
    }),
    req('Ride receipt', 'GET', '/users/me/rides/{{bookingId}}/receipt', {
      token: 'customerToken',
      tests: [...ok(), 'pm.test("receipt shape", () => { const d = pm.response.json().data; pm.expect(d).to.have.property("fare"); pm.expect(d).to.have.property("tripType"); pm.expect(d).to.have.property("status"); });'],
    }),
  ]),
);

/* 05 — dispatch + trip ----------------------------------------------------- */

collection.item.push(
  folder('05 · Dispatch & Trip lifecycle', [
    waitForDispatch('Wait for dispatch (booking)', 'bookingId', 'customerToken'),
    req('Admin: dispatch pool', 'GET', '/admin/dispatch/pool', {
      token: 'adminToken',
      tests: [...ok(), 'pm.test("pool listed", () => pm.expect(pm.response.json().data.items).to.be.an("array"));'],
    }),
    req('Driver ACCEPTS the booking', 'POST', '/trips/{{bookingId}}/accept', {
      token: 'driverToken',
      tests: [...ok(201), 'pm.test("trip created", () => pm.expect(pm.response.json().data.status).to.eql("accepted"));', save('tripId', '.data._id')],
    }),
    req('Trip as DRIVER — fare is stripped (note 2)', 'GET', '/trips/{{tripId}}', {
      token: 'driverToken',
      tests: [...ok(), 'pm.test("fareAmount hidden from driver", () => pm.expect(pm.response.json().data.fareAmount).to.be.undefined);'],
    }),
    req('Trip as CUSTOMER — driver phone masked (note 4)', 'GET', '/trips/{{tripId}}', {
      token: 'customerToken',
      tests: [
        ...ok(),
        'pm.test("phone masked", () => pm.expect(pm.response.json().data.driver.phone).to.eql("Contact via app"));',
        'pm.test("customer still sees the fare", () => pm.expect(pm.response.json().data.fareAmount).to.be.a("number"));',
      ],
    }),
    req('Trip as ADMIN — unredacted', 'GET', '/trips/{{tripId}}', {
      token: 'adminToken',
      tests: [...ok(), 'pm.test("admin sees the real phone", () => pm.expect(pm.response.json().data.driver.phone).to.not.eql("Contact via app"));'],
    }),
    req('Customer changes vehicle class', 'PATCH', '/trips/{{tripId}}/vehicle-class', {
      token: 'customerToken',
      body: { vehicleClass: 'suv' },
      tests: ok(),
    }),
    req('Customer changes drop location', 'PATCH', '/trips/{{tripId}}/location', {
      token: 'customerToken',
      body: { drop: { lat: 34.0195, lng: -118.4912, address: 'Santa Monica Pier' } },
      tests: ok(),
    }),
    req('Driver STARTS the trip', 'POST', '/trips/{{tripId}}/start', {
      token: 'driverToken',
      tests: [...ok(), 'pm.test("status started", () => pm.expect(pm.response.json().data.status).to.eql("started"));'],
    }),
    req('Vehicle class locked after start', 'PATCH', '/trips/{{tripId}}/vehicle-class', {
      token: 'customerToken',
      body: { vehicleClass: 'van' },
      tests: denied(409, 'trip already started'),
    }),
    req('Driver COMPLETES the trip (triggers settlement)', 'POST', '/trips/{{tripId}}/complete', {
      token: 'driverToken',
      tests: [...ok(), 'pm.test("status completed", () => pm.expect(pm.response.json().data.status).to.eql("completed"));'],
    }),
    req('Customer rates the driver', 'POST', '/trips/{{tripId}}/rate', {
      token: 'customerToken',
      body: { score: 5, comment: 'Excellent, tested via Postman' },
      tests: ok(201),
    }),
    req('Cannot rate the same trip twice', 'POST', '/trips/{{tripId}}/rate', {
      token: 'customerToken',
      body: { score: 1 },
      tests: denied(409, 'already rated'),
    }),
  ]),
);

/* 06 — cancellation -------------------------------------------------------- */

collection.item.push(
  folder('06 · Cancellation & Refunds', [
    req('Create a booking 30 days out', 'POST', '/bookings', {
      token: 'customerToken',
      body: {
        pickup: { lat: 34.0522, lng: -118.2437, address: 'Cancellation test pickup' },
        drop: { lat: 34.1381, lng: -118.3534, address: 'Cancellation test drop' },
        vehicleClass: 'sedan', tripType: 'point2point', city: '{{testCity}}',
        scheduledAt: '2027-01-20T10:00',
      },
      tests: [...ok(201), save('cancelBookingId', '.data.booking._id')],
    }),
    waitForDispatch('Wait for dispatch (cancellation booking)', 'cancelBookingId', 'customerToken'),
    req('Driver accepts it', 'POST', '/trips/{{cancelBookingId}}/accept', {
      token: 'driverToken',
      tests: [...ok(201), save('cancelTripId', '.data._id')],
    }),
    req('Wrong cancellation endpoint for the trip type', 'POST', '/trips/{{cancelTripId}}/cancel/hourly', {
      token: 'customerToken',
      body: { reason: 'wrong endpoint on purpose' },
      tests: denied(400, 'trip is point2point, not hourly'),
    }),
    req('Cancel point-to-point ≥24h → 90% refund', 'POST', '/trips/{{cancelTripId}}/cancel/point-to-point', {
      token: 'customerToken',
      body: { reason: 'Plans changed' },
      tests: [
        ...ok(),
        'pm.test("90% refund granted", () => { const d = pm.response.json().data; pm.expect(d.policy.refundPct).to.eql(90); pm.expect(d.refundAmount).to.be.above(0); });',
        'pm.test("policy evaluated in PT", () => pm.expect(pm.response.json().data.policy.hoursUntilPickup).to.be.above(24));',
      ],
    }),
    req('Cancelling twice is rejected', 'POST', '/trips/{{cancelTripId}}/cancel/point-to-point', {
      token: 'customerToken',
      body: { reason: 'again' },
      tests: denied(409, 'already cancelled'),
    }),
  ]),
);

/* 07 — wallet -------------------------------------------------------------- */

collection.item.push(
  folder('07 · Wallet & Payments', [
    req('Driver wallet + ledger', 'GET', '/wallet/me', {
      token: 'driverToken',
      query: [{ key: 'limit', value: '20' }],
      tests: [
        ...ok(),
        'pm.test("balance is a number", () => pm.expect(pm.response.json().data.balance).to.be.a("number"));',
        'pm.test("earnings recorded", () => pm.expect(pm.response.json().data.transactions.items).to.be.an("array"));',
        'pm.test("driver ledger does not leak the fare", () => { const rows = pm.response.json().data.transactions.items; rows.forEach(r => pm.expect(r.meta.ownerShare).to.be.undefined); });',
      ],
    }),
    req('Customer wallet shows the refund', 'GET', '/wallet/me', {
      token: 'customerToken',
      tests: [
        ...ok(),
        'pm.test("refund credited with NO fee (rule 3)", () => { const r = pm.response.json().data.transactions.items.find(t => t.type === "refund"); if (r) pm.expect(r.feeApplied).to.eql(0); });',
      ],
    }),
    req('Driver withdraws (10% fee + gateway payout)', 'POST', '/wallet/withdraw', {
      token: 'driverToken',
      body: { amount: 20 },
      tests: [
        'pm.test("withdrawn or insufficient balance", () => pm.expect([200, 400]).to.include(pm.response.code));',
        'if (pm.response.code === 200) { const d = pm.response.json().data; pm.test("10% fee applied", () => pm.expect(d.feeApplied).to.eql(2)); pm.test("net payout 18", () => pm.expect(d.netPayout).to.eql(18)); pm.test("gateway payout recorded", () => pm.expect(d.payout.gatewayReference).to.be.a("string")); }',
      ],
    }),
    req('Customer cannot withdraw', 'POST', '/wallet/withdraw', {
      token: 'customerToken',
      body: { amount: 5 },
      tests: denied(403, 'drivers only'),
    }),
    req('Customer applies wallet credit to a trip (no fee)', 'POST', '/wallet/use-credit', {
      token: 'customerToken',
      body: { tripId: '{{tripId}}', amount: 10 },
      tests: [
        'pm.test("applied or unavailable", () => pm.expect([200, 400]).to.include(pm.response.code));',
        'if (pm.response.code === 200) pm.test("zero fee on ride credit (rule 3)", () => pm.expect(pm.response.json().data.feeApplied).to.eql(0));',
      ],
    }),
    req('System collects the fare (gateway)', 'POST', '/payments/collect', {
      token: 'adminToken',
      body: { tripId: '{{tripId}}' },
      tests: [...ok(), 'pm.test("charge recorded", () => pm.expect(pm.response.json().data).to.have.property("charged"));'],
    }),
    req('Customer cannot call payments/collect', 'POST', '/payments/collect', {
      token: 'customerToken',
      body: { tripId: '{{tripId}}' },
      tests: denied(403, 'system endpoint'),
    }),
    req('Unsigned webhook is rejected', 'POST', '/payments/webhook', {
      body: { type: 'payment_intent.succeeded', data: { object: { id: 'pi_test' } } },
      tests: denied(401, 'missing signature'),
    }),
  ]),
);

/* 08 — notifications, flight, chat ----------------------------------------- */

collection.item.push(
  folder('08 · Notifications, Flight & Chat', [
    req('My notifications', 'GET', '/notifications', {
      token: 'customerToken',
      tests: [
        ...ok(),
        'pm.test("notifications fanned out", () => pm.expect(pm.response.json().data.items).to.be.an("array").that.is.not.empty);',
        'const items = pm.response.json().data.items; if (items.length) pm.collectionVariables.set("notificationId", items[0]._id);',
      ],
    }),
    req('Mark notification read', 'PATCH', '/notifications/{{notificationId}}/read', {
      token: 'customerToken',
      tests: [...ok(), 'pm.test("read = true", () => pm.expect(pm.response.json().data.read).to.eql(true));'],
    }),
    req("Cannot read another user's notification", 'PATCH', '/notifications/{{notificationId}}/read', {
      token: 'driverToken',
      tests: denied(403, 'owner only'),
    }),
    req('Flight lookup (driver)', 'GET', '/flight/AA100', {
      token: 'driverToken',
      tests: [...ok(), 'pm.test("flight shape", () => { const d = pm.response.json().data; pm.expect(d).to.have.property("scheduledArrival"); pm.expect(d).to.have.property("status"); });'],
    }),
    req('Customer cannot look up flights', 'GET', '/flight/AA100', {
      token: 'customerToken',
      tests: denied(403, 'driver/admin only'),
    }),
    req('Chat history (participant)', 'GET', '/trips/{{tripId}}/chat/history', {
      token: 'customerToken',
      tests: [...ok(), 'pm.test("history is a list", () => pm.expect(pm.response.json().data).to.be.an("array"));'],
    }),
    req('Chat history (admin monitors)', 'GET', '/trips/{{tripId}}/chat/history', {
      token: 'adminToken',
      tests: ok(),
    }),
    req('Company has no chat access', 'GET', '/trips/{{tripId}}/chat/history', {
      token: 'companyToken',
      tests: denied(403, 'companies excluded from chat'),
    }),
  ]),
);

/* 09 — reports ------------------------------------------------------------- */

collection.item.push(
  folder('09 · Reports', [
    req('Trips completed — driver (own only)', 'GET', '/reports/trips-completed', {
      token: 'driverToken',
      tests: [
        ...ok(),
        'pm.test("scoped to own", () => pm.expect(pm.response.json().data.scope).to.eql("own"));',
        'pm.test("fares hidden from driver", () => pm.response.json().data.rows.forEach(r => pm.expect(r.fareAmount).to.be.undefined));',
      ],
    }),
    req('Trips completed — admin (all)', 'GET', '/reports/trips-completed', {
      token: 'adminToken',
      tests: [...ok(), 'pm.test("scope all with totals", () => { const d = pm.response.json().data; pm.expect(d.scope).to.eql("all"); pm.expect(d.totalFare).to.be.a("number"); });'],
    }),
    req('Earnings & payout — driver', 'GET', '/reports/earnings-payout', {
      token: 'driverToken',
      tests: [...ok(), 'pm.test("totals present", () => pm.expect(pm.response.json().data).to.have.property("totalCredited"));'],
    }),
    req('Cancellations & penalties — company', 'GET', '/reports/cancellations-penalties', {
      token: 'companyToken',
      tests: [...ok(), 'pm.test("counts present", () => pm.expect(pm.response.json().data.counts).to.be.an("object"));'],
    }),
    req('Customer has no report access (rule 7)', 'GET', '/reports/trips-completed', {
      token: 'customerToken',
      tests: denied(403, 'reports exclude customers'),
    }),
    req('Queue a CSV export', 'GET', '/reports', {
      token: 'adminToken',
      query: [{ key: 'type', value: 'trips-completed' }, { key: 'format', value: 'csv' }],
      tests: [
        'pm.test("accepted for async processing", () => pm.response.to.have.status(202));',
        save('exportJobId', '.data.jobId'),
      ],
    }),
    req('Export job status', 'GET', '/reports/exports/{{exportJobId}}', {
      token: 'adminToken',
      tests: [...ok(), 'pm.test("job state reported", () => pm.expect(pm.response.json().data.state).to.be.a("string"));'],
    }),
    req('Download the export', 'GET', '/reports/exports/{{exportJobId}}/download', {
      token: 'adminToken',
      tests: ['pm.test("ready (200) or still running (409)", () => pm.expect([200, 409]).to.include(pm.response.code));'],
    }),
  ]),
);

/* 10 — admin --------------------------------------------------------------- */

collection.item.push(
  folder('10 · Admin & Company tools', [
    req('Company: add a driver to the roster', 'POST', '/admin/drivers', {
      token: 'companyToken',
      body: {
        name: 'Postman Roster Driver',
        email: '{{$randomExampleEmail}}',
        phone: '+1555{{$randomInt}}',
        password: 'Passw0rd!23',
        vehicleClass: 'van',
      },
      tests: [...ok(201), save('newDriverId', '.data.driver._id')],
    }),
    req('Company: list own roster', 'GET', '/admin/drivers', {
      token: 'companyToken',
      tests: [...ok(), 'pm.test("roster returned", () => pm.expect(pm.response.json().data.items).to.be.an("array"));'],
    }),
    req('Admin: list all drivers', 'GET', '/admin/drivers', {
      token: 'adminToken',
      tests: [...ok(), 'pm.test("admin sees more than one", () => pm.expect(pm.response.json().data.total).to.be.at.least(1));'],
    }),
    req('Company: set the driver per-trip charge', 'PATCH', '/admin/drivers/{{newDriverId}}', {
      token: 'companyToken',
      body: { status: 'available', payout: { mode: 'flat', value: 30 } },
      tests: [...ok(), 'pm.test("terms recorded as set by the company", () => { const p = pm.response.json().data.payout; pm.expect(p.mode).to.eql("flat"); pm.expect(p.value).to.eql(30); pm.expect(p.setBy).to.eql("company"); });'],
    }),
    req("Admin cannot set a company driver's terms", 'PATCH', '/admin/drivers/{{newDriverId}}', {
      token: 'adminToken',
      body: { payout: { mode: 'flat', value: 1 } },
      tests: denied(403, "that driver is on a company's roster"),
    }),
    req('Admin: set a platform driver rate', 'PATCH', '/admin/drivers/{{driverId}}', {
      token: 'adminToken',
      body: { payout: { mode: 'percentage', value: 70 } },
      tests: [...ok(), 'pm.test("set by admin", () => pm.expect(pm.response.json().data.payout.setBy).to.eql("admin"));'],
    }),
    req('Admin: bookings dashboard', 'GET', '/admin/dashboard/bookings', {
      token: 'adminToken',
      query: [{ key: 'page', value: '1' }, { key: 'limit', value: '10' }],
      tests: [...ok(), 'pm.test("paginated", () => pm.expect(pm.response.json().data).to.have.property("totalPages"));'],
    }),
    req('Admin: users dashboard', 'GET', '/admin/dashboard/users', {
      token: 'adminToken',
      tests: ok(),
    }),
    req('Company cannot open the admin dashboard', 'GET', '/admin/dashboard/users', {
      token: 'companyToken',
      tests: denied(403, 'admin only'),
    }),
    req('Subscription revenue by month', 'GET', '/admin/revenue/subscriptions', {
      token: 'adminToken',
      tests: [...ok(), 'pm.test("aggregate returned", () => pm.expect(pm.response.json().data).to.have.property("totalRevenue"));'],
    }),
    req('Driver penalties & cancellations', 'GET', '/admin/drivers/penalties', {
      token: 'adminToken',
      tests: [...ok(), 'pm.test("drivers listed", () => pm.expect(pm.response.json().data.drivers).to.be.an("array"));'],
    }),
  ]),
);

/* -------------------------------- environment ----------------------------- */

const environment = {
  name: 'ABL — Local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:5000', enabled: true },
    { key: 'seedPassword', value: SEED_PASSWORD, enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'ABL-Backend.postman_collection.json'), JSON.stringify(collection, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'ABL-Local.postman_environment.json'), JSON.stringify(environment, null, 2));

const count = collection.item.reduce((n, f) => n + f.item.length, 0);
console.log(`Wrote ${collection.item.length} folders / ${count} requests to postman/`);
