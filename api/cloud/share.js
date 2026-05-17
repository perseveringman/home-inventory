const {
  canAccess,
  cleanHomeId,
  createHomeId,
  handleCloudError,
  hashSecret,
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
    const homeId = cleanHomeId(body.homeId) || createHomeId();
    const homeName = String(body.homeName || '共享 home').trim().slice(0, 80) || '共享 home';
    const snapshot = body.snapshot;
    validateSnapshot(snapshot);

    const existing = await readMeta(homeId);
    const providedToken = parseAccessToken(req, body);
    if (existing && !canAccess(existing, providedToken)) {
      sendJson(res, 403, { error: '这个 home 已经在云端存在，需要本机保存的访问令牌才能更新或重置邀请码' });
      return;
    }

    const now = new Date().toISOString();
    const inviteCode = randomInviteCode();
    const accessToken = existing ? providedToken : randomToken();
    const accessTokenHashes = existing
      ? tokenHashes(existing)
      : [hashSecret(accessToken)];

    await writeSnapshot(homeId, {
      ...snapshot,
      home: snapshot.home ? { ...snapshot.home, id: homeId, name: homeName } : {
        id: homeId,
        name: homeName,
        kind: 'user',
        createdAt: Date.now(),
      },
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
