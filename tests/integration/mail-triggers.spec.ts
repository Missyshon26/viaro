import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { User } from '../../src/models/User';
import * as mail from '../../src/modules/notifications/notification.emails';
import * as email from '../../src/integrations/email';
import { AGREEMENT_VERSION } from '../../src/config/agreement';
import { listen, makeUser, TINY_PNG, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/jobs/cancellationWindow.job', () => ({ scheduleCancellationWindowCheck: vi.fn(async () => undefined) }));
// The real senders skip themselves under test; these are spies on the ones this suite is about.
vi.mock('../../src/modules/notifications/notification.emails', async (orig) => {
  const actual = await orig<typeof import('../../src/modules/notifications/notification.emails')>();
  return {
    ...actual,
    sendContactNumberReset: vi.fn(async () => undefined),
    sendDocumentDecision: vi.fn(async () => undefined),
  };
});
vi.mock('../../src/integrations/email', async (orig) => {
  const actual = await orig<typeof import('../../src/integrations/email')>();
  return { ...actual, sendEmail: vi.fn(async () => ({ sent: true, provider: 'test' })) };
});

const http = listen(app);
const server = http.server;

beforeAll(async () => {
  await startDatabase();
  await seedCatalogue();
});
afterAll(async () => {
  await http.close();
  await stopDatabase();
});
beforeEach(async () => {
  await resetData();
  vi.mocked(mail.sendContactNumberReset).mockClear();
  vi.mocked(mail.sendDocumentDecision).mockClear();
  vi.mocked(email.sendEmail).mockClear();
  vi.mocked(email.sendEmail).mockResolvedValue({ sent: true, provider: 'test' });
});

describe('the phone number changing', () => {
  it('emails the account when the customer changes their own number', async () => {
    const client = await makeUser('customer', { phone: '+12065550100' });
    const res = await request(server).patch('/users/me').set('Authorization', client.auth).send({ phone: '+12065550999' });
    expect(res.status).toBe(200);
    expect(mail.sendContactNumberReset).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mail.sendContactNumberReset).mock.calls[0][1]).toBe('+12065550999');
  });

  it('emails the account when operations change it', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer', { phone: '+12065550100' });
    const res = await request(server).patch(`/admin/customers/${client.id}`).set('Authorization', admin.auth).send({ phone: '+12065550888' });
    expect(res.status).toBe(200);
    expect(mail.sendContactNumberReset).toHaveBeenCalledTimes(1);
  });

  it('says nothing when the number did not change', async () => {
    const client = await makeUser('customer', { phone: '+12065550100' });
    await request(server).patch('/users/me').set('Authorization', client.auth).send({ phone: '+12065550100', firstName: 'Pat', lastName: 'Rider' });
    expect(mail.sendContactNumberReset).not.toHaveBeenCalled();
  });
});

