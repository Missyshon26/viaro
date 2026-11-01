import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveStream } from "../src/lib/live/liveStream.ts";

const frame = (topic, id) => `event: change\ndata: ${JSON.stringify({ topic, action: "x", id, at: "2026-11-01T00:00:00Z" })}\n\n`;
const encoder = new TextEncoder();

/** An API that holds one stream open and lets the test push frames down it. */
function fakeApi() {
  const api = { opened: 0, push: null, fetchImpl: null };
  api.fetchImpl = async () => {
    api.opened += 1;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(": connected\n\n"));
          api.push = (text) => controller.enqueue(encoder.encode(text));
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  };
  return api;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("every screen shares one stream, and each hears only the topics it asked for", async () => {
  const api = fakeApi();
  const live = createLiveStream({ url: () => "http://api.test/events/stream", getToken: () => "token", fetchImpl: api.fetchImpl, closeGraceMs: 10 });

  const bookings = [];
  const bell = [];
  const stopA = live.subscribe({ topics: new Set(["booking"]), primary: "booking", handler: { current: (e) => bookings.push(`${e.topic}:${e.action}`) } });
  const stopB = live.subscribe({ topics: new Set(["notification"]), primary: "notification", handler: { current: (e) => bell.push(`${e.topic}:${e.action}`) } });

  await wait(30);
  assert.equal(api.opened, 1, "one connection for both listeners");
  assert.equal(live.getStatus(), "live");

  api.push(frame("booking", "b1") + frame("notification", "n1") + frame("driver", "d1"));
  await wait(30);

  // A fresh connection nudges everyone once; after that only the topics each asked for.
  assert.deepEqual(bookings, ["booking:reconnected", "booking:x"]);
  assert.deepEqual(bell, ["notification:reconnected", "notification:x"]);

  stopA();
  stopB();
  await wait(40); // the stream closes once nobody is listening
});

test("a frame split across two chunks is still heard once", async () => {
  const api = fakeApi();
  const live = createLiveStream({ url: () => "http://api.test/events/stream", getToken: () => "token", fetchImpl: api.fetchImpl, closeGraceMs: 10 });
  const heard = [];
  const stop = live.subscribe({ topics: new Set(["booking"]), primary: "booking", handler: { current: (e) => e.action === "x" && heard.push(e.id) } });
  await wait(30);

  const whole = frame("booking", "split");
  api.push(whole.slice(0, 25));
  await wait(10);
  api.push(whole.slice(25));
  await wait(30);

  assert.deepEqual(heard, ["split"]);
  stop();
  await wait(40);
});

test("when the stream cannot be held, the screen is told to refetch on a timer, and the light says so", async () => {
  let attempts = 0;
  const live = createLiveStream({
    url: () => "http://api.test/events/stream",
    getToken: () => "token",
    fetchImpl: async () => {
      attempts += 1;
      return new Response("nope", { status: 502 });
    },
    reconnectMinMs: 5,
    reconnectMaxMs: 10,
    giveUpAfter: 2,
    pollMs: 20,
    closeGraceMs: 10,
  });
  const warn = console.warn;
  console.warn = () => {};
  const heard = [];
  const stop = live.subscribe({ topics: new Set(["booking"]), primary: "booking", handler: { current: (e) => heard.push(e.action) } });
  try {
    await wait(120);
    assert.equal(live.getStatus(), "polling");
    assert.ok(attempts >= 2, "it keeps trying to get the stream back");
    assert.ok(heard.filter((a) => a === "poll").length >= 2, "and polls meanwhile");
  } finally {
    stop();
    console.warn = warn;
    await wait(40);
  }
});

test("nothing is requested while signed out", async () => {
  const api = fakeApi();
  const live = createLiveStream({ url: () => "http://api.test/events/stream", getToken: () => null, fetchImpl: api.fetchImpl, reconnectMinMs: 5, closeGraceMs: 10 });
  const stop = live.subscribe({ topics: new Set(["booking"]), primary: "booking", handler: { current: () => {} } });
  await wait(40);
  assert.equal(api.opened, 0);
  stop();
  await wait(40);
});
