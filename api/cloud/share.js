const {
  canAccess,
  cleanHomeId,
  createHomeId,
  handleCloudError,
  hashSecret,
  normalizeSnapshotHomeId,
  parseAccessToken,
  publicMeta,
  randomInviteCode,
  randomToken,
  readJson,
  readMeta,
  sendJson,
  tokenHashes,
  validateSnapshot,
  writeMeta,
  writeSnapshot,
} = require('./_shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = await readJson(req);
    const requestedHomeId = cleanHomeId(body.homeId);
    const homeName = String(body.homeName || '共享 home').trim().slice(0, 80) || '共享 home';
    const snapshot = body.snapshot;
    validateSnapshot(snapshot);
    if (snapshot.home?.kind === 'demo' || snapshot.home?.id === 'home-demo' || requestedHomeId === 'home-demo') {
      sendJson(res, 400, { error: '示例 home 不能生成邀请码' });
      return;
    }

    const existing = requestedHomeId ? await readMeta(requestedHomeId) : undefined;
    const providedToken = parseAccessToken(req, body);
    if (existing && !canAccess(existing, providedToken)) {
      sendJson(res, 403, { error: '这个 home 已经在云端存在，需要本机保存的访问令牌才能更新或重置邀请码' });
      return;
    }
    const homeId = existing ? requestedHomeId : createHomeId();

    const now = new Date().toISOString();
    const inviteCode = randomInviteCode();
    const accessToken = existing ? providedToken : randomToken();
    const accessTokenHashes = existing
      ? tokenHashes(existing)
      : [hashSecret(accessToken)];

    await writeSnapshot(homeId, {
      ...normalizeSnapshotHomeId(snapshot, homeId, homeName),
      exportedAt: now,
    });

    const meta = {
      ...(existing || {}),
      version: 1,
      homeId,
      homeName,
      inviteCodeHash: hashSecret(inviteCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()),
      accessTokenHashes,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      snapshotUpdatedAt: now,
      schemaVersion: 3,
    };
    delete meta.accessTokenHash;
    await writeMeta(meta);

    sendJson(res, 200, {
      ...publicMeta(meta),
      inviteCode,
      accessToken,
    });
  } catch (err) {
    handleCloudError(res, err);
  }
};
