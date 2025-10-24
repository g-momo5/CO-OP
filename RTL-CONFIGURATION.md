# Configurazione RTL e Arabo Automatica

## Panoramica

Il programma è ora configurato per supportare automaticamente il formato RTL (Right-to-Left) e la lingua araba. Non è più necessario specificare manualmente queste impostazioni ogni volta.

## File di Configurazione

### `rtl-config.js`
Questo file contiene tutte le configurazioni globali per il supporto RTL e arabo:

- **Configurazioni di base**: Lingua araba, direzione RTL, allineamento del testo
- **Font arabo**: Noto Naskh Arabic come font predefinito
- **Formattazione numeri**: Formato arabo per numeri e valute
- **Formattazione date**: Formato arabo per le date
- **Configurazioni grafici**: Supporto RTL per Chart.js
- **Configurazioni input**: Gestione speciale per input numerici e date

### Funzionalità Automatiche

1. **Inizializzazione automatica**: Le configurazioni RTL vengono applicate automaticamente quando il DOM è pronto
2. **Osservatore DOM**: Monitora i nuovi elementi aggiunti e applica automaticamente le configurazioni RTL
3. **Formattazione numeri**: I numeri vengono formattati secondo le convenzioni arabe
4. **Formattazione valute**: Le valute vengono mostrate con il simbolo "جنيه" e formato arabo
5. **Formattazione date**: Le date vengono mostrate in formato arabo

## Configurazioni CSS

### `styles.css`
Il file CSS è stato aggiornato con:

- **Override globali RTL**: Tutti gli elementi usano RTL per default
- **Eccezioni specifiche**: Input numerici e date usano LTR per una migliore usabilità
- **Font arabo**: Tutti gli elementi di testo usano Noto Naskh Arabic
- **Layout RTL**: Flexbox e grid sono configurati per RTL

## Configurazioni JavaScript

### `renderer.js`
Il file JavaScript principale include:

- **Supporto grafici RTL**: Chart.js configurato per RTL
- **Formattazione automatica**: Funzioni per formattare numeri, valute e date in arabo
- **Applicazione automatica**: Le configurazioni RTL vengono applicate a tutti gli elementi

## Funzioni Disponibili

### Formattazione
- `formatArabicNumber(number)`: Formatta i numeri in arabo
- `formatArabicCurrency(amount)`: Formatta le valute in arabo
- `formatArabicDate(dateString)`: Formatta le date in arabo

### Configurazione
- `initializeRTLConfig()`: Inizializza tutte le configurazioni RTL
- `applyRTLToNewElement(element)`: Applica RTL a un elemento specifico
- `applyRTLFormatting()`: Applica la formattazione araba a tutti gli elementi

## Come Funziona

1. **Caricamento**: Quando la pagina si carica, `rtl-config.js` viene eseguito automaticamente
2. **Configurazione**: Tutti gli elementi esistenti vengono configurati per RTL
3. **Monitoraggio**: Un osservatore DOM monitora i nuovi elementi
4. **Applicazione automatica**: I nuovi elementi ricevono automaticamente le configurazioni RTL
5. **Formattazione**: I valori numerici e le date vengono formattati in arabo

## Vantaggi

- ✅ **Automatico**: Non serve più specificare RTL manualmente
- ✅ **Completo**: Supporta tutti gli elementi dell'interfaccia
- ✅ **Dinamico**: Funziona anche con elementi aggiunti dinamicamente
- ✅ **Consistente**: Mantiene la formattazione araba in tutto il programma
- ✅ **Ottimizzato**: Input numerici e date rimangono usabili

## Note Tecniche

- I grafici Chart.js necessitano di configurazioni speciali per RTL
- Gli input numerici e date usano LTR per una migliore usabilità
- Il font Noto Naskh Arabic è caricato da Google Fonts
- Le configurazioni sono applicate con `!important` per garantire priorità

## Manutenzione

Per aggiungere supporto RTL a nuovi elementi:

1. Aggiungi la classe CSS appropriata
2. Le configurazioni RTL verranno applicate automaticamente
3. Per elementi speciali, usa `applyRTLToNewElement(element)`

Il sistema è progettato per essere completamente automatico e non richiede interventi manuali.
