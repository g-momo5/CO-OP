const { app, BrowserWindow } = require('electron');

console.log('App imported:', typeof app);
console.log('BrowserWindow imported:', typeof BrowserWindow);

if (app) {
  console.log('SUCCESS: app is defined');
  app.whenReady().then(() => {
    console.log('App ready!');
    app.quit();
  });
} else {
  console.log('ERROR: app is undefined');
  process.exit(1);
}
