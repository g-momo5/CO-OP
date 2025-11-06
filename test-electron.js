const { app, BrowserWindow } = require('electron');
console.log('app type:', typeof app);
console.log('App loaded successfully!');

app.whenReady().then(() => {
  console.log('App is ready');
  app.quit();
});
