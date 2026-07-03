const { handleMobileDataRequest } = require('../mobile-server/mobile-data-core');

module.exports = async (req, res) => {
  const response = await handleMobileDataRequest({
    method: req.method,
    query: req.query || {},
    headers: req.headers || {}
  });

  Object.entries(response.headers || {}).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.status(response.statusCode).send(response.body);
};
