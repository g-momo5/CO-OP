console.log('Starting minimal test...');
const electron = require('electron');
console.log('Electron loaded:', typeof electron);
console.log('Electron keys:', Object.keys(electron).slice(0, 10));
const { app } = electron;
console.log('App:', typeof app);
if (app && app.whenReady) {
  app.whenReady().then(() => {
    console.log('App ready!');
    app.quit();
  });
} else {
  console.log('ERROR: app is undefined or has no whenReady method');
  process.exit(1);
}
