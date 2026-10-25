import { MAX_SIGNATURE_BYTES } from '../config/agreement';

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Is this string a PNG data URL small enough to store?
 *
 * The signature is rendered back as `<img src>` in the admin console, so it has to be
 * exactly what it claims to be. Checking the prefix alone would let anything base64 in
 * (an SVG with script, an HTML blob); decoding and checking the PNG signature bytes
 * rules that out. Returns the byte size, or throws a plain Error with a message safe to
 * show the caller.
 */
export function assertPngDataUrl(value: string): number {
  const match = PNG_DATA_URL.exec(value);
  if (!match) throw new Error('The signature must be a PNG image');

  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length > MAX_SIGNATURE_BYTES) throw new Error('The signature image is too large');
  if (bytes.length < PNG_MAGIC.length || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new Error('The signature must be a PNG image');
  }
  return bytes.length;
}
