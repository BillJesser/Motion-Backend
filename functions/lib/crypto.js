// Minimal utilities for password hashing (PBKDF2) and JWT HS256 sign/verify
const crypto = require('crypto');

const ITERATIONS = 100_000;
const KEYLEN = 32;
const DIGEST = 'sha256';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST);
  return { salt, hash: derived.toString('hex') };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  // constant-time compare
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function base64url(input) {
  return Buffer.from(JSON.stringify(input))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload, secret, options = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    iat: now,
    ...(options.expiresIn ? { exp: now + options.expiresIn } : {}),
    ...payload
  };
  const headerB64 = base64url(header);
  const payloadB64 = base64url(fullPayload);
  const data = `${headerB64}.${payloadB64}`;
  const sig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${sig}`;
}

module.exports = { hashPassword, verifyPassword, signJwt };

