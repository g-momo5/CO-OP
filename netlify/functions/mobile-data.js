const { handleMobileDataRequest } = require('../../mobile-server/mobile-data-core');

exports.handler = async (event) => handleMobileDataRequest({
  method: event.httpMethod,
  query: event.queryStringParameters || {},
  headers: event.headers || {}
});
