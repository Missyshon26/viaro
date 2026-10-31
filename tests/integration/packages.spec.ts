import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import app from '../../src/app';
import { uploadDir } from '../../src/config/env';
import { EventType } from '../../src/models/EventType';
import { Package } from '../../src/models/Package';
import { VehicleClass } from '../../src/models/VehicleClass';
import { listen, makeUser, resetData, seedCatalogue, startDatabase, stopDatabase, TINY_PNG } from './harness';

const http = listen(app);
const server = http.server;
const png = Buffer.from(TINY_PNG.split(',')[1], 'base64');

let admin: { id: string; auth: string };

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
  fs.rmSync(uploadDir, { recursive: true, force: true });
  admin = await makeUser('admin');
  await EventType.create({ name: 'Wine Tasting', key: 'wine tasting' });
});

const make = (over: Record<string, unknown> = {}) =>
  request(server)
    .post('/admin/packages')
    .set('Authorization', admin.auth)
    .send({
      name: 'Wine Country Day',
      description: 'Woodinville tasting rooms',
      tourLength: '8 hours',
      totalPersons: 6,
      eventTypes: ['Wine Tasting'],
      vehicles: [{ vehicleClass: 'sedan', price: 900 }, { vehicleClass: 'suv', price: 1200 }],
      ...over,
    });

const filesOnDisk = () => {
  const dir = path.join(uploadDir, 'packages');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.endsWith('.part')) : [];
};

describe('admin packages', () => {
  it('creates, reads, edits and deletes a package', async () => {
    const created = await make();
    expect(created.status).toBe(201);
    const id = created.body.data._id as string;
    expect(created.body.data).toMatchObject({ name: 'Wine Country Day', status: 'visible', totalPersons: 6, image: null });

    const list = await request(server).get('/admin/packages').set('Authorization', admin.auth);
    expect(list.body.data).toHaveLength(1);
    expect((await request(server).get('/admin/packages?q=woodinville').set('Authorization', admin.auth)).body.data).toHaveLength(1);
    expect((await request(server).get('/admin/packages?q=nothing').set('Authorization', admin.auth)).body.data).toHaveLength(0);

    const edited = await request(server)
      .patch(`/admin/packages/${id}`)
      .set('Authorization', admin.auth)
      .send({ status: 'hidden', vehicles: [{ vehicleClass: 'suv', price: 1300 }] });
    expect(edited.status).toBe(200);
    expect(edited.body.data.status).toBe('hidden');
    expect(edited.body.data.vehicles).toEqual([{ vehicleClass: 'suv', price: 1300 }]);
    expect((await request(server).get('/admin/packages?status=hidden').set('Authorization', admin.auth)).body.data).toHaveLength(1);

    expect((await request(server).delete(`/admin/packages/${id}`).set('Authorization', admin.auth)).status).toBe(200);
    expect((await request(server).get(`/admin/packages/${id}`).set('Authorization', admin.auth)).status).toBe(404);
  });

  it('refuses bad input: no name, a duplicate vehicle, an unknown vehicle, an empty edit, a bad id', async () => {
    expect((await make({ name: '' })).status).toBe(400);
    expect((await make({ vehicles: [{ vehicleClass: 'suv', price: 1 }, { vehicleClass: 'suv', price: 2 }] })).status).toBe(400);
    expect((await make({ vehicles: [{ vehicleClass: 'spaceship', price: 1 }] })).status).toBe(400);
    expect((await make({ vehicles: [{ vehicleClass: 'suv', price: -5 }] })).status).toBe(400);
    const id = (await make()).body.data._id;
    expect((await request(server).patch(`/admin/packages/${id}`).set('Authorization', admin.auth).send({})).status).toBe(400);
    expect((await request(server).get('/admin/packages/nope').set('Authorization', admin.auth)).status).toBe(400);
    expect((await request(server).get(`/admin/packages/${'a'.repeat(24)}`).set('Authorization', admin.auth)).status).toBe(404);
  });

  it('is for admins only', async () => {
    const customer = await makeUser('customer');
    expect((await request(server).get('/admin/packages').set('Authorization', customer.auth)).status).toBe(403);
    expect((await request(server).get('/admin/packages')).status).toBe(401);
  });

  it('stores one picture, replaces it, and removes the file when the picture or package goes', async () => {
    const id = (await make()).body.data._id as string;
    const put = () => request(server).post(`/admin/packages/${id}/image`).set('Authorization', admin.auth).attach('file', png, 'a.png');

    const first = await put();
    expect(first.status).toBe(200);
    expect(first.body.data.image.src).toMatch(/\/uploads\/packages\/[0-9a-f-]{36}\.png$/);
    expect(filesOnDisk()).toHaveLength(1);

    expect((await put()).status).toBe(200);
    expect(filesOnDisk()).toHaveLength(1); // the old file went

    const bad = await request(server).post(`/admin/packages/${id}/image`).set('Authorization', admin.auth).attach('file', Buffer.from('<script>'), 'x.png');
    expect(bad.status).toBe(400);
    expect(filesOnDisk()).toHaveLength(1);

    expect((await request(server).delete(`/admin/packages/${id}/image`).set('Authorization', admin.auth)).body.data.image).toBeNull();
    expect(filesOnDisk()).toHaveLength(0);

    await put();
    await request(server).delete(`/admin/packages/${id}`).set('Authorization', admin.auth);
    expect(filesOnDisk()).toHaveLength(0);
    expect((await put()).status).toBe(404);
    expect(filesOnDisk()).toHaveLength(0);
  });
});

