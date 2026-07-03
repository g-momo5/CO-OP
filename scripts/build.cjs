const { spawnSync } = require('child_process');

if (process.env.VERCEL) {
  console.log('Skipping Electron build on Vercel; mobile read-only app uses static files and serverless API.');
  process.exit(0);
}

const result = spawnSync('electron-builder', {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

process.exit(result.status || 0);
