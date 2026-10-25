# Tests

```bash
npm test          # one run
npm run test:watch
npm run typecheck # includes tests/ — the build config only covers src/
```

## What is covered, and why only this

Authorization is the only boundary between the four roles: they share one API, one
database and one set of models. Everything else can be re-derived from the code; a
missing guard cannot. These suites cover that boundary and nothing else — they are not
an attempt at general coverage.

| File | Asserts |
|---|---|
| `authorization.matrix.ts` | **The declaration** — who may call each of the 76 routes |
| `authorization.spec.ts` | The running app agrees with the matrix, in both directions |
| `revocation.spec.ts` | A suspended/deleted account's access token stops working immediately |
| `visibility.spec.ts` | Spec §8 rules 2 and 4 — drivers never see fares, customers never see the driver's number |

## The ratchet

`authorization.spec.ts` does not just check the routes it knows about. It enumerates
what the app actually serves and fails if anything is missing from the matrix:

```
These routes exist but nobody has declared who may call them.
Add them to tests/authorization.matrix.ts:
  GET /drivers/me/secret-thing
```

It fails in the other direction too (a matrix entry with no matching route), and asserts
the number of mounted routers equals the mount table in `routes.ts`, so a new
`app.use(...)` in `app.ts` cannot slip past either.

**This is the point of the suite.** Without it the matrix silently rots, and a new
endpoint gets merged with nobody deciding who may reach it.

## No database, no Redis, no network

`authGuard` and `roleGuard` both reject *before* any controller touches a datastore, so
proving "role X is refused" needs neither. Requests from an allowed role are expected to
fail on the missing database — the assertion is `not 403`, which is exactly the claim.

`setup.ts` therefore stubs `ioredis` and `bullmq` and sets `mongoose.bufferCommands =
false` so queries fail immediately instead of buffering for ten seconds. The whole suite
runs in ~7s.

Two details worth knowing if you touch the stub:

- The rate limiter issues `multi().incr().pexpire().exec()`. When the stub lacked a
  working pipeline, every request waited out the limiter's 250 ms fail-open timeout and
  the suite took **140 seconds** instead of 7. If it suddenly gets slow again, look here
  first.
- BullMQ uses blocking Redis commands the stub cannot serve, so the report-export routes
  hang without the `bullmq` mock.

## Adding a route

1. Add it to the router as usual.
2. Run `npm test`. It fails and names your route.
3. Add an entry to `authorization.matrix.ts` with the roles that may call it, and a
   `note` if the answer is not obvious from the path.

If step 3 makes you hesitate, that is the test doing its job.

## What is deliberately not covered

- **Ownership** ("is this *my* booking?") is enforced in the services — `loadOwnBooking`,
  `listTripsForUser` — and needs real data to test. That is the most valuable suite to
  add next, and it does need `mongodb-memory-server`.
- Business logic: fare maths, the revenue split, the cancellation window.