describe('packages on the booking page', () => {
  it('lists only visible packages, with vehicle labels, and hides retired vehicle classes', async () => {
    await make();
    await make({ name: 'Secret', status: 'hidden' });

    const res = await request(server).get('/packages');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const pkg = res.body.data[0];
    expect(pkg.name).toBe('Wine Country Day');
    expect(pkg.status).toBeUndefined();
    expect(pkg.vehicles[0]).toMatchObject({ vehicleClass: 'sedan', price: 900 });
    expect(pkg.vehicles[0].label).toBeTruthy();

    await VehicleClass.updateOne({ value: 'suv' }, { $set: { active: false } });
    const after = await request(server).get('/packages');
    expect(after.body.data[0].vehicles.map((v: { vehicleClass: string }) => v.vehicleClass)).toEqual(['sedan']);
    await VehicleClass.updateOne({ value: 'suv' }, { $set: { active: true } });
  });

  it('serves one visible package and 404s a hidden or missing one', async () => {
    const shown = (await make()).body.data._id;
    const hidden = (await make({ status: 'hidden' })).body.data._id;
    expect((await request(server).get(`/packages/${shown}`)).status).toBe(200);
    expect((await request(server).get(`/packages/${hidden}`)).status).toBe(404);
    expect((await request(server).get(`/packages/${'b'.repeat(24)}`)).status).toBe(404);
    expect(await Package.countDocuments()).toBe(2);
  });
});

describe('event types', () => {
  const ev = (method: 'post' | 'patch' | 'delete' | 'get', url: string, data?: object) => {
    const r = request(server)[method](url).set('Authorization', admin.auth);
    return data ? r.send(data) : r;
  };

  it('adds, lists, refuses duplicates in any case, renames onto packages and deletes off them', async () => {
    const added = await ev('post', '/admin/event-types', { name: '  Wedding   Send-off ' });
    expect(added.status).toBe(201);
    expect(added.body.data.name).toBe('Wedding Send-off');
    expect((await ev('post', '/admin/event-types', { name: 'wedding send-off' })).status).toBe(409);
    expect((await ev('post', '/admin/event-types', { name: 'x' })).status).toBe(400);

    const names = (await ev('get', '/admin/event-types')).body.data.map((e: { name: string }) => e.name);
    expect(names).toEqual(['Wedding Send-off', 'Wine Tasting']);

    // A package may only use names from the list, in the list's own spelling.
    expect((await ev('post', '/admin/packages', { name: 'Bad', eventTypes: ['Skydiving'] })).status).toBe(400);
    const pkg = await ev('post', '/admin/packages', { name: 'Day out', eventTypes: ['wine tasting', 'WEDDING SEND-OFF'] });
    expect(pkg.status).toBe(201);
    expect(pkg.body.data.eventTypes).toEqual(['Wine Tasting', 'Wedding Send-off']);

    const id = added.body.data._id as string;
    expect((await ev('patch', `/admin/event-types/${id}`, { name: 'Wine Tasting' })).status).toBe(409);
    expect((await ev('patch', `/admin/event-types/${id}`, { name: 'Wedding' })).status).toBe(200);
    expect((await ev('get', `/admin/packages/${pkg.body.data._id}`)).body.data.eventTypes).toEqual(['Wine Tasting', 'Wedding']);

    expect((await ev('delete', `/admin/event-types/${id}`)).status).toBe(200);
    expect((await ev('get', `/admin/packages/${pkg.body.data._id}`)).body.data.eventTypes).toEqual(['Wine Tasting']);
    expect((await ev('delete', `/admin/event-types/${id}`)).status).toBe(404);
    expect((await ev('patch', `/admin/event-types/${'a'.repeat(24)}`, { name: 'Nope' })).status).toBe(404);
  });

  it('is for admins only', async () => {
    const customer = await makeUser('customer');
    expect((await request(server).get('/admin/event-types').set('Authorization', customer.auth)).status).toBe(403);
    expect((await request(server).get('/admin/event-types')).status).toBe(401);
  });
});
