/**
 * Configurazione globale RTL e Arabo
 * Questo file imposta automaticamente tutte le configurazioni necessarie
 * per il supporto completo della lingua araba e del formato RTL
 */

// Configurazione globale RTL e Arabo
const RTL_CONFIG = {
  // Impostazioni di base
  language: 'ar',
  direction: 'rtl',
  textAlign: 'right',
  
  // Font arabo predefinito
  fontFamily: 'Noto Naskh Arabic, Arial, sans-serif',
  
  // Formato numeri arabo
  numberFormat: {
    locale: 'ar-EG',
    currency: 'EGP',
    currencySymbol: 'جنيه'
  },
  
  // Formato date arabo
  dateFormat: {
    locale: 'ar-EG',
    format: 'dd/mm/yyyy'
  },
  
  // Configurazioni per i grafici
  chartConfig: {
    direction: 'ltr', // I grafici necessitano LTR per il rendering corretto
    fontFamily: 'Noto Naskh Arabic'
  },
  
  // Configurazioni per input numerici
  numberInputs: {
    direction: 'ltr', // I numeri sono meglio allineati a sinistra
    textAlign: 'left'
  },
  
  // Configurazioni per input date
  dateInputs: {
    direction: 'ltr', // Le date funzionano meglio in LTR
    textAlign: 'left'
  }
};

/**
 * Inizializza le configurazioni RTL e Arabo
 */
function initializeRTLConfig() {
  // Imposta gli attributi del documento
  document.documentElement.setAttribute('lang', RTL_CONFIG.language);
  document.documentElement.setAttribute('dir', RTL_CONFIG.direction);
  document.documentElement.style.direction = RTL_CONFIG.direction;
  document.documentElement.style.textAlign = RTL_CONFIG.textAlign;
  
  // Imposta il font per tutto il body
  document.body.style.fontFamily = RTL_CONFIG.fontFamily;
  document.body.style.direction = RTL_CONFIG.direction;
  document.body.style.textAlign = RTL_CONFIG.textAlign;
  
  // Configura tutti gli elementi con classe specifica
  configureRTLElements();
  
  // Configura i form e gli input
  configureFormElements();
  
  // Configura i grafici
  configureCharts();
  
  console.log('✅ Configurazione RTL e Arabo inizializzata con successo');
}

/**
 * Configura tutti gli elementi RTL
 */
function configureRTLElements() {
  // Configura tutti i container principali
  const containers = document.querySelectorAll('.app-container, .main-content, .screen, .header, .bottom-navigation');
  containers.forEach(container => {
    container.style.direction = RTL_CONFIG.direction;
    container.style.textAlign = RTL_CONFIG.textAlign;
  });
  
  // Configura tutti i titoli e testi
  const textElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div, label');
  textElements.forEach(element => {
    if (!element.classList.contains('chart-container') && !element.classList.contains('chart-wrapper')) {
      element.style.direction = RTL_CONFIG.direction;
      element.style.textAlign = RTL_CONFIG.textAlign;
      element.style.fontFamily = RTL_CONFIG.fontFamily;
    }
  });
  
  // Configura i bottoni
  const buttons = document.querySelectorAll('button, .btn, .nav-btn');
  buttons.forEach(button => {
    button.style.direction = RTL_CONFIG.direction;
    button.style.textAlign = 'center';
    button.style.fontFamily = RTL_CONFIG.fontFamily;
  });
}

/**
 * Configura gli elementi del form
 */
