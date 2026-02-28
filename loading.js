const { ipcRenderer } = require('electron');

const statusLine = document.getElementById('loading-status-line');
const progressFill = document.getElementById('loading-progress-fill');

ipcRenderer.on('startup-status', (_event, payload = {}) => {
  const message = String(payload.message || 'Avvio applicazione...');
  const progressValue = Number.isFinite(payload.progress) ? payload.progress : 0;
  const progress = Math.max(0, Math.min(100, Math.round(progressValue)));
  const level = payload.level === 'warn' || payload.level === 'error' ? payload.level : 'info';

  if (statusLine) {
    statusLine.textContent = message;
    statusLine.classList.remove('is-warn', 'is-error');

    if (level === 'warn') {
      statusLine.classList.add('is-warn');
    } else if (level === 'error') {
      statusLine.classList.add('is-error');
    }
  }

  if (progressFill) {
    progressFill.style.width = `${progress}%`;
  }
});
