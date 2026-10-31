import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, CONNECTION_MESSAGE, errorText, reach } from "../src/lib/api/client.ts";

test("a lost connection reads as a plain sentence, not the browser's 'Failed to fetch'", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  try {
    await assert.rejects(reach("https://api.example.test/x"), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 0);
      assert.equal(errorText(err), CONNECTION_MESSAGE);
      return true;
    });
  } finally {
    globalThis.fetch = real;
  }
});

test("a cancelled request is passed through, not reported as a lost connection", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new DOMException("aborted", "AbortError");
  };
  try {
    await assert.rejects(reach("https://api.example.test/x"), (err) => err.name === "AbortError");
  } finally {
    globalThis.fetch = real;
  }
});

test("an answer from the server is returned untouched", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 500 });
  try {
    assert.equal((await reach("https://api.example.test/x")).status, 500);
  } finally {
    globalThis.fetch = real;
  }
});
