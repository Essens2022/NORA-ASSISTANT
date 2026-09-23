// Generates a VAPID key pair for Web Push (run once; store as function secrets).
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const b64 = (u) => Buffer.from(u).toString('base64url');
console.log(`VAPID_PUBLIC_KEY=${b64(raw)}\nVAPID_PRIVATE_KEY=${jwk.d}`);
