const { app, BrowserWindow } = require('electron');

console.log('Electron app:', typeof app);

app.whenReady().then(() => {
  console.log('App is ready!');
  const win = new BrowserWindow({ width: 800, height: 600 });
  win.loadURL('data:text/html,<h1>Test</h1>');

  setTimeout(() => {
    app.quit();
  }, 2000);
});