describe('Email invoice', () => {
  async function booked() {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const made = await request(server).post('/admin/bookings').set('Authorization', admin.auth).send({
      customerId: client.id,
      trip: { pickup: point('Hotel Andra, Seattle'), drop: point('Sea-Tac Airport'), vehicleClass: 'sedan', tripType: 'point2point', city: 'seattle', scheduledAt: pickupIn(5) },
    });
    return { admin, client, id: String(made.body.data.booking._id) };
  }

  it('sends the customer the invoice with the PDF attached', async () => {
    const { admin, client, id } = await booked();
    const res = await request(server).post(`/admin/bookings/${id}/email-invoice`).set('Authorization', admin.auth);
    expect(res.status).toBe(200);
    const customer = await User.findById(client.id).lean();
    expect(res.body.data.sentTo).toBe(customer!.email);

    const sent = vi.mocked(email.sendEmail).mock.calls.at(-1)![0];
    expect(sent.to).toBe(customer!.email);
    expect(sent.subject).toBe('Invoice');
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments![0].filename).toMatch(/^abl-invoice-ABL-/);
    expect(sent.attachments![0].content.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('sends the invoice alone, with no payment link, when asked', async () => {
    const { admin, id } = await booked();
    const res = await request(server).post(`/admin/bookings/${id}/email-invoice`).set('Authorization', admin.auth).send({ withPaymentLink: false });
    expect(res.status).toBe(200);
    expect(res.body.data.paymentLinkIncluded).toBe(false);
    const sent = vi.mocked(email.sendEmail).mock.calls.at(-1)![0];
    expect(sent.attachments).toHaveLength(1);
    expect(sent.text ?? '').not.toContain('Pay Now');
    expect((await Booking.findById(id).lean())!.paymentLink).toBeUndefined();
  });

  it('says so when the email could not be sent', async () => {
    const { admin, id } = await booked();
    vi.mocked(email.sendEmail).mockResolvedValue({ sent: false, provider: 'smtp' });
    const res = await request(server).post(`/admin/bookings/${id}/email-invoice`).set('Authorization', admin.auth);
    expect(res.status).toBe(502);
  });

  it('is admin only, for a booking that exists', async () => {
    const { admin, client, id } = await booked();
    expect((await request(server).post(`/admin/bookings/${id}/email-invoice`).set('Authorization', client.auth)).status).toBe(403);
    expect((await request(server).post('/admin/bookings/5f9d88b8b54764421b7156c9/email-invoice').set('Authorization', admin.auth)).status).toBe(404);
    expect(await Booking.countDocuments()).toBe(1);
  });
});

describe('reviewing a signed agreement', () => {
  const review = (auth: string, id: string, decision: string) =>
    request(server).post(`/admin/users/${id}/agreement/review`).set('Authorization', auth).send({ decision });

  it('records approval or rejection and emails the customer', async () => {
    const admin = await makeUser('admin', { name: 'Ops Olivia' });
    const client = await makeUser('customer', { agreement: { version: 'v1', signedAt: new Date() } });

    const approved = await review(admin.auth, client.id, 'approve');
    expect(approved.status).toBe(200);
    expect(approved.body.data.review).toMatchObject({ status: 'approved', byName: 'Ops Olivia' });
    expect(vi.mocked(mail.sendDocumentDecision).mock.calls.at(-1)![1]).toBe(true);

    const rejected = await review(admin.auth, client.id, 'reject');
    expect(rejected.body.data.review.status).toBe('rejected');
    expect(vi.mocked(mail.sendDocumentDecision).mock.calls.at(-1)![1]).toBe(false);
    expect(mail.sendDocumentDecision).toHaveBeenCalledTimes(2);
  });

  it('needs a signed agreement, a real client and an admin', async () => {
    const admin = await makeUser('admin');
    const unsigned = await makeUser('customer');
    expect((await review(admin.auth, unsigned.id, 'approve')).status).toBe(409);
    expect((await review(admin.auth, '5f9d88b8b54764421b7156c9', 'approve')).status).toBe(404);
    expect((await review(admin.auth, unsigned.id, 'maybe')).status).toBe(400);
    expect((await review(unsigned.auth, unsigned.id, 'approve')).status).toBe(403);
    expect(mail.sendDocumentDecision).not.toHaveBeenCalled();
  });
});

describe('a new signature starts unreviewed', () => {
  it('clears an earlier verdict when the customer signs again', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer', { agreement: { version: 'v0', signedAt: new Date() } });
    await request(server).post(`/admin/users/${client.id}/agreement/review`).set('Authorization', admin.auth).send({ decision: 'reject' });

    const signed = await request(server)
      .put('/users/me/agreement')
      .set('Authorization', client.auth)
      .send({ signature: TINY_PNG, accepted: true, version: AGREEMENT_VERSION });
    expect(signed.status).toBe(200);
    expect(signed.body.data.review).toBeNull();
  });
});

describe('a no-show is copied to operations', () => {
  it('sends the same notice to the operations inbox, headed with whose it is', async () => {
    const client = await makeUser('customer', { name: 'Pat Rider' });
    const booking = await Booking.create({
      customerId: client.id,
      pickup: point('Hotel Andra, Seattle'),
      drop: point('Sea-Tac Airport'),
      vehicleClass: 'sedan',
      tripType: 'point2point',
      city: 'seattle',
      scheduledAt: new Date(Date.now() + 86_400_000),
      estimatedFare: 140,
      status: 'assigned',
    });
    const ctx = await mail.loadContext({ bookingId: String(booking._id) });
    await mail.alertOperations('trip.no_show', ctx, {});

    const sent = vi.mocked(email.sendEmail).mock.calls.at(-1)![0];
    expect(sent.subject).toBe('Copy - No Show - Pat Rider');
    expect(sent.to).toMatch(/@/);
    expect(sent.text).toContain('No-Show');
  });
});
