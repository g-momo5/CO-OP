const { handleMobileSettingsRequest } = require('../mobile-server/mobile-settings-core');

module.exports = async (req, res) => {
  const response = await handleMobileSettingsRequest({
    method: req.method,
    query: req.query || {},
    headers: req.headers || {},
    body: req.body
  });

  Object.entries(response.headers).forEach(([key, value]) => res.setHeader(key, value));
  res.status(response.statusCode).send(response.body);
};
