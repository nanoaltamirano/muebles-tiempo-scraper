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
  await page.click('#ventasMenuButton');

  await page.waitForTimeout(8000);
  await page.waitForSelector('#ventasList tbody tr', { timeout: 15000 });

  const rows = await page.$$eval("#ventasList tbody tr", trs =>
    trs.map(tr => {
      const tds = Array.from(tr.querySelectorAll("td"));
      return {
        "Fecha": tds[0]?.innerText.trim() || "",
        "Codigo": tds[2]?.innerText.trim() || "",
        "Cliente": tds[3]?.innerText.trim() || "",
        "Producto": tds[4]?.innerText.trim() || "",
        "Total": tds[5]?.innerText.trim() || "",
        "Saldo": tds[6]?.innerText.trim() || "",
        "Estado": tds[7]?.innerText.trim() || "",
        "Promesa": tds[8]?.innerText.trim() || "",
        "Coordinada": tds[9]?.innerText.trim() || ""
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

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'A1:Z1',
  });
  const headers = headerRes.data.values[0];
  const estadoIndex = headers.indexOf("Estado");
  const coordinadaIndex = headers.indexOf("Coordinada");
  const codigoIndex = headers.indexOf("Codigo");
  const tieneUltimaActualizacion = headers.includes("Ultima actualizacion");

  const sheet = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'A2:Z1000',
  });

  const existing = sheet.data.values || [];
  const map = Object.fromEntries(existing.map(r => [r[codigoIndex], r]));

  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires"
  });

  const scrapedCodigos = data.map(d => d["Codigo"]);
  const toUpdate = [];
  const toInsert = [];

  for (const row of data) {
    const codigo = row["Codigo"];
    const existingRow = map[codigo];

    const enrichedRow = headers.map(h =>
      h === "Ultima actualizacion" ? now : (row[h] ?? "")
    );

    if (!existingRow) {
      toInsert.push(enrichedRow);
    } else {
      const estadoAntiguo = existingRow[estadoIndex];
      const entregaAntigua = existingRow[coordinadaIndex];

      if (estadoAntiguo !== row["Estado"] || entregaAntigua !== row["Coordinada"]) {
        const rowIndex = existing.findIndex(r => r[codigoIndex] === codigo);
        toUpdate.push({ rowNumber: rowIndex + 2, values: enrichedRow });
      }
    }
  }

  // Marcar como "Entregada" las órdenes que ya no aparecen en la tabla de ventas
  for (let i = 0; i < existing.length; i++) {
    const row = existing[i];
    const codigo = row[codigoIndex];
    const estadoActual = row[estadoIndex];

    if (!scrapedCodigos.includes(codigo) && estadoActual !== "Entregada") {
      const nuevaFila = [...row];
      nuevaFila[estadoIndex] = "Entregada";
      if (tieneUltimaActualizacion) {
        const fechaIndex = headers.indexOf("Ultima actualizacion");
        nuevaFila[fechaIndex] = now;
      }
      toUpdate.push({ rowNumber: i + 2, values: nuevaFila });
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
