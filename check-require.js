const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  if (id === 'electron') {
    console.log('=== Requiring electron ===');
    console.log('Resolved path:', Module._resolveFilename(id, this));
  }
  return originalRequire.apply(this, arguments);
};

console.log('About to require electron...');
const { app } = require('electron');
console.log('app is:', typeof app);
