const {
  cleanHomeId,
  handleCloudError,
  hashSecret,
  normalizeInviteCode,
  publicMeta,
  randomToken,
  readJson,
  readMeta,
  readSnapshot,
  safeHashEqual,
  sendJson,
  tokenHashes,
  writeMeta,
} = require('./_shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = await readJson(req);
    const homeId = cleanHomeId(body.homeId);
    if (!homeId) {
      sendJson(res, 400, { error: 'homeId 不合法' });
      return;
    }

    const meta = await readMeta(homeId);
    if (!meta) {
      sendJson(res, 404, { error: '没有找到这个云端 home' });
      return;
    }

    const codeHash = hashSecret(normalizeInviteCode(body.inviteCode));
    if (!safeHashEqual(meta.inviteCodeHash, codeHash)) {
      sendJson(res, 403, { error: '邀请码不正确' });
      return;
    }

    const snapshot = await readSnapshot(homeId);
    if (!snapshot) {
      sendJson(res, 404, { error: '这个 home 还没有云端快照' });
      return;
    }

    const accessToken = randomToken();
    const hashes = tokenHashes(meta);
    hashes.push(hashSecret(accessToken));
    const nextMeta = {
      ...meta,
      accessTokenHashes: hashes.slice(-32),
      updatedAt: new Date().toISOString(),
    };
    delete nextMeta.accessTokenHash;
    await writeMeta(nextMeta);

    sendJson(res, 200, {
      ...publicMeta(nextMeta),
      accessToken,
      snapshot,
    });
  } catch (err) {
    handleCloudError(res, err);
  }
};
