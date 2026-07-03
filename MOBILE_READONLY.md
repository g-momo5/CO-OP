# Vista mobile read-only

Questa vista e separata dall'app Electron. Si apre da browser con:

```text
/m/<MOBILE_SECRET_TOKEN>
```

Legge solo i dati gia sincronizzati su PostgreSQL/Supabase. Se il Mac e spento, restano visibili gli ultimi dati caricati online.

## Variabili ambiente

Configura queste variabili su Vercel o Netlify:

```text
DATABASE_URL=postgresql://...
MOBILE_SECRET_TOKEN=un-token-lungo-e-non-indovinabile
```

In alternativa a `DATABASE_URL` puoi usare `SUPABASE_DATABASE_URL`.

## Vercel

1. Collega il repository.
2. Imposta le variabili ambiente.
3. Deploy.
4. Apri `https://tuo-dominio.vercel.app/m/<MOBILE_SECRET_TOKEN>`.

L'endpoint usato dalla pagina e `/api/mobile-data`.

## Netlify

1. Collega il repository.
2. Imposta le variabili ambiente.
3. Deploy.
4. Apri `https://tuo-dominio.netlify.app/m/<MOBILE_SECRET_TOKEN>`.

L'endpoint usato dalla pagina e `/.netlify/functions/mobile-data`.

## Sicurezza e limiti

- Tutte le API mobile accettano solo `GET`.
- Il token nel link blocca gli accessi senza token o con token errato.
- Non ci sono funzioni di inserimento, import, modifica, backup o impostazioni.
- Il link segreto e comodo, ma meno forte di un login vero. Se lo condividi per errore, cambia `MOBILE_SECRET_TOKEN`.
- Per rimuovere del tutto la stringa hardcoded dall'app desktop, configura `DATABASE_URL` anche nell'ambiente Electron e poi ruota la password Supabase.
