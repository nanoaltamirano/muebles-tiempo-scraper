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

// Función que convierte índice numérico a letra de columna (ej: 0 => A, 27 => AB)
function colToLetter(col) {
  let letter = "";
  while (col >= 0) {
    letter = String.fromCharCode(col % 26 + 65) + letter;
    col = Math.floor(col / 26) - 1;
  }
  return letter;
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
    range: `${sheetName}!A1:AZ1`
  });
  const headers = headersRes.data.values[0];

  const codigoIdx = headers.indexOf("Codigo");
  const productoIdx = headers.indexOf("Producto");
  const camposClave = ["Estado", "Verificado", "Tipo proveedor", "Estado proveedor", "Ultima actualizacion"];

  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A2:AZ`
  });
  const existing = existingRes.data.values || [];

  const existingMap = {};
  existing.forEach((row, index) => {
    const key = `${row[codigoIdx]}|${row[productoIdx]}`;
    existingMap[key] = { index: index + 2, row };
  });

  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires"
  });

  const updateRequests = [];
  const toInsert = [];

  data.forEach(newRow => {
    const key = `${newRow["Codigo"]}|${newRow["Producto"]}`;
    const match = existingMap[key];

    if (!match) {
      // Insertar fila nueva completa
      const filaNueva = headers.map(h => {
        if (camposClave.includes(h)) return h === "Ultima actualizacion" ? now : newRow[h] ?? "";
        return newRow[h] ?? "";
      });
      toInsert.push(filaNueva);
    } else {
      // Actualizar sólo campos clave específicos
      camposClave.forEach(campo => {
        const colIdx = headers.indexOf(campo);
        if (colIdx === -1) return; // Evita rangos inválidos
        const valorNuevo = campo === "Ultima actualizacion" ? now : newRow[campo];
        const valorViejo = match.row[colIdx];

        if (valorNuevo !== valorViejo) {
          const letraCol = colToLetter(colIdx); // Aquí está la solución al error
          updateRequests.push({
            range: `${sheetName}!${letraCol}${match.index}`,
            values: [[valorNuevo]]
          });
        }
      });
    }
  });

  // Actualizar celdas individualmente
  if (updateRequests.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updateRequests
      }
    });
  }

  // Insertar filas nuevas
  if (toInsert.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A2`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: toInsert },
    });
  }
}

scrapeProductos()
  .then(updateSheet)
  .catch(console.error);
