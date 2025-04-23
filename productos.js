import 'dotenv/config';
import { google } from 'googleapis';
import playwright from 'playwright';

const SHEET_ID = process.env.SHEET_ID;
const rawCredentials = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
const GOOGLE_SERVICE_CREDENTIALS = JSON.parse(rawCredentials);
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;

async function scrapeProductos() {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto("https://muebles-tiempo.web.app");
  await page.fill('#loggedoutEmail', EMAIL);
  await page.fill('#loggedoutPass', PASSWORD);
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForSelector('text=Productos', { timeout: 15000 });
  await page.click('text=Productos');
  await page.waitForSelector('#productosListaList tbody tr.productosListaListRow', { timeout: 15000 });

  const rows = await page.$$eval('#productosListaList tbody tr.productosListaListRow', trs =>
    trs.map(tr => {
      const tds = Array.from(tr.querySelectorAll('td'));
      return {
        "Fecha venta": tds[1]?.innerText.trim() || "",
        "Codigo": tds[2]?.innerText.trim() || "",
        "Cantidad": tds[3]?.innerText.trim() || "",
        "Producto": tds[4]?.innerText.trim() || "",
        "Origen": tds[5]?.innerText.trim() || "",
        "Verificado": tds[6]?.innerText.trim() || "",
        "Estado": tds[7]?.innerText.trim() || "",
        "Tipo proveedor": tds[8]?.innerText.trim() || "",
        "Entrega Comprometida": tds[9]?.innerText.trim() || "",
        "Estado proveedor": tds[10]?.innerText.replace(/\n/g, " | ").trim() || ""
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
  const sheetName = 'ProductosPorVenta';

  const headersRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1:Z1`
  });
  const headers = headersRes.data.values[0];

  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A2:Z1000`
  });
  const existing = existingRes.data.values || [];

  // Build existing map with key: "Codigo|Producto"
  const existingMap = new Map();
  for (let i = 0; i < existing.length; i++) {
    const row = existing[i];
    const key = `${row[headers.indexOf("Codigo")]}|${row[headers.indexOf("Producto")]}`;
    existingMap.set(key, { index: i + 2, row });
  }

  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires"
  });

  const toUpdate = [];
  const toInsert = [];

  for (const newRow of data) {
    const key = `${newRow["Codigo"]}|${newRow["Producto"]}`;
    const match = existingMap.get(key);

    const enrichedRow = headers.map(h =>
      h === "Ultima actualizacion"
        ? now
        : newRow.hasOwnProperty(h)
        ? newRow[h]
        : (match?.row[headers.indexOf(h)] ?? "")
    );

    if (!match) {
      toInsert.push(enrichedRow);
    } else {
      const rowChanged = ["Estado", "Verificado", "Tipo proveedor", "Estado proveedor"].some(field => {
        const i = headers.indexOf(field);
        return match.row[i] !== newRow[field];
      });

      if (rowChanged) {
        toUpdate.push({ rowNumber: match.index, values: enrichedRow });
      }
    }
  }

  for (const u of toUpdate) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A${u.rowNumber}:Z${u.rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [u.values] },
    });
  }

  if (toInsert.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A2`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: toInsert },
    });
  }
}

scrapeProductos()
  .then(updateSheet)
  .catch(console.error);
