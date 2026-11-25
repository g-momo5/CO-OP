# Vista mobile

Questa vista e separata dall'app Electron. Si apre da browser con:

```text
/m/
```

La vista mobile usa i dati condivisi su PostgreSQL/Supabase. Dal menu della stazione, **الإعدادات** contiene **إدارة المنتجات** e **إدارة العملاء**. Puoi gestire prodotti, prezzi, storico e clienti direttamente dal telefono, anche con il Mac spento. Le modifiche salvate sono disponibili sul desktop al successivo caricamento online.

## Variabili ambiente

Configura queste variabili su Vercel o Netlify:

```text
DATABASE_URL=postgresql://...
```

In alternativa a `DATABASE_URL` puoi usare `SUPABASE_DATABASE_URL`.
Per salvare dalle impostazioni, l'utente PostgreSQL deve poter scrivere in `products`, `price_history`, `purchase_prices`, `purchase_price_history` e `customers` e usare le relative sequenze per gli inserimenti.

## Vercel

1. Collega il repository.
2. Imposta le variabili ambiente.
3. Deploy.
4. Apri `https://tuo-dominio.vercel.app/m/`.

L'app usa `/api/mobile-data` per consultare i report e `/api/mobile-settings` per le impostazioni.

## Netlify

1. Collega il repository.
2. Imposta le variabili ambiente.
3. Deploy.
4. Apri `https://tuo-dominio.netlify.app/m/`.

Netlify genera gli asset mobile con `node scripts/build.cjs --mobile`. I report usano `/.netlify/functions/mobile-data`. Il percorso `/api/mobile-settings` raggiunge la funzione Netlify delle impostazioni.

## Sicurezza e limiti

- Chiunque abbia il link mobile può consultare i report e cambiare prodotti, prezzi e clienti. L'accesso è diretto e senza login.
- Le scritture passano dall'endpoint delle impostazioni tramite `POST` JSON e richiedono una connessione al database.
- Per rimuovere del tutto la stringa hardcoded dall'app desktop, configura `DATABASE_URL` anche nell'ambiente Electron e poi ruota la password Supabase.
