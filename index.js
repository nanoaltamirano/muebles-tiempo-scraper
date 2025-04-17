
import 'dotenv/config';
import { google } from 'googleapis';
import playwright from 'playwright';

const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_SERVICE_CREDENTIALS = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8'));
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;

async function scrapePedidos() {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto("https://muebles-tiempo.web.app/");
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: "networkidle" });

  await page.goto("https://muebles-tiempo.web.app/ventas");

  const rows = await page.$$eval("#ventasList tbody tr", trs =>
    trs.map(tr => {
      const tds = tr.querySelectorAll("td");
      if (tds.length >= 8) {
        return {
          fecha: tds[0].innerText.trim(),
          codigo: tds[2].innerText.trim(),
          cliente: tds[3].innerText.trim(),
          producto: tds[4].innerText.trim(),
          estado: tds[5].innerText.trim(),
          fechaPrometida: tds[6].innerText.trim(),
          entregaCoordinada: tds[7].innerText.trim()
        };
      }
    }).filter(Boolean)
  );

  await browser.close();
  return rows;
}

async function updateSheet(data) {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_SERVICE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const sheet = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'A2:G1000',
  });

  const existing = sheet.data.values || [];
  const map = Object.fromEntries(existing.map(r => [r[1], r]));

  const updated = data.map(row => [
    row.fecha,
    row.codigo,
    row.cliente,
    row.producto,
    row.estado,
    row.fechaPrometida,
    row.entregaCoordinada
  ]);

  const final = updated.map(row => {
    const existing = map[row[1]];
    if (!existing) return row;
    if (
      existing[4] !== row[4] || // estado
      existing[6] !== row[6]    // entrega coordinada
    ) return row;
  }).filter(Boolean);

  if (final.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `A2:G${final.length + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: final },
    });
  }
}

scrapePedidos()
  .then(updateSheet)
  .catch(console.error);
