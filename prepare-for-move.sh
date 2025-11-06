#!/bin/bash
# Script per preparare la cartella coop2 per lo spostamento
# Sposta solo i file essenziali, escludendo node_modules, dist e .git

DEST_DIR="${1:-../coop2-minimal}"

echo "Preparazione cartella essenziale per spostamento..."
echo "Destinazione: $DEST_DIR"

# Crea la cartella di destinazione
mkdir -p "$DEST_DIR"

# Copia file essenziali
echo "📁 Copiando file sorgente..."
cp -v main.js renderer.js index.html styles.css rtl-config.js "$DEST_DIR/" 2>/dev/null

# Copia file HTML aggiuntivi
echo "📄 Copiando file HTML..."
cp -v *.html "$DEST_DIR/" 2>/dev/null | grep -v "Skipping"

# Copia configurazione
echo "⚙️ Copiando configurazione..."
cp -v package.json package-lock.json dev-app-update.yml "$DEST_DIR/" 2>/dev/null

# Copia database (IMPORTANTE!)
echo "💾 Copiando database..."
cp -v coop_database.db "$DEST_DIR/" 2>/dev/null

# Copia assets
echo "🖼️ Copiando assets..."
cp -rv assets "$DEST_DIR/" 2>/dev/null

# Copia documentazione
echo "📚 Copiando documentazione..."
cp -v README.md INSTALLATION.md RTL-CONFIGURATION.md "$DEST_DIR/" 2>/dev/null | grep -v "Skipping"

# Copia altri file utili
echo "📝 Copiando altri file..."
cp -v *.sh *.rtf "$DEST_DIR/" 2>/dev/null | grep -v "Skipping"

# Crea .gitignore nella nuova cartella
echo "📋 Creando .gitignore..."
cp -v .gitignore "$DEST_DIR/" 2>/dev/null

echo ""
echo "✅ Completato! Cartella essenziale creata in: $DEST_DIR"
echo ""
echo "📦 Dimensione approssimativa:"
du -sh "$DEST_DIR" 2>/dev/null
echo ""
echo "⚠️  NOTA: Per ripristinare la cartella completa:"
echo "   1. Sposta la cartella nella nuova posizione"
echo "   2. Esegui: npm install"
echo "   3. (Opzionale) Per la build: npm run build:mac"
echo "   4. (Opzionale) Per clonare il repo: git clone https://github.com/g-momo5/CO-OP.git"