function configureFormElements() {
  // Configura tutti gli input di testo
  const textInputs = document.querySelectorAll('input[type="text"], input[type="email"], textarea, select');
  textInputs.forEach(input => {
    input.style.direction = RTL_CONFIG.direction;
    input.style.textAlign = RTL_CONFIG.textAlign;
    input.style.fontFamily = RTL_CONFIG.fontFamily;
  });
  
  // Configura gli input numerici (LTR per i numeri)
  const numberInputs = document.querySelectorAll('input[type="number"]');
  numberInputs.forEach(input => {
    input.style.direction = RTL_CONFIG.numberInputs.direction;
    input.style.textAlign = RTL_CONFIG.numberInputs.textAlign;
    input.style.fontFamily = RTL_CONFIG.fontFamily;
  });
  
  // Configura gli input date (LTR per le date)
  const dateInputs = document.querySelectorAll('input[type="date"]');
  dateInputs.forEach(input => {
    input.style.direction = RTL_CONFIG.dateInputs.direction;
    input.style.textAlign = RTL_CONFIG.dateInputs.textAlign;
    input.style.fontFamily = RTL_CONFIG.fontFamily;
  });
  
  // Configura le tabelle
  const tables = document.querySelectorAll('table, th, td');
  tables.forEach(element => {
    element.style.direction = RTL_CONFIG.direction;
    element.style.textAlign = RTL_CONFIG.textAlign;
    element.style.fontFamily = RTL_CONFIG.fontFamily;
  });
}

/**
 * Configura i grafici per il supporto RTL
 */
function configureCharts() {
  // I grafici Chart.js necessitano di configurazioni speciali per RTL
  if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family = RTL_CONFIG.chartConfig.fontFamily;
    Chart.defaults.rtl = true;
  }
}

/**
 * Formatta i numeri secondo le convenzioni arabe
 */
function formatArabicNumber(number) {
  return new Intl.NumberFormat(RTL_CONFIG.numberFormat.locale).format(number);
}

/**
 * Formatta la valuta secondo le convenzioni arabe
 */
function formatArabicCurrency(amount) {
  return new Intl.NumberFormat(RTL_CONFIG.numberFormat.locale, {
    style: 'currency',
    currency: RTL_CONFIG.numberFormat.currency
  }).format(amount);
}

/**
 * Formatta le date secondo le convenzioni arabe
 */
function formatArabicDate(date) {
  return new Intl.DateTimeFormat(RTL_CONFIG.dateFormat.locale).format(new Date(date));
}

/**
 * Applica le configurazioni RTL a nuovi elementi dinamici
 */
function applyRTLToNewElement(element) {
  if (element) {
    // Applica le configurazioni base
    element.style.direction = RTL_CONFIG.direction;
    element.style.textAlign = RTL_CONFIG.textAlign;
    element.style.fontFamily = RTL_CONFIG.fontFamily;
    
    // Configurazioni specifiche per tipo di elemento
    if (element.tagName === 'INPUT') {
      if (element.type === 'number') {
        element.style.direction = RTL_CONFIG.numberInputs.direction;
        element.style.textAlign = RTL_CONFIG.numberInputs.textAlign;
      } else if (element.type === 'date') {
        element.style.direction = RTL_CONFIG.dateInputs.direction;
        element.style.textAlign = RTL_CONFIG.dateInputs.textAlign;
      }
    } else if (element.tagName === 'BUTTON') {
      element.style.textAlign = 'center';
    }
  }
}

/**
 * Osserva i cambiamenti nel DOM e applica RTL ai nuovi elementi
 */
function setupRTLObserver() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          applyRTLToNewElement(node);
          
          // Applica anche ai figli
          const children = node.querySelectorAll('*');
          children.forEach(child => applyRTLToNewElement(child));
        }
      });
    });
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Inizializza automaticamente quando il DOM è pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeRTLConfig();
    setupRTLObserver();
  });
} else {
  initializeRTLConfig();
  setupRTLObserver();
}

// Esporta le funzioni per uso globale
window.RTL_CONFIG = RTL_CONFIG;
window.initializeRTLConfig = initializeRTLConfig;
window.formatArabicNumber = formatArabicNumber;
window.formatArabicCurrency = formatArabicCurrency;
window.formatArabicDate = formatArabicDate;
window.applyRTLToNewElement = applyRTLToNewElement;
