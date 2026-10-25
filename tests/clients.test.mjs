import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressOf,
  createPayload,
  emptyClientForm,
  exportPath,
  filterQuery,
  formFromClient,
  splitName,
  updatePayload,
} from "../src/lib/clients.ts";

const client = {
  name: "Sam Rider",
  firstName: "Sam",
  lastName: "Rider",
  email: "sam@example.com",
  phone: "+12065550100",
  status: "active",
  address: { line1: "123 Pine Street", line2: "Apt 4", city: "Seattle", state: "WA", postalCode: "98101" },
};

test("splitName splits on the first space", () => {
  assert.deepEqual(splitName("Mary Jane Watson"), { firstName: "Mary", lastName: "Jane Watson" });
  assert.deepEqual(splitName("Madonna"), { firstName: "Madonna", lastName: "" });
  assert.deepEqual(splitName("  Sam   Rider "), { firstName: "Sam", lastName: "Rider" });
});

test("the form is filled from the stored halves, or from the full name for an older account", () => {
  assert.equal(formFromClient(client).lastName, "Rider");
  const old = formFromClient({ name: "Mary Jane Watson", email: "m@example.com", phone: "+12065550101", status: "active" });
  assert.deepEqual([old.firstName, old.lastName], ["Mary", "Jane Watson"]);
  assert.equal(old.line1, "");
});

test("an empty address form is no address, a filled one is sent as typed", () => {
  assert.equal(addressOf(emptyClientForm()), null);
  assert.deepEqual(addressOf(formFromClient(client)), client.address);
  const noLine2 = { ...formFromClient(client), line2: "  " };
  assert.equal("line2" in addressOf(noLine2), false);
});

test("adding a client sends the details, the address only when given, and the invite choice", () => {
  const form = { ...emptyClientForm(), firstName: " Dana ", lastName: "Diaz", email: " dana@example.com ", phone: "+12065550123" };
  assert.deepEqual(createPayload(form), {
    firstName: "Dana",
    lastName: "Diaz",
    email: "dana@example.com",
    phone: "+12065550123",
    sendInvite: true,
  });
  const withAddress = createPayload({ ...form, line1: "9 Elm Road", city: "Tacoma", state: "WA", postalCode: "98402", sendInvite: false });
  assert.equal(withAddress.sendInvite, false);
  assert.equal(withAddress.address.city, "Tacoma");
});

test("editing sends only what changed", () => {
  const same = formFromClient(client);
  assert.deepEqual(updatePayload(same, client), {});

  assert.deepEqual(updatePayload({ ...same, phone: "+12065550999" }, client), { phone: "+12065550999" });
  assert.deepEqual(updatePayload({ ...same, status: "suspended" }, client), { status: "suspended" });
  assert.deepEqual(updatePayload({ ...same, firstName: "Samuel" }, client), { firstName: "Samuel", lastName: "Rider" });
  // The same email in another letter case is not a change.
  assert.deepEqual(updatePayload({ ...same, email: "SAM@Example.com" }, client), {});
  assert.deepEqual(updatePayload({ ...same, email: "new@example.com" }, client), { email: "new@example.com" });
});

test("clearing every address box removes the address, and nothing else moves", () => {
  const cleared = { ...formFromClient(client), line1: "", line2: "", city: "", state: "", postalCode: "" };
  assert.deepEqual(updatePayload(cleared, client), { address: null });
  // Re-typing the same address is not a change.
  assert.deepEqual(updatePayload({ ...formFromClient(client), city: " Seattle " }, client), {});
});

test("whitespace around a name is not a change", () => {
  assert.deepEqual(updatePayload({ ...formFromClient(client), firstName: " Sam ", lastName: " Rider" }, client), {});
});

test("the list and the download are built from the same filters", () => {
  const filters = { search: " alice ", status: "suspended", guest: "true" };
  assert.equal(filterQuery(filters), "?search=alice&status=suspended&guest=true");
  assert.equal(filterQuery({ search: "", status: "", guest: "" }), "");
  assert.equal(filterQuery(filters, { page: 2, limit: 50 }), "?search=alice&status=suspended&guest=true&page=2&limit=50");
  assert.equal(exportPath(filters, "xlsx"), "/admin/customers/export?search=alice&status=suspended&guest=true&format=xlsx");
  assert.equal(exportPath({ search: "", status: "", guest: "" }, "csv"), "/admin/customers/export?format=csv");
});

test("a search with special characters is encoded, not passed through", () => {
  const q = filterQuery({ search: "a&b=c d", status: "", guest: "" });
  assert.equal(q, "?search=a%26b%3Dc+d");
});
