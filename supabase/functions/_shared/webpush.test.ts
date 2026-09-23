// Verifies our Web Push encryption by decrypting it the way a browser does (RFC 8291).
import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, vapidAuthorization } from './webpush.ts';

const enc = new TextEncoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

describe('web push', () => {
  it('round-trips aes128gcm like a user agent', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const msg = JSON.stringify({ title: 'Dentist', body: 'Mâine la 10' });

    const body = await encryptPayload(enc.encode(msg), { p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(auth) });

    // --- user agent side ---
    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
    const idlen = body[20];
    const asPublic = body.slice(21, 21 + idlen);
    const cipher = body.slice(21 + idlen);
    expect(rs).toBe(4096);
    expect(idlen).toBe(65);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
    const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
    const ikm = await hkdf(auth, shared, info, 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
    expect(plain[plain.length - 1]).toBe(2);
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe(msg);
  });

  it('signs a verifiable VAPID JWT', async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'mailto:test@example.com' });
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, p, s] = token.split('.');
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(p)))).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:test@example.com' });
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(s), enc.encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });
});
