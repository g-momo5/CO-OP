console.log('process.versions:', process.versions);
console.log('process.type:', process.type);
console.log('process.electronBinding:', typeof process.electronBinding);

// Try different ways to get Electron
try {
  const electron1 = require('electron');
  console.log('require("electron"):', typeof electron1);
} catch (e) {
  console.log('require("electron") error:', e.message);
}

// Check if there's a different way
if (process.electronBinding) {
  console.log('electronBinding is available!');
}
