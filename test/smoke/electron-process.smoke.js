console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions.electron);
console.log('process.electronBinding:', typeof process.electronBinding);

if (process.type === 'browser') {
  console.log('\n=== Running in Electron main process ===');
  
  // Try to access Electron APIs through process
  if (typeof process.electronBinding === 'function') {
    console.log('electronBinding is available!');
  }
  
  // Alternative way to get Electron in newer versions
  try {
    const { app } = process._linkedBinding('electron_browser_app');
    console.log('Got app through _linkedBinding!', typeof app);
  } catch (e) {
    console.log('_linkedBinding failed:', e.message);
  }
}
