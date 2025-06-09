import "dotenv/config";
import crypto from "crypto";
import axios from "axios";
import { XMLValidator, XMLParser } from "fast-xml-parser";
import { sql, getDatabasePool } from "./db/db.js";
import { logger, memoryTransport } from "./logger/logger.js";
import { sendLogSummary } from "./logger/emailSender.js";

if (
  !process.env.DB_USER ||
  !process.env.DB_PASSWORD ||
  !process.env.DB_SERVER ||
  !process.env.DB_NAME ||
  !process.env.DB_ENCRYPT ||
  !process.env.DB_TRUST_SERVER_CERT ||
  !process.env.API_CRYPTO_KEY ||
  !process.env.API_ROOT ||
  !process.env.API_RETISTA ||
  !process.env.DB_TABLE_EROGAZIONI ||
  !process.env.DB_TABLE_IMPIANTI
) {
  throw "Impostare tutte le variabili di ambiente";
}

// Variabili di ambiente
const API_CRYPTO_KEY = process.env.API_CRYPTO_KEY;
const API_ROOT = process.env.API_ROOT;
const API_RETISTA = process.env.API_RETISTA;
const DB_TABLE_EROGAZIONI = process.env.DB_TABLE_EROGAZIONI;
const DB_TABLE_IMPIANTI = process.env.DB_TABLE_IMPIANTI;

// KPI per email
const KPILog: any = {};

/**
 * ICAD_Hash
 *
 * Cifra il testo in input utilizzando 3DES (DES-EDE3) in modalità ECB con padding PKCS#7, per ottenere il token di autenticazione
 * utilizzato da ICAD per verificare le richieste API, derivando la chiave dalla variabile di ambiente `CRYPTO_KEY`.
 *
 * @param text - Il testo in chiaro da cifrare.
 * @returns La stringa cifrata, codificata in Base64.
 */
