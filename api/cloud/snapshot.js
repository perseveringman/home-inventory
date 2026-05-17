const {
  canAccess,
  cleanHomeId,
  handleCloudError,
  normalizeSnapshotHomeId,
  parseAccessToken,
  publicMeta,
  readJson,
  readMeta,
  readSnapshot,
  sendJson,
  validateSnapshot,
  writeMeta,
  writeSnapshot,
} = require('./_shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = req.method === 'POST' ? await readJson(req) : {};
    const query = new URL(req.url, 'https://home-inventory.local').searchParams;
    const homeId = cleanHomeId(body.homeId || query.get('homeId'));
    if (!homeId) {
      sendJson(res, 400, { error: 'homeId 不合法' });
      return;
    }
    if (homeId === 'home-demo') {
      sendJson(res, 400, { error: '示例 home 不能同步云端' });
      return;
    }

    const meta = await readMeta(homeId);
    if (!meta) {
      sendJson(res, 404, { error: '没有找到这个云端 home' });
      return;
    }

    const token = parseAccessToken(req, body);
    if (!canAccess(meta, token)) {
      sendJson(res, 403, { error: '没有访问这个 home 的权限' });
      return;
    }

    if (req.method === 'GET') {
      const snapshot = await readSnapshot(homeId);
      sendJson(res, 200, {
        ...publicMeta(meta),
        snapshot,
      });
      return;
    }

    const snapshot = body.snapshot;
    validateSnapshot(snapshot);
    if (snapshot.home?.kind === 'demo' || snapshot.home?.id === 'home-demo') {
      sendJson(res, 400, { error: '示例 home 不能同步云端' });
      return;
    }
    const now = new Date().toISOString();
    await writeSnapshot(homeId, {
      ...normalizeSnapshotHomeId(snapshot, homeId, body.homeName || snapshot.home?.name || meta.homeName),
      exportedAt: now,
    });
    const nextMeta = {
      ...meta,
      homeName: String(body.homeName || snapshot.home?.name || meta.homeName || '共享 home')
        .trim()
        .slice(0, 80),
      updatedAt: now,
      snapshotUpdatedAt: now,
    };
    await writeMeta(nextMeta);
    sendJson(res, 200, publicMeta(nextMeta));
  } catch (err) {
    handleCloudError(res, err);
  }
};
