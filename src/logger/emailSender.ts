// emailSender.ts
import nodemailer, { Transporter, SendMailOptions } from "nodemailer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.js"; // mantiene estensione .js se il logger è compilato in JS

// Assicuriamoci che i valori esistano a compile-time o lanciamo errore
const apiEndpoint: string = process.env.DB_API_ENDPOINT!;
const apiPort: string = process.env.DB_API_PORT!;

export async function sendLogSummary(
  logSummary: string,
  KPILog: Record<number, number | string>,
  excelLogPath: string,
): Promise<void> {
  // Percorso del file corrente (ESM)
  const __filename = fileURLToPath(import.meta.url);
  console.log(__filename);
  const __dirname = path.dirname(__filename);

  // Carica il template HTML
  const templatePath = path.join(__dirname, "summary-etl-erogazioni.html");
  let htmlContent = fs.readFileSync(templatePath, "utf8");

  let cambioGestioneHtml = ""; // puoi popolarlo se serve

  // Definizione dei placeholder e dei loro valori
  const replacements: Record<string, string | number> = {
    DATA: new Date().toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    "VAL CODICE 0": KPILog[0] ?? 0,
    "VAL CODICE 1": KPILog[1] ?? 0,
    "VAL CODICE 2": KPILog[2] ?? 0,
    "LISTA CAMBIO GESTIONE": cambioGestioneHtml,
    "LOG DUMP": logSummary || "Nessun log disponibile",
  };

  // Sostituisci tutti i placeholder nel template
  for (const [key, value] of Object.entries(replacements)) {
    const regex = new RegExp(`\\[${key}\\]`, "g");
    htmlContent = htmlContent.replace(regex, String(value));
  }

  // Configurazione del transporter
  const host = process.env.EMAIL_HOST!;
  const port = Number(process.env.EMAIL_PORT) || 587;
  const user = process.env.EMAIL_USER!;
  const pass = process.env.EMAIL_PASSWORD!;

  const transporter: Transporter = nodemailer.createTransport({
    host,
    port,
    auth: { user, pass },
  });

  // Opzioni della mail
  const mailOptions: SendMailOptions = {
    from: `"${process.env.EMAIL_FROM}" <${user}>`,
    replyTo: "dicomi@iceinformatics.com",
    to: process.env.EMAIL_TO,
    cc: process.env.EMAIL_CC,
    bcc: process.env.EMAIL_BCC,
    subject: "ETL Erogazioni",
    text: "Questa email contiene del codice HTML, utilizzare un dispositivo idoneo per la visualizzazione o contattare ICE Informatics",
    html: htmlContent,
     attachments: [
         {
            filename: 'log.xlsx',
            path: excelLogPath  // il percorso del file Excel da allegare
         }
      ]
  };

  // Invio
  const info = await transporter.sendMail(mailOptions);
  logger.info(`✅ Email inviata con ID: ${info.messageId}`);
}
