import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { uploadDir } from '../src/config/env';
import { deleteImage, detectImage, IMAGE_KEY, ImageRejected, MAX_IMAGE_BYTES, publicImageUrl, saveImage } from '../src/utils/imageStorage';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(40)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)]);

describe('detectImage', () => {
  it('recognises jpeg, png and webp by their bytes', () => {
    expect(detectImage(jpg)?.ext).toBe('jpg');
    expect(detectImage(png)?.ext).toBe('png');
    expect(detectImage(webp)?.ext).toBe('webp');
  });
  it('rejects anything else, whatever it is called', () => {
    expect(detectImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(detectImage(Buffer.from('GIF89a....'))).toBeNull();
    expect(detectImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('saveImage / deleteImage', () => {
  it('writes a uuid-named file under the upload folder and deletes it', async () => {
    const stored = await saveImage('vehicles', png);
    expect(stored.key).toMatch(IMAGE_KEY);
    expect(stored.path).toBe(`/uploads/vehicles/${stored.key}`);
    const file = path.join(uploadDir, 'vehicles', stored.key);
    expect(fs.existsSync(file)).toBe(true);
    await deleteImage('vehicles', stored.key);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('refuses empty, oversize and non-image bytes', async () => {
    await expect(saveImage('vehicles', Buffer.alloc(0))).rejects.toBeInstanceOf(ImageRejected);
    await expect(saveImage('vehicles', Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES)]))).rejects.toMatchObject({ reason: 'too_large' });
    await expect(saveImage('vehicles', Buffer.from('hello world'))).rejects.toMatchObject({ reason: 'not_an_image' });
  });

  it('ignores a missing file and never follows a path-like key', async () => {
    await expect(deleteImage('vehicles', '0b8f7a3e-6d1c-4c52-9a43-1f2e3d4c5b6a.png')).resolves.toBeUndefined();
    const outside = path.join(uploadDir, 'keep.txt');
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(outside, 'x');
    await deleteImage('vehicles', '../keep.txt').catch(() => undefined);
    expect(fs.existsSync(outside)).toBe(true);
  });
});

describe('publicImageUrl', () => {
  it('prefixes our own paths and leaves absolute urls alone', () => {
    expect(publicImageUrl('/uploads/vehicles/a.png')).toBe('http://api.test/uploads/vehicles/a.png');
    expect(publicImageUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
  });
});
