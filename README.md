# dicomi-etl-erogazioni

Servizio Node.js/TypeScript per estrarre quotidianamente le erogazioni dagli impianti ICAD e inserirle in un database SQL Server.

---

## 📖 Indice

- [Panoramica](#panoramica)
- [Funzionalità](#funzionalità)
- [Prerequisiti](#prerequisiti)
- [Installazione](#installazione)
- [Configurazione](#configurazione)
  - [.env](#env)
- [Struttura del progetto](#struttura-del-progetto)
- [Script NPM](#script-npm)
- [Dettagli tecnici](#dettagli-tecnici)
  - [Hashing ICAD_Hash](#hashing-icad_hash)
  - [Formato ed inserimento erogazioni](#formato-ed-inserimento-erogazioni)
  - [Chiamate API a ICAD](#chiamate-api-a-icad)
- [Logging](#logging)
- [Gestione errori](#gestione-errori)
- [Contribuire](#contribuire)
- [Licenza](#licenza)

---

## 📜 Panoramica

Questo servizio si aggancia all’API ICAD per:

1. Recuperare la lista degli impianti (`StoreID`).
2. Estrarre tutte le erogazioni successive all’ultimo `ID_ICAD` salvato nel database.
3. Formattare i dati e inserirli nella tabella dedicata (`DICOMI_Erogazioni`).

---

## ⚙️ Funzionalità

- Connessione a SQL Server via `mssql`/`tedious`.
- Richieste HTTP con `axios`.
- Parsing XML con `fast-xml-parser`.
- Hashing 3DES-ECB + MD5 per autenticazione ICAD.
- Conversione e normalizzazione date con `date-fns`.
- Logging strutturato con `winston`.
- Script per sviluppo, build e avvio in produzione tramite PM2.

---

## 📦 Prerequisiti

- Node.js ≥ 18.x
- NPM ≥ 8.x
- SQL Server accessibile (locale o remoto)
- Credenziali e permessi di lettura/scrittura sul database

---

## 🚀 Installazione

\`\`\`bash

# Clona il repository

git clone https://github.com/ICEInformaticsDozio/dicomi-etl-erogazioni.git
cd dicomi-etl-erogazioni

# Installa dipendenze e tool globali (pm2, typescript)

npm install

# Crea il file .env in root basandoti sul template seguente

cp .env.example .env
\`\`\`

---

## 🔧 Configurazione

### `.env`

\`\`\`ini

# Configurazione accesso al DB

DB_USER= # Es. LucaDozioSQL
DB_PASSWORD= # Password utente DB
DB_SERVER= # Host o indirizzo IP SQL Server
DB_NAME= # Nome database (es. Dicomi_DB)
DB_ENCRYPT=false # 'true' per TLS/SSL
DB_TRUST_SERVER_CERT=true # 'true' per fidarsi del certificato

# API ICAD

API_CRYPTO_KEY= # Chiave segreta per hashing (es. 45F80B6E4A9BB683)
API_ROOT=https://exportservice-overview.icadsistemi.com/isOverviewExport.svc
API_RETISTA=10006 # Codice retista ICAD

# Tabella destinazione delle erogazioni

DB_TABLE_EROGAZIONI=Dicomi_DB.dbo.DICOMI_Erogazioni
\`\`\`

> **Importante**: assicurati che tutte le variabili siano impostate prima di eseguire il servizio.

---

## 🗂️ Struttura del progetto

\`\`\`
├── src/
│ ├── db/
│ │ └── db.js # Connessione e pool SQL Server
│ ├── logger/
│ │ └── logger.js # Configurazione Winston
│ └── main.ts # Entry-point del processo ETL
├── package.json
├── ecosystem.config.cjs # Config PM2
└── .env.example # Template variabili ambiente
\`\`\`

---

## 📋 Script NPM

| Comando                 | Descrizione                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| \`npm run dev\`         | Avvia in hot-reload con **nodemon** (sviluppo)                   |
| \`npm run build\`       | Compila TypeScript in \`dist/\`                                  |
| \`npm start\`           | Avvia con **PM2** (produzione, secondo \`ecosystem.config.cjs\`) |
| \`npm run postinstall\` | Installa globalmente PM2 e TypeScript (usato in deploy CI/CD)    |

---

## 🔍 Dettagli tecnici

### Hashing \`ICAD_Hash\`

1. MD5 della \`API_CRYPTO_KEY\` → 16 byte
2. Estensione a 24 byte (two-key 3DES): \`[K1,K2,K1]\`
3. Cifrazione 3DES-ECB + PKCS#7 → Base64

Serve per generare il parametro \`H\` nelle chiamate ICAD.

---

### Formato ed inserimento erogazioni

- La risposta XML viene validata e trasformata in JSON.
- Ogni elemento \`WrapErogazioni\` è normalizzato da \`formattaErogazione()\`:
  - Parsing di date (\`DATETIME\`) e calcolo di \`DataCompetenza\` (inizio giornata).
  - Conversione di numeri (virgola → punto).
- Inserimento riga-per-riga in tabella SQL tramite query parametrizzate.

---

### Chiamate API a ICAD

1. **Lista impianti**  
   \`GET {API_ROOT}/impiantiInfo.xml?retista={API_RETISTA}&impianto=0&H={hash}\`

2. **Erogazioni per store**  
   Ciclo di richieste a  
   \`GET {API_ROOT}/erogazioniIDfilter.xml?retista={API_RETISTA}&impianto={storeID}&ID={lastID}&H={hash}\`  
   fino a esaurimento dati.

---

## 📊 Logging

Tutti gli step principali e gli errori vengono registrati con **Winston** in console e/o file (se configurato):

- Avvio elaborazione store
- ID_ICAD ultimo registrato
- Numero di erogazioni estratte
- Errori API/XML/DB

---

## 🚨 Gestione errori

- Mancata configurazione \`.env\` → eccezione bloccante
- XML non valido → log di errore e skip
- StoreID non presente in DB → log di errore e skip
- Errori SQL/Network → eccezione con stack trace

---

## 🤝 Contribuire

1. Fork del repository
2. Crea branch feature: \`git checkout -b feature/nome\`
3. Commit delle modifiche: \`git commit -m "Descrizione"\`
4. Push e apri Pull Request

---

## 📄 Licenza

ISC © ICE Informatics Dozio
