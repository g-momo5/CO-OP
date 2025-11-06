const { app, BrowserWindow } = require('electron');

console.log('app type:', typeof app);
console.log('app exists:', app ? 'YES' : 'NO');

if (app) {
  app.whenReady().then(() => {
    console.log('App ready!');
    app.quit();
  });
} else {
  console.log('ERROR: app is undefined!');
  process.exit(1);
}
