# Stack Tecnologico del Progetto

## Panoramica
Applicazione desktop gestionale sviluppata con **Electron + Node.js**, con interfaccia web (HTML/CSS/JS) e database ibrido online/offline.

## Frontend (Renderer)
- **HTML5 + CSS3 + JavaScript vanilla** (nessun framework SPA come React/Vue).
- UI in arabo con supporto **RTL** (`dir="rtl"` + `rtl-config.js`).
- **Chart.js** per grafici e dashboard.
- **jsPDF** + **FileSaver.js** per export e download report PDF.

## Desktop App Layer
- **Electron** (processo principale in `main.js`, renderer in `renderer.js`).
- Comunicazione interna tramite **IPC** (`ipcMain` / `ipcRenderer`).
- Finestre native (`BrowserWindow`) con splash screen e gestione stato avvio.

## Backend Locale (Node nel Main Process)
- Logica applicativa e orchestrazione dati nel processo main.
- Moduli principali:
  - `database-manager.js`: accesso unificato ai database.
  - `sync-manager.js`: sincronizzazione dati tra offline e online.

## Persistenza Dati
- **SQLite locale** con `better-sqlite3` (fallback/offline-first).
- **PostgreSQL** remoto con driver `pg` (compatibile Supabase).
- Meccanismo di **sync queue** per riallineare le operazioni quando torna la connessione.

## Update, Build e Distribuzione
- **electron-updater** + **electron-log** per aggiornamenti automatici via GitHub Releases.
- **electron-builder** per packaging multi-piattaforma:
  - macOS (`dmg`, `zip`)
  - Windows (`nsis`, `portable`)
  - Linux (`AppImage`, `deb`)

## Dipendenze Chiave
- Runtime: `better-sqlite3`, `pg`, `chart.js`, `jspdf`, `file-saver`, `electron-updater`, `electron-log`
- Dev/Build: `electron`, `electron-builder`, `@electron/rebuild`, `@electron/remote`
