const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.env.VERCEL) {
  const root = path.resolve(__dirname, '..');
  const publicDir = path.join(root, 'public');

  fs.rmSync(publicDir, { recursive: true, force: true });
  fs.mkdirSync(publicDir, { recursive: true });
  fs.cpSync(path.join(root, 'mobile'), path.join(publicDir, 'mobile'), { recursive: true });
  fs.cpSync(path.join(root, 'mobile-assets'), path.join(publicDir, 'mobile-assets'), { recursive: true });
  fs.mkdirSync(path.join(publicDir, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(root, 'assets', 'logo_cpc.png'), path.join(publicDir, 'assets', 'logo_cpc.png'));
  fs.copyFileSync(path.join(root, 'mobile', 'index.html'), path.join(publicDir, 'index.html'));

  console.log('Prepared Vercel public output for the mobile read-only app.');
  process.exit(0);
}

const result = spawnSync('electron-builder', {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

process.exit(result.status || 0);
