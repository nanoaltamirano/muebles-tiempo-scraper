import 'dotenv/config';
import { google } from 'googleapis';
import playwright from 'playwright';

const SHEET_ID = process.env.SHEET_ID;
const rawCredentials = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
const GOOGLE_SERVICE_CREDENTIALS = JSON.parse(rawCredentials);
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;

async function scrapePedidos() {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto("https://muebles-tiempo.web.app/");
  await page.fill('#loggedoutEmail', EMAIL);
  await page.fill('#loggedoutPass', PASSWORD);
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForSelector('#ventasMenuButton', { state: 'visible', timeout: 15000 });

  await page.waitForTimeout(10000);
  await page.waitForSelector('#ventasMenuButton', { timeout: 15000 });
  await page.click('#ventasMenuButton');

  await page.waitForTimeout(8000);
  await page.waitForSelector('#ventasList tbody tr', { timeout: 15000 });

  const rows = await page.$$eval("#ventasList tbody tr", trs =>
    trs.map(tr => {
      const tds = Array.from(tr.querySelectorAll("td"));
      return tds.map(td => td.innerText.trim());
    })
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
    range: 'A1:Z1000', // incluir cabecera
  });

  const allRows = sheet.data.values || [];
  const headers = allRows[0];
  const existing = allRows.slice(1);

  // Índices dinámicos según encabezado
  const codigoIndex = headers.indexOf("Codigo");
  const estadoIndex = headers.indexOf("Estado");
  const entregaIndex = headers.indexOf("Entrega coordinada");

  if (codigoIndex === -1 || estadoIndex === -1 || entregaIndex === -1) {
    throw new Error("No se encontraron los encabezados requeridos en la hoja");
  }

  const map = Object.fromEntries(existing.map(r => [r[codigoIndex], r]));

  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires"
  });

  const toUpdate = [];
  const toInsert = [];

  for (const row of data) {
    const codigo = row[codigoIndex];
    const existingRow = map[codigo];
    const enrichedRow = [...row, now];

    if (!existingRow) {
      toInsert.push(enrichedRow);
    } else {
      const estadoAntiguo = existingRow[estadoIndex];
      const entregaAntigua = existingRow[entregaIndex];

      if (estadoAntiguo !== row[estadoIndex] || entregaAntigua !== row[entregaIndex]) {
        const rowIndex = existing.findIndex(r => r[codigoIndex] === codigo);
        toUpdate.push({ rowNumber: rowIndex + 2, values: enrichedRow }); // +2 por header + base 1
      }
    }
  }

  for (const u of toUpdate) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `A${u.rowNumber}:Z${u.rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [u.values] },
    });
  }

  if (toInsert.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'A2',
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: toInsert },
    });
  }
}

scrapePedidos()
  .then(updateSheet)
  .catch(console.error);