function ICAD_Hash(text: string) {
  // 1) calcola MD5 della chiave
  const md5 = crypto.createHash("md5");
  md5.update(Buffer.from(API_CRYPTO_KEY, "utf8"));
  const keyHash = md5.digest(); // 16 byte

  // 2) estendi a 24 byte (two-key 3DES = K1,K2,K1)
  const key24 = Buffer.concat([keyHash, keyHash.slice(0, 8)]);

  // 3) crea il cipher 3DES-ECB con padding PKCS7
  const cipher = crypto.createCipheriv("des-ede3-ecb", key24, null);
  cipher.setAutoPadding(true);

  // 4) cifra e restituisci in Base64
  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

function formattaErogazione(erogazione: any) {
  const [dd, MM, yyyy, hh, mm, ss] = String(erogazione.DATETIME).match(/\d+/g)!;
  const DataOra = new Date(Date.UTC(+yyyy, +MM - 1, +dd, +hh, +mm, +ss));
  const DataCompetenza = new Date(Date.UTC(+yyyy, +MM - 1, +dd, 0, 0, 0));

  return {
    // Aggiungo 0 davanti per ottenere le 4 cifre
    ImpiantoCodice: String(erogazione.IMPIANTO.codice).padStart(4, "0"),
    DataOra: DataOra as Date,
    DataCompetenza: DataCompetenza as Date,
    TipoDevice: String(erogazione.DEVICETYPE),
    ImpiantoLink: String(erogazione.IMPIANTO.link),
    ImpiantoNome: String(erogazione.IMPIANTO.nome),
    ImpiantoStoreID: String(erogazione.IMPIANTO.storeID),
    ImportoTot: Number(String(erogazione.IMPORTOTOT).replace(",", ".")),
    Litri: Number(String(erogazione.LITRI).replace(",", ".")),
    Tessera: String(erogazione.LOCALCARD),
    Lotto: Number(String(erogazione.LOTTO).replace(",", ".")),
    NumeroMovimento: Number(String(erogazione.NUMMOV).replace(",", ".")),
    TipoOperazione: String(erogazione.OPMODE),
    TipoPagamento: String(erogazione.PAYMODE),
    PompaPistola: Number(String(erogazione.POMPA.npistola).replace(",", ".")),
    PompaNumero: Number(String(erogazione.POMPA.npompa).replace(",", ".")),
    Prezzo: Number(String(erogazione.PREZZO).replace(",", ".")),
    ProdottoCodice: String(erogazione.PRODOTTO.codice),
    ProdottoNome: String(erogazione.PRODOTTO.nome),
    TipoCarta: String(erogazione.TIPOCARTA),
    TipoPrezzo: String(erogazione.TIPOPREZZO),
    TotaleEL: Number(String(erogazione.TOTAL_EL).replace(",", ".")),
    TotaleMEC: Number(String(erogazione.TOTAL_MEC).replace(",", ".")),
    NumeroTransazione: Number(
      String(erogazione.TRANSACTIONNUMBER).replace(",", ".")
    ),
    ID_ICAD: Number(String(erogazione.ID).replace(",", ".")),
  };
}

// Esegue una query SQL e restituisce il risultato, o va in errore gestito
async function executeQuery(query: string) {
  try {
    const pool = await getDatabasePool();

    const result = await pool?.request().query(query);
    return result?.recordset;
  } catch (err) {
    logger.error(`❌ Errore durante l'esecuzione della query: ${query}`, err);
    throw `Errore nella query: ${err}`;
  }
}

// Funziona che, dato un impianto codice di default 0 (tutti gli impianti), mi restituisce il relativo StoreID in array
async function getListStoreID(ImpiantoCodice = 0) {
  try {
    const response = await axios.get(`${API_ROOT}/impiantiInfo.xml`, {
      params: {
        retista: API_RETISTA,
        impianto: ImpiantoCodice,
        H: ICAD_Hash(`${API_RETISTA}${ImpiantoCodice}`),
      },
    });
    // Verifico status di response corretto
    const xmlBody = response.data;

    const result = XMLValidator.validate(xmlBody);
    if (result === true) {
      // Converto XML in JSON:
      const parser = new XMLParser();
      const json = parser.parse(xmlBody);

      const list = json.ArrayOfWrapImpianti.WrapImpianti;

      console.log(list);

      return list
        .filter((item: any) => item.STATO === "True")
        .map((item: any) => ({
          NOME: item.NOME,
          STOREID: item.STOREID,
        }));
    } else {
      logger.error(
        `❌ Formato XML dell'anagrafica degli impianti ICAD non valido: ${result.err.msg}`,
        result
      );
    }
  } catch (error) {
    logger.error(
      "❌ Errore durante la chiamata API per ottenere gli impianti:",
      error
    );
    throw `Errore durante la chiamata API per ottenere gli impianti: ${error}`;
  }
}

async function getErogazioniList(storeID: string, icadID: number) {
  let ripeti = true;
  let lastIcadID = icadID;
  const listErogazioni = [];

  do {
    // Continuo a ricevere le informazioni di erogazione, andando sempre a prendere l'ultimo ID ritornato, finché non ricevo più dati
    // (tutte le erogazioni fino alla più recente sono state estratte)

    try {
      const response = await axios.get(`${API_ROOT}/erogazioniIDfilter.xml`, {
        params: {
          retista: API_RETISTA,
          impianto: storeID,
          ID: lastIcadID,
          H: ICAD_Hash(`${API_RETISTA}${storeID}${lastIcadID}`),
        },
      });

      const xmlBody = response.data;
      const result = XMLValidator.validate(xmlBody);
      if (result !== true) {
        logger.error(
          `❌ Store ID ${storeID}, formato XML delle erogazioni di ICAD NON valido`,
          { mail_log: true }
        );
        return false;
      }

      // Converto XML in JSON:
      const parser = new XMLParser();
      const json = parser.parse(xmlBody);

      // Ora che ho i dati ci sono delle opzioni
      // 1) Il dato è un array, quindi ci sono più erogazioni. Le aggiungo all'array finale e ripeto
      // 2) Il dato è un singolo elemento. Lo aggiungo all'array finale e ripeto (per sicurezza)
      // 3) il dato è un nullo. Non ci sono più dati da recuperare

      // Caso 1: Aggiungo le erogazioni alla lista e continuo
      if (Array.isArray(json.ArrayOfWrapErogazioni.WrapErogazioni)) {
        for (const item of json.ArrayOfWrapErogazioni.WrapErogazioni) {
          listErogazioni.push(formattaErogazione(item));
        }

        lastIcadID =
          json.ArrayOfWrapErogazioni.WrapErogazioni[
            json.ArrayOfWrapErogazioni.WrapErogazioni.length - 1
          ].ID;
      }
      // Caso 2: Aggiungo la singola erogazione alla lista e continuo
      else if (json.ArrayOfWrapErogazioni !== "") {
        const item = json.ArrayOfWrapErogazioni.WrapErogazioni;

        listErogazioni.push(formattaErogazione(item));

        // Imposto l'icad ID come l'ID corrente.
        lastIcadID = item.ID;
      }
      // Caso 3: Non c'è più niente da estrarre, mi fermo
      else {
        logger.info(`✅ Estrazione terminata per lo store ${storeID}`);
        ripeti = false;
      }
    } catch (error) {
      ripeti = false;
      logger.error(
        `❌ Store ID ${storeID}, errore durante la chiamata API per estrarre le erogazioni: ${error}`,
        { mail_log: true }
      );
      return false;
    }
  } while (ripeti);

  return listErogazioni;
}

logger.info("🚀 Script avviato con successo", { mail_log: true });

const pool = await getDatabasePool();

// Otteniamo, per ogni impianto rilevato sul DB, l'ultima erogazione registrata (Cerco negli ultimi 4 mesi)
const lastIDList = await executeQuery(`SELECT
er.ImpiantoStoreID AS Impianto,
MAX(er.ID_ICAD) AS LAST_ID

FROM ${DB_TABLE_EROGAZIONI} er

LEFT JOIN ${DB_TABLE_IMPIANTI} imp

ON er.ImpiantoCodice = imp.ImpiantoCodice

WHERE
er.DataCompetenza > DATEADD(MONTH, -4, GETDATE())
AND imp.StatoAttivoSiNo = 1

GROUP BY er.ImpiantoStoreID`);

const STORE_LASTID_MAP = [];

// Mapping degli impianti sul last_id nel DB
for (const item of lastIDList) {
  STORE_LASTID_MAP[item.Impianto] = item.LAST_ID;
}

// Ottengo la lista di tutti gli store ID di Dicomi presenti in ICAD, per cui estrarre le erogazioni
const storeIDList = await getListStoreID();

for (const store of storeIDList) {
  const storeID = store.STOREID;
  const storeName = store.NOME;

  logger.info(`✅ Elaborazione dell'Impianto: ${storeName} in corso... `);

  // Ottengo l'ultimo ID erogato per lo store, oppure undefined se non esiste
  const lastIcadID = STORE_LASTID_MAP[storeID];

  // Se lo store non esiste, sollevo un errore e salto lo store
  if (!lastIcadID) {
    logger.error(`❌ Impianto ${storeName} non esiste nel DB`, {
      mail_log: true,
    });
    KPILog[1] = (KPILog[1] || 0) + 1;
    continue;
  } else {
    logger.info(`✅ Ultimo ICAD ID rilevato: ${lastIcadID}`);
  }

  //API verso ICAD per ottenere tutte le erogazioni dell'impianto in questione
  const erogazioniList = await getErogazioniList(storeID, lastIcadID);

  if (!erogazioniList) {
    // Salto l'impianto perché ho ricevuto errore nelle erogazioni
    continue;
  }

  if (erogazioniList.length === 0) {
    // Salto l'impianto perché non ho ricevuto erogazioni
    logger.warn(`⚠️ Impianto ${storeName}, nessuna erogazione`, {
      mail_log: true,
    });
    KPILog[2] = (KPILog[2] || 0) + 1;
    continue;
  }

  logger.debug(
    `🐛 Erogazioni estratte: ${JSON.stringify(erogazioniList, null, 2)}`
  );
  logger.info(`✅ Numero erogazioni estratte: ${erogazioniList.length}`);

  //ciclo sulle erogazioni
  // insert nel DB
  let impiantoOK = true;
  for (const erogazione of erogazioniList) {

    console.log("OKAY: ", erogazione.Litri)

    try {
      const query = `
    INSERT INTO ${DB_TABLE_EROGAZIONI}
    (
      ImpiantoCodice, 
      DataOra,
      DataCompetenza,
      TipoDevice,
      ImpiantoLink,
      ImpiantoNome,
      ImpiantoStoreID,
      ImportoTot,
      Litri,
      Tessera,
      Lotto,
      NumeroMovimento,
      TipoOperazione,
      TipoPagamento,
      PompaPistola,
      PompaNumero,
      Prezzo,
      ProdottoCodice,
      ProdottoNome,
      TipoCarta,
      TipoPrezzo,
      TotaleEL,
      TotaleMEC,
      NumeroTransazione,
      ID_ICAD
    )
      VALUES
    (
      @ImpiantoCodice, 
      @DataOra,
      @DataCompetenza,
      @TipoDevice,
      @ImpiantoLink,
      @ImpiantoNome,
      @ImpiantoStoreID,
      @ImportoTot,
      @Litri,
      @Tessera,
      @Lotto,
      @NumeroMovimento,
      @TipoOperazione,
      @TipoPagamento,
      @PompaPistola,
      @PompaNumero,
      @Prezzo,
      @ProdottoCodice,
      @ProdottoNome,
      @TipoCarta,
      @TipoPrezzo,
      @TotaleEL,
      @TotaleMEC,
      @NumeroTransazione,
      @ID_ICAD
    )`;

      await pool
        .request()
        .input("ImpiantoCodice", sql.NVarChar, erogazione.ImpiantoCodice)
        .input("DataOra", sql.DateTime, erogazione.DataOra)
        .input("DataCompetenza", sql.DateTime, erogazione.DataCompetenza)
        .input("TipoDevice", sql.NVarChar, erogazione.TipoDevice)
        .input("ImpiantoLink", sql.NVarChar, erogazione.ImpiantoLink)
        .input("ImpiantoNome", sql.NVarChar, erogazione.ImpiantoNome)
        .input("ImpiantoStoreID", sql.NVarChar, erogazione.ImpiantoStoreID)
        .input("ImportoTot", sql.Money, erogazione.ImportoTot)
        // Per non avere errori, devo dichiarare anche la precisione del Decimal
        .input("Litri", sql.Decimal(18, 2), erogazione.Litri)
        .input("Tessera", sql.NVarChar, erogazione.Tessera)
        .input("Lotto", sql.Int, erogazione.Lotto)
        .input("NumeroMovimento", sql.Int, erogazione.NumeroMovimento)
        .input("TipoOperazione", sql.NVarChar, erogazione.TipoOperazione)
        .input("TipoPagamento", sql.NVarChar, erogazione.TipoPagamento)
        .input("PompaPistola", sql.Int, erogazione.PompaPistola)
        .input("PompaNumero", sql.Int, erogazione.PompaNumero)
        .input("Prezzo", sql.Money, erogazione.Prezzo)
        .input("ProdottoCodice", sql.NVarChar, erogazione.ProdottoCodice)
        .input("ProdottoNome", sql.NVarChar, erogazione.ProdottoNome)
        .input("TipoCarta", sql.NVarChar, erogazione.TipoCarta)
        .input("TipoPrezzo", sql.NVarChar, erogazione.TipoPrezzo)
        .input("TotaleEL", sql.Int, erogazione.TotaleEL)
        .input("TotaleMEC", sql.Int, erogazione.TotaleMEC)
        .input("NumeroTransazione", sql.BigInt, erogazione.NumeroTransazione)
        .input("ID_ICAD", sql.BigInt, erogazione.ID_ICAD)
        .query(query);
    } catch (err) {
      // 1) log completo
      impiantoOK = false;
      logger.error(
        `❌ Impianto ${erogazione.ImpiantoNome}, errore inserimento nel DB: ${err}`,
        { mail_log: true }
      );
      KPILog[1] = (KPILog[1] || 0) + 1;
      continue;
    }
  }

  if (impiantoOK) {
    logger.info(`✅ Erogazioni inserite correttamente`);
    KPILog[0] = (KPILog[0] || 0) + 1;
  }
}

await pool.close();

logger.info("🚀 Estrazione terminata con successo", { mail_log: true });

// aspetta che Winston completi tutti i setImmediate interni
await new Promise((resolve) => setImmediate(resolve));

// ora leggi TUTTI i log
const logSummary = memoryTransport.getLogSummary();

// Invia il riepilogo via email
try {
  await sendLogSummary(logSummary, KPILog);
} catch (error) {
  logger.error("❌ Errore nell'invio dell'email:", error);
}

logger.info("🚀 Script terminato con successo.");

process.exit(0);
