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

  // Paso 1: Login
  await page.goto("https://muebles-tiempo.web.app/");
  await page.fill('#loggedoutEmail', EMAIL);
  await page.fill('#loggedoutPass', PASSWORD);
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForSelector('#ventasMenuButton', { state: 'visible', timeout: 15000 });

  // Paso 2: Ir a sección ventas
  await page.waitForTimeout(10000);
  await page.click('#ventasMenuButton');

  // Paso 3: Esperar tabla
  await page.waitForTimeout(8000);
  await page.waitForSelector('#ventasList tbody tr', { timeout: 15000 });

  // Paso 4: Mapear columnas visibles manualmente
  const rows = await page.$$eval("#ventasList tbody tr", trs =>
    trs.map(tr => {
      const tds = Array.from(tr.querySelectorAll("td"));
      return {
        fecha: tds[0]?.innerText.trim() || "",
        codigo: tds[2]?.innerText.trim() || "",
        cliente: tds[3]?.innerText.trim() || "",
        producto: tds[4]?.innerText.trim() || "",
        total: tds[5]?.innerText.trim() || "",
        saldo: tds[6]?.innerText.trim() || "",
        estado: tds[7]?.innerText.trim() || "",
        promesa: tds[8]?.innerText.trim() || "",
        coordinada: tds[9]?.innerText.trim() || ""
      };
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
    range: 'A2:K1000',
  });

  const existing = sheet.data.values || [];
  const map = Object.fromEntries(existing.map(r => [r[2], r])); // clave: código (columna C)

  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires"
  });

  const toUpdate = [];
  const toInsert = [];

  for (const row of data) {
    const codigo = row.codigo;
    const enrichedRow = [
      row.fecha,
      "", // columna vacía (B)
      row.codigo,
      row.cliente,
      row.producto,
      row.total,
      row.saldo,
      row.estado,
      row.promesa,
      row.coordinada,
      now
    ];

    const existingRow = map[codigo];

    if (!existingRow) {
      toInsert.push(enrichedRow);
    } else {
      const estadoAntiguo = existingRow[7];
      const entregaAntigua = existingRow[9];

      if (estadoAntiguo !== row.estado || entregaAntigua !== row.coordinada) {
        const rowIndex = existing.findIndex(r => r[2] === codigo);
        toUpdate.push({ rowNumber: rowIndex + 2, values: enrichedRow });
      }
    }
  }

  for (const u of toUpdate) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `A${u.rowNumber}:K${u.rowNumber}`,
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
