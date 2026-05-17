const { hasBlobToken, sendJson } = require('./_shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  sendJson(res, 200, {
    blobConfigured: hasBlobToken(),
    mediaSync: false,
    snapshotMediaMode: 'none',
  });
};
