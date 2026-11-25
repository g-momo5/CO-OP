const { handleMobileSettingsRequest } = require('../../mobile-server/mobile-settings-core');

exports.handler = (event) => handleMobileSettingsRequest({
  method: event.httpMethod,
  query: event.queryStringParameters || {},
  headers: event.headers || {},
  body: event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body
});
