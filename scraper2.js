import 'dotenv/config';
import { google } from 'googleapis';
import playwright from 'playwright';

const SHEET_ID = process.env.SHEET_ID;
const rawCredentials = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
const GOOGLE_SERVICE_CREDENTIALS = JSON.parse(rawCredentials);
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;

async function scrapePedidosProveedor() {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto("https://muebles-tiempo.web.app/");
  await page.fill('#loggedoutEmail', EMAIL);
  await page.fill('#loggedoutPass', PASSWORD);
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  
  await page.waitForTimeout(3000); // esperar carga después de login

  // Ir a "Proformas"
  await page.click('#proformasMenuButton');
  await page.waitForTimeout(3000);

  // Clickear "Proformas Pedidas" para expandir la tabla
  await page.click('h3.transpButton', { timeout: 15000 });
  await page.waitForTimeout(3000);

  // Esperar que aparezca la tabla expandida
  await page.waitForSelector('#proformasPendientesList tbody tr', { timeout: 15000 });

  // Scrapear las filas de la tabla
  const rows = await page.$$eval('#proformasPendientesList tbody tr', trs =>
    trs.map(tr => {
      const tds = Array.from(tr.querySelectorAll('td'));
      return {
        "Codigo": tds[1]?.innerText.trim() || "",
        "Fecha entrega": tds[2]?.innerText.trim() || "",
        "Proveedor": tds[3]?.innerText.trim() || "",
        "Cantidad": tds[4]?.innerText.trim() || "",
        "Producto": tds[5]?.innerText.trim() || "",
        "Estado": tds[7]?.innerText.trim() || "",
        "Fecha pedido": (tds[8]?.innerText.trim().replace(/^el día\s*/, "") || "")
      };
    })
  );

  await browser.close();
  return rows;
}

// Función para convertir índice a letra de columna
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
  const sheetName = 'PedidosAProveedor';

  const headersRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1:AZ1`
  });
  const headers = headersRes.data.values[0];

  const codigoIdx = headers.indexOf("Codigo");
  const productoIdx = headers.indexOf("Producto");
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

  const newKeys = new Set();

  data.forEach(newRow => {
    const key = `${newRow["Codigo"]}|${newRow["Producto"]}`;
    newKeys.add(key);
    const match = existingMap[key];

    if (!match) {
      // Insertar fila nueva completa
      const filaNueva = headers.map(h => {
        if (h === "Ultima actualizacion") return now;
        return newRow[h] ?? "";
      });
      toInsert.push(filaNueva);
    } else {
      // Actualizar campos si cambiaron
      ["Estado", "Fecha entrega", "Fecha pedido"].forEach(campo => {
        const colIdx = headers.indexOf(campo);
        if (colIdx === -1) return;
        const valorNuevo = newRow[campo];
        const valorViejo = match.row[colIdx];

        if (valorNuevo !== valorViejo) {
          const letraCol = colToLetter(colIdx);
          updateRequests.push({
            range: `${sheetName}!${letraCol}${match.index}`,
            values: [[valorNuevo]]
          });
        }
      });
    }
  });

  // Detectar pedidos que desaparecieron (entregados)
  Object.keys(existingMap).forEach(key => {
    if (!newKeys.has(key)) {
      const { index, row } = existingMap[key];
      const estadoCol = headers.indexOf("Estado");
      const fechaRecibidoCol = headers.indexOf("Fecha recibido");

      if (estadoCol !== -1) {
        updateRequests.push({
          range: `${sheetName}!${colToLetter(estadoCol)}${index}`,
          values: [["entregado"]]
        });
      }
      if (fechaRecibidoCol !== -1) {
        updateRequests.push({
          range: `${sheetName}!${colToLetter(fechaRecibidoCol)}${index}`,
          values: [[now]]
        });
      }
    }
  });

  if (updateRequests.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updateRequests
      }
    });
  }

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

scrapePedidosProveedor()
  .then(updateSheet)
  .catch(console.error);
