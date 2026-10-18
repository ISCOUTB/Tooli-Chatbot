import { google } from 'googleapis';
import { config } from '../config';
import { maskEmail, maskPhone } from './logSafe';

export interface RegistroPosgrado {
  whatsapp: string;
  nombre: string;
  correo: string;
  interesFinanciacion: string;
}

function getSheetsClient(readonly = false) {
  const auth = new google.auth.GoogleAuth({
    credentials: config.google.serviceAccount,
    scopes: [
      readonly
        ? 'https://www.googleapis.com/auth/spreadsheets.readonly'
        : 'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
  return google.sheets({ version: 'v4', auth });
}

/**
 * Guarda un registro del evento de Posgrados en Google Sheets.
 * Devuelve el número de fila (para actualizar el posgrado de interés luego), o 0.
 *
 * Estructura de la hoja (crear y compartir con el service account como Editor):
 *   A: Fecha/hora   B: WhatsApp   C: Nombre   D: Correo
 *   E: ¿Interés con financiación?   F: Posgrado de interés   G: ¿Autoriza contacto?
 *   H: Seguimiento del asesor (agregada para el panel — ver actualizarSeguimientoEvento)
 */
export async function guardarRegistroPosgrado(data: RegistroPosgrado): Promise<number> {
  const sheetId = config.posgradosEvento.sheetId;
  if (!sheetId) {
    console.warn('[posgrados] POSGRADOS_EVENTO_SHEET_ID no configurado — registro no persistido', {
      whatsapp: maskPhone(data.whatsapp),
      correo: maskEmail(data.correo),
      interesFinanciacion: data.interesFinanciacion,
    });
    return 0;
  }

  const sheets = getSheetsClient();
  const ahora = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'A:G',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        ahora,
        data.whatsapp,
        data.nombre,
        data.correo,
        data.interesFinanciacion,
        '', // F: posgrado de interés (se completa después)
        '', // G: ¿autoriza contacto? (se completa después)
      ]],
    },
  });

  const updatedRange = res.data.updates?.updatedRange ?? '';
  const match = updatedRange.match(/![A-Z]+(\d+):/);
  if (res.data.updates?.updatedRows !== 1 || !match) return 0;
  console.log('[posgrados] registro guardado:', maskPhone(data.whatsapp), '·', maskEmail(data.correo));
  return parseInt(match[1], 10);
}

/**
 * Actualiza la columna F (posgrado de interés) de una fila ya guardada.
 */
export async function actualizarPosgradoInteres(fila: number, valor: string): Promise<void> {
  const sheetId = config.posgradosEvento.sheetId;
  if (!sheetId || !fila) return;

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `F${fila}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[valor]] },
  });
  if (res.data.updatedRows !== 1) throw new Error('No se confirmó la actualización del programa');

  console.log('[posgrados] posgrado de interés actualizado — fila', fila, ':', valor);
}

/**
 * Actualiza la columna G (¿autoriza contacto?) de una fila ya guardada.
 */
export async function actualizarConsentimiento(fila: number, valor: string): Promise<void> {
  const sheetId = config.posgradosEvento.sheetId;
  if (!sheetId || !fila) return;

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `G${fila}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[valor]] },
  });
  if (res.data.updatedRows !== 1) throw new Error('No se confirmó la actualización del consentimiento');

  console.log('[posgrados] consentimiento actualizado — fila', fila, ':', valor);
}

/**
 * Lee los registros del evento (meetup) de posgrados para mostrarlos en el
 * panel de asesores — de solo lectura, no toca el flujo de conversación.
 * Columnas A:G — ver guardarRegistroPosgrado() para el detalle de cada una.
 */
export async function leerRegistrosEventoPosgrado(): Promise<string[][]> {
  const sheetId = config.posgradosEvento.sheetId;
  if (!sheetId) return [];

  const sheets = getSheetsClient(true);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'A2:H',
  });
  return (res.data.values as string[][]) ?? [];
}

/**
 * Actualiza la columna H (seguimiento del asesor: contactado, interesado,
 * inscrito, no interesado, invitado a próximo evento) de una fila. Columna
 * agregada para el panel — no la usa el flujo de conversación del bot.
 */
export async function actualizarSeguimientoEvento(fila: number, valor: string): Promise<void> {
  const sheetId = config.posgradosEvento.sheetId;
  if (!sheetId || !fila) return;

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `H${fila}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[valor]] },
  });

  console.log('[posgrados] seguimiento actualizado — fila', fila, ':', valor);
}
