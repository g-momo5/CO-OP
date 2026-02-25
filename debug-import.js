console.log('=== Test 1: Direct require ===');
const electron1 = require('electron');
console.log('Type:', typeof electron1);
console.log('Value:', electron1);

console.log('\n=== Test 2: Destructuring ===');
try {
  const { app, BrowserWindow } = require('electron');
  console.log('app:', typeof app);
  console.log('BrowserWindow:', typeof BrowserWindow);
} catch (e) {
  console.error('Error:', e.message);
}

console.log('\n=== Test 3: Access after require ===');
const electron3 = require('electron');
console.log('electron3.app:', typeof electron3.app);
console.log('electron3.BrowserWindow:', typeof electron3.BrowserWindow);
