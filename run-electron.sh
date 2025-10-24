#!/bin/bash

# Salva il percorso di Electron prima di rinominare
ELECTRON_PATH="./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

# Rinomina temporaneamente la cartella electron per evitare conflitti
mv node_modules/electron node_modules/.electron-hidden

# Esegui Electron
"node_modules/.electron-hidden/dist/Electron.app/Contents/MacOS/Electron" . &
ELECTRON_PID=$!

# Aspetta un momento e poi ripristina
sleep 2
mv node_modules/.electron-hidden node_modules/electron

# Aspetta che Electron termini
wait $ELECTRON_PID
