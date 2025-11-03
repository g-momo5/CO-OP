const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// Download sqlite3 prebuilt binary for Windows
const SQLITE3_VERSION = '5.1.7';
const NAPI_VERSION = '6'; // Most compatible NAPI version

// Try multiple NAPI versions
const napiVersions = ['6', '3'];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function installSqlite3Windows() {
  const sqlite3Dir = path.join(__dirname, 'node_modules', 'sqlite3');
  const prebuildsDir = path.join(sqlite3Dir, 'build', 'Release');

  if (!fs.existsSync(sqlite3Dir)) {
    console.log('sqlite3 not found, skipping...');
    return;
  }

  console.log('Installing sqlite3 prebuilt binaries for Windows...');

  // Ensure directory exists
  if (!fs.existsSync(prebuildsDir)) {
    fs.mkdirSync(prebuildsDir, { recursive: true });
  }

  for (const napiVer of napiVersions) {
    const url = `https://github.com/TryGhost/node-sqlite3/releases/download/v${SQLITE3_VERSION}/napi-v${napiVer}-win32-x64.tar.gz`;
    const tarFile = path.join(__dirname, `sqlite3-win32-x64-napi-v${napiVer}.tar.gz`);

    try {
      console.log(`Trying to download from: ${url}`);
      await downloadFile(url, tarFile);

      // Extract the tar.gz file
      console.log('Extracting...');
      execSync(`tar -xzf "${tarFile}" -C "${prebuildsDir}"`, { stdio: 'inherit' });

      console.log(`Successfully installed sqlite3 Windows binaries (NAPI v${napiVer})`);

      // Clean up
      fs.unlinkSync(tarFile);
      return;
    } catch (err) {
      console.log(`Failed with NAPI v${napiVer}: ${err.message}`);
      if (fs.existsSync(tarFile)) {
        fs.unlinkSync(tarFile);
      }
    }
  }

  console.error('Failed to download sqlite3 binaries for all NAPI versions');
}

if (require.main === module) {
  installSqlite3Windows().catch(console.error);
}

module.exports = installSqlite3Windows;
