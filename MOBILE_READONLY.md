# Vista mobile read-only

Questa vista e separata dall'app Electron. Si apre da browser con:

```text
/m/
```

Legge solo i dati gia sincronizzati su PostgreSQL/Supabase. Se il Mac e spento, restano visibili gli ultimi dati caricati online.

## Variabili ambiente

Configura queste variabili su Vercel o Netlify:

```text
DATABASE_URL=postgresql://...
```

In alternativa a `DATABASE_URL` puoi usare `SUPABASE_DATABASE_URL`.

## Vercel

1. Collega il repository.
2. Imposta le variabili ambiente.
3. Deploy.
4. Apri `https://tuo-dominio.vercel.app/m/`.

L'endpoint usato dalla pagina e `/api/mobile-data`.

## Netlify

1. Collega il repository.
2. Imposta le variabili ambiente.
3. Deploy.
4. Apri `https://tuo-dominio.netlify.app/m/`.

L'endpoint usato dalla pagina e `/.netlify/functions/mobile-data`.

## Sicurezza e limiti

- Tutte le API mobile accettano solo `GET`.
- Non ci sono funzioni di inserimento, import, modifica, backup o impostazioni.
- La vista mobile non richiede token o login: chi conosce l'indirizzo puo leggere i dati pubblicati.
- Per rimuovere del tutto la stringa hardcoded dall'app desktop, configura `DATABASE_URL` anche nell'ambiente Electron e poi ruota la password Supabase.
