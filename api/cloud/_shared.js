const crypto = require('crypto');
const { env, readJson, sendJson } = require('../ai/_shared');

const ACCESS = env('HOME_CLOUD_BLOB_ACCESS') === 'public' ? 'public' : 'private';
const SNAPSHOT_SOFT_LIMIT = 3.5 * 1024 * 1024;

async function blobSdk() {
  return import('@vercel/blob');
}

function hasBlobToken() {
  return Boolean(env('BLOB_READ_WRITE_TOKEN'));
}

function secret() {
  return env('HOME_SHARE_SECRET') || env('BLOB_READ_WRITE_TOKEN') || 'home-inventory-local-dev';
}

function hashSecret(value) {
  return crypto.createHmac('sha256', secret()).update(String(value)).digest('hex');
}

function safeHashEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function randomInviteCode() {
  const n = crypto.randomInt(0, 1000000);
  const raw = String(n).padStart(6, '0');
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

function normalizeInviteCode(code) {
  return String(code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function cleanHomeId(value) {
  const id = String(value || '').trim();
  if (/^[a-zA-Z0-9_-]{6,96}$/.test(id)) return id;
  return '';
}

function createHomeId() {
  return `hm_${crypto.randomBytes(9).toString('base64url')}`;
}

function homePath(homeId, file) {
  return `homes/${homeId}/${file}`;
}

function parseAccessToken(req, body) {
  const auth = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return (
    (match && match[1]) ||
    req.headers['x-home-access-token'] ||
    body?.accessToken ||
    ''
  );
}

function tokenHashes(meta) {
  const hashes = Array.isArray(meta?.accessTokenHashes) ? meta.accessTokenHashes : [];
  if (meta?.accessTokenHash) hashes.push(meta.accessTokenHash);
  return hashes.filter(Boolean);
}

function canAccess(meta, token) {
  const hash = hashSecret(token);
  return tokenHashes(meta).some((candidate) => safeHashEqual(candidate, hash));
}

function publicMeta(meta) {
  return {
    homeId: meta.homeId,
    homeName: meta.homeName,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    snapshotUpdatedAt: meta.snapshotUpdatedAt,
    schemaVersion: meta.schemaVersion || 3,
  };
}

async function putJson(path, payload) {
  const { put } = await blobSdk();
  return put(path, JSON.stringify(payload), {
    access: ACCESS,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: 'application/json',
  });
}

async function readJsonBlob(path) {
  const { head } = await blobSdk();
  try {
    const info = await head(path);
    const url = info.downloadUrl || info.url;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Blob read failed: ${response.status}`);
    return response.json();
  } catch (err) {
    if (
      err?.name === 'BlobNotFoundError' ||
      /not found/i.test(err?.message || '')
    ) {
      return undefined;
    }
    throw err;
  }
}

async function readMeta(homeId) {
  return readJsonBlob(homePath(homeId, 'meta.json'));
}

async function writeMeta(meta) {
  await putJson(homePath(meta.homeId, 'meta.json'), meta);
}

async function readSnapshot(homeId) {
  return readJsonBlob(homePath(homeId, 'snapshot.json'));
}

async function writeSnapshot(homeId, snapshot) {
  const raw = JSON.stringify(snapshot);
  if (Buffer.byteLength(raw, 'utf8') > SNAPSHOT_SOFT_LIMIT) {
    const err = new Error('云端快照过大：当前版本只同步结构化数据，请先导出 ZIP 保存照片');
    err.statusCode = 413;
    throw err;
  }
  await putJson(homePath(homeId, 'snapshot.json'), snapshot);
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    const err = new Error('snapshot must be an object');
    err.statusCode = 400;
    throw err;
  }
  for (const key of ['rooms', 'photos', 'cabinets', 'items', 'subscriptions']) {
    if (!Array.isArray(snapshot[key])) {
      const err = new Error(`snapshot.${key} must be an array`);
      err.statusCode = 400;
      throw err;
    }
  }
}

function handleCloudError(res, err) {
  const status = err.statusCode || 500;
  sendJson(res, status, { error: err.message || 'Cloud request failed' });
}

module.exports = {
  canAccess,
  cleanHomeId,
  createHomeId,
  handleCloudError,
  hasBlobToken,
  hashSecret,
  normalizeInviteCode,
  parseAccessToken,
  publicMeta,
  randomInviteCode,
  randomToken,
  readJson,
  readMeta,
  readSnapshot,
  safeHashEqual,
  sendJson,
  tokenHashes,
  validateSnapshot,
  writeMeta,
  writeSnapshot,
};
