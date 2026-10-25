import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import app from '../../src/app';
import { uploadDir } from '../../src/config/env';
import { VehicleClass } from '../../src/models/VehicleClass';
import * as vehicles from '../../src/modules/vehicle/vehicle.service';
import { listen, makeUser, resetData, seedCatalogue, startDatabase, stopDatabase, TINY_PNG } from './harness';

const http = listen(app);
const server = http.server;

const png = Buffer.from(TINY_PNG.split(',')[1], 'base64');
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

let admin: { id: string; auth: string };
let classId: string;

const upload = (data: Buffer, name = 'car.png', auth = admin.auth, id = classId) =>
  request(server)
    .post(`/admin/vehicle-classes/${id}/images`)
    .set('Authorization', auth)
    .attach('file', data, name);

const filesOnDisk = () => {
  const dir = path.join(uploadDir, 'vehicles');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.endsWith('.part')) : [];
};

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
  // One test deletes its class, so every test starts from a freshly seeded catalogue.
  await VehicleClass.deleteMany({});
  await vehicles.seedDefaults();
  const sedan = await VehicleClass.findOne({ value: 'sedan' });
  classId = String(sedan!._id);
  await VehicleClass.updateOne({ _id: classId }, { $set: { images: [] } });
});

describe('vehicle photo upload', () => {
  it('stores the file, returns an absolute url and serves it with safe headers', async () => {
    const res = await upload(png);
    expect(res.status).toBe(201);
    const photo = res.body.data.images[0];
    expect(photo.src).toMatch(/^http:\/\/api\.test\/uploads\/vehicles\/[0-9a-f-]{36}\.png$/);
    expect(filesOnDisk()).toHaveLength(1);

    const served = await request(server).get(new URL(photo.src).pathname);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toContain("default-src 'none'");
    expect(Buffer.from(served.body)).toEqual(png);
  });

  it('keeps a relative path in the database', async () => {
    await upload(png);
    const row = await VehicleClass.findById(classId).lean();
    expect(row!.images[0].src).toMatch(/^\/uploads\/vehicles\//);
  });

  it('accepts a jpeg', async () => {
    const res = await upload(jpeg, 'x.jpg');
    expect(res.status).toBe(201);
  });

  it('judges the bytes, not the file name', async () => {
    const res = await upload(Buffer.from('<script>alert(1)</script>'), 'evil.png');
    expect(res.status).toBe(400);
    expect(filesOnDisk()).toHaveLength(0);
  });

  it('rejects a file over 5 MB', async () => {
    const big = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const res = await upload(big);
    expect(res.status).toBe(413);
    expect(filesOnDisk()).toHaveLength(0);
  });

  it('asks for a file when none is sent', async () => {
    const res = await request(server)
      .post(`/admin/vehicle-classes/${classId}/images`)
      .set('Authorization', admin.auth);
    expect(res.status).toBe(400);
  });

  it('allows ten photos and refuses the eleventh', async () => {
    for (let i = 0; i < 10; i += 1) expect((await upload(png)).status).toBe(201);
    const res = await upload(png);
    expect(res.status).toBe(409);
    expect(filesOnDisk()).toHaveLength(10);
  });

  it('is for admins only', async () => {
    const customer = await makeUser('customer');
    expect((await upload(png, 'a.png', customer.auth)).status).toBe(403);
    expect((await upload(png, 'a.png', '')).status).toBe(401);
    expect(filesOnDisk()).toHaveLength(0);
  });

  it('does not leave a file behind for an unknown class', async () => {
    const res = await upload(png, 'a.png', admin.auth, '5f9d88b8b54764421b7156c9');
    expect(res.status).toBe(404);
    expect(filesOnDisk()).toHaveLength(0);
  });
});

describe('editing and removing photos', () => {
  it('updates the caption and moves a photo to the front as the cover', async () => {
    await upload(png);
    const second = (await upload(png)).body.data.images[1];
    const key = second.key as string;

    const res = await request(server)
      .patch(`/admin/vehicle-classes/${classId}/images/${key}`)
      .set('Authorization', admin.auth)
      .send({ caption: 'Interior', cover: true });
    expect(res.status).toBe(200);
    expect(res.body.data.images[0]).toMatchObject({ key, caption: 'Interior' });
  });

  it('removes the photo and its file', async () => {
    const key = (await upload(png)).body.data.images[0].key as string;
    const res = await request(server)
      .delete(`/admin/vehicle-classes/${classId}/images/${key}`)
      .set('Authorization', admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.images).toHaveLength(0);
    expect(filesOnDisk()).toHaveLength(0);
  });

  it('refuses a key that is not one of ours (no path tricks)', async () => {
    const res = await request(server)
      .delete(`/admin/vehicle-classes/${classId}/images/..%2F..%2Fpackage.json`)
      .set('Authorization', admin.auth);
    expect([400, 404]).toContain(res.status);
  });

  it('removes the files when the class is deleted', async () => {
    await upload(png);
    await upload(jpeg, 'b.jpg');
    const res = await request(server).delete(`/admin/vehicle-classes/${classId}`).set('Authorization', admin.auth);
    expect(res.status).toBe(200);
    expect(filesOnDisk()).toHaveLength(0);
  });

  it('removes the files of photos dropped by a list update', async () => {
    await upload(png);
    const res = await request(server)
      .patch(`/admin/vehicle-classes/${classId}`)
      .set('Authorization', admin.auth)
      .send({ images: [] });
    expect(res.status).toBe(200);
    expect(filesOnDisk()).toHaveLength(0);
  });
});
