// Test Electron import
console.log('Testing Electron import...');

try {
  const electron = require('electron');
  console.log('Electron module:', typeof electron);
  console.log('Electron keys:', Object.keys(electron).slice(0, 10));

  const { app, BrowserWindow, ipcMain, dialog } = electron;
  console.log('app:', typeof app);
  console.log('BrowserWindow:', typeof BrowserWindow);
  console.log('ipcMain:', typeof ipcMain);
  console.log('dialog:', typeof dialog);

  if (app) {
    console.log('App version:', app.getVersion());
  } else {
    console.log('ERROR: app is undefined!');
  }
} catch (error) {
  console.error('Error importing Electron:', error);
}
