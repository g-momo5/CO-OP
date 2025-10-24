# Coop2 Gas Station Management System

Sistema di gestione per stazioni di servizio - محطة بنزين سمنود - الجمعية التعاونية للبترول

## Caratteristiche

- 📊 Gestione fatture carburanti e oli
- 💰 Calcolo automatico profitti e tasse
- 📈 Dashboard con grafici e statistiche
- 🏪 Gestione magazzino oli
- 💾 Backup e ripristino dati
- 🔄 Aggiornamenti automatici via GitHub

## Installazione

### Prerequisiti

- Node.js (versione 18 o superiore)
- npm o yarn

### Setup

1. Clona il repository:
```bash
git clone https://github.com/YOUR_USERNAME/coop2.git
cd coop2
```

2. Installa le dipendenze:
```bash
npm install
```

3. Avvia l'applicazione:
```bash
npm start
```

## Build

### Build per il sistema corrente
```bash
npm run build
```

### Build per Mac
```bash
npm run build:mac
```

### Build per Windows
```bash
npm run build:win
```

### Build per Linux
```bash
npm run build:linux
```

## Sistema di Aggiornamenti Automatici

L'applicazione include un sistema di aggiornamenti automatici basato su GitHub Releases.

### Come funziona

1. Al primo avvio, l'app controlla automaticamente se ci sono aggiornamenti disponibili su GitHub
2. Se è disponibile una nuova versione, viene mostrata una notifica all'utente
3. L'utente può scegliere di:
   - Scaricare l'aggiornamento immediatamente
   - Rimandare a più tardi
4. Dopo il download, l'aggiornamento viene installato al prossimo riavvio dell'app

### Creare una nuova release

1. Aggiorna il numero di versione in `package.json`:
```json
{
  "version": "1.1.0"
}
```

2. Commit e push delle modifiche:
```bash
git add .
git commit -m "Release v1.1.0"
git push
```

3. Crea e pusha un tag:
```bash
git tag v1.1.0
git push origin v1.1.0
```

4. GitHub Actions creerà automaticamente:
   - Build per Mac, Windows e Linux
   - Una release su GitHub con i file binari allegati

### Configurazione GitHub

Prima di utilizzare il sistema di aggiornamenti, devi:

1. Creare un repository su GitHub
2. Modificare `package.json` sostituendo `YOUR_USERNAME` con il tuo username GitHub:
```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_USERNAME/coop2.git"
  },
  "build": {
    "publish": {
      "provider": "github",
      "owner": "YOUR_USERNAME",
      "repo": "coop2"
    }
  }
}
```

3. Abilitare GitHub Actions nel repository (Settings → Actions → Allow all actions)

## Database

L'applicazione supporta due tipi di database:

### SQLite (predefinito)
- Database locale salvato in `gas-station.db`
- Non richiede configurazione
- Ideale per uso singolo

### PostgreSQL (opzionale)
- Supporto per Supabase
- Configurare `USE_POSTGRESQL = true` in `main.js`
- Richiede configurazione delle credenziali

## Struttura del Progetto

```
coop2/
├── main.js              # Processo principale Electron
├── renderer.js          # Logica frontend
├── index.html           # Interfaccia utente
├── styles.css           # Stili
├── package.json         # Configurazione e dipendenze
├── .github/
│   └── workflows/
│       └── release.yml  # GitHub Actions workflow
└── dist/               # Build output (generato)
```

## Tecnologie Utilizzate

- **Electron** - Framework desktop
- **electron-updater** - Sistema aggiornamenti
- **electron-builder** - Build e packaging
- **SQLite3** - Database locale
- **PostgreSQL** - Database remoto (opzionale)
- **Chart.js** - Grafici e visualizzazioni
- **jsPDF** - Generazione PDF

## Licenza

ISC

## Supporto

Per bug e richieste di funzionalità, apri una issue su GitHub.
