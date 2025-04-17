import 'dotenv/config';
import { google } from 'googleapis';
import playwright from 'playwright';

const SHEET_ID = process.env.SHEET_ID;
const rawCredentials = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
const cleanedCredentials = rawCredentials.replace(/\\n/g, '\n'); // importante: escapado correcto
const GOOGLE_SERVICE_CREDENTIALS = JSON.parse(cleanedCredentials);
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;

async function scrapePedidos() {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Paso 1: Login
  await page.goto("https://muebles-tiempo.web.app/");
  await page.fill('#loggedoutEmail', EMAIL);
  await page.fill('#loggedoutPass', PASSWORD);
  await page.click('button[onclick="loginWithEmailAndPassword()"]');

  // Paso 2: Esperar a que se complete el login
  await page.waitForSelector('#loggedoutDiv', { state: 'detached', timeout: 15000 });

  // Paso 3: Ir al menú de Ventas
  await page.waitForSelector('#ventasMenuButton');
  await page.click('#ventasMenuButton');

  // Paso 4: Esperar a que aparezca la tabla
  await page.waitForSelector('#ventasList tbody tr');

  // Paso 5: Extraer filas de la tabla
  const rows = await page.$$eval('#ventasList tbody tr', trs =>
    trs.map(tr => {
      const tds = tr.querySelectorAll('td');
      return {
        fecha_creacion: tds[0]?.innerText.trim(),
        codigo_orden: tds[2]?.innerText.trim(),
        nombre_cliente: tds[3]?.innerText.trim(),
        productos: tds[4]?.innerText.trim(),
        estado: tds[6]?.innerText.trim(),
        entrega_comprometida: tds[7]?.innerText.trim(),
        entrega_coordinada: tds[8]?.innerText.trim()
      };
    })
  );

  console.log(`Total de registros obtenidos: ${rows.length}`);

  // Paso 6: Subir a Google Sheets
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_SERVICE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Limpiar antes de escribir (opcional)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A2:G'
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A2:G',
    valueInputOption: 'RAW',
    requestBody: {
      values: rows.map(r => [
        r.fecha_creacion,
        r.codigo_orden,
        r.nombre_cliente,
        r.productos,
        r.estado,
        r.entrega_comprometida,
        r.entrega_coordinada
      ])
    }
  });

  await browser.close();
}

scrapePedidos().catch(console.error);
