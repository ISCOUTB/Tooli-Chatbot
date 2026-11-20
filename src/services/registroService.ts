import { google } from 'googleapis';
import { config } from '../config';
import { maskEmail, maskPhone } from './logSafe';
import { contactIdLabel } from './whatsappId';

export interface RegistroProspecto {
  nombre: string;
  email: string;
  whatsapp: string;   // número E.164 sin +, ej: 573215640735
  programa?: string;  // programa/carrera de interés (si viene del flujo de programas)
  area?: 'Pregrado' | 'Posgrado'; // por defecto Posgrado — las filas históricas no tenían esta columna
}

/**
 * Agrega una fila al Google Sheet de registro de prospectos (pregrado y posgrado
 * comparten el mismo sheet, distinguidos por la columna F).
 *
 * Estructura del sheet (crear manualmente):
 *   A: Fecha y hora   B: Nombre   C: Email   D: WhatsApp   E: Programa/carrera de interés   F: Área
 *
 * IMPORTANTE: compartir el sheet con el service account con permisos de Editor:
 *   tooli-sheets-reader@crucial-minutia-489517-c8.iam.gserviceaccount.com
 */
/** 'Registros!A12:F12' → 12: la fila que Sheets dice haber escrito. */
export function filaDeRango(rango: string | null | undefined): number | null {
  const m = /![A-Z]+(\d+)(?::|$)/.exec(rango ?? '');
  return m ? Number(m[1]) : null;
}

/** Agrega el prospecto y devuelve la fila escrita, para completarla después sin duplicarla. */
export async function guardarRegistroProspecto(data: RegistroProspecto): Promise<number | null> {
  const sheetId = config.google.registroPosgradoSheetId;
  if (!sheetId) {
    console.warn('[registro] POSGRADO_REGISTRO_SHEET_ID no configurado — prospecto no persistido', {
      whatsapp: maskPhone(data.whatsapp),
      email: maskEmail(data.email),
      area: data.area ?? 'Posgrado',
    });
    throw new Error('POSGRADO_REGISTRO_SHEET_ID no configurado');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: config.google.serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const ahora = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Registros!A:F',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        ahora,
        data.nombre,
        data.email,
        contactIdLabel(data.whatsapp),
        data.programa ?? '',
        data.area ?? 'Posgrado',
      ]],
    },
  });

  if (response.data.updates?.updatedRows !== 1) {
    throw new Error('Sheets no confirmó la inserción de una fila de registro');
  }

  console.log('[registro] prospecto guardado en Sheets:', maskPhone(data.whatsapp), maskEmail(data.email), data.area ?? 'Posgrado');
  return filaDeRango(response.data.updates?.updatedRange);
}

/**
 * Completa una fila que ya existe (nombre, correo y programa). La usa quien
 * aceptó recibir información y después pidió un asesor: así queda una sola
 * fila por persona en el CRM.
 */
export async function actualizarRegistroProspecto(fila: number, data: RegistroProspecto): Promise<void> {
  const sheetId = config.google.registroPosgradoSheetId;
  if (!sheetId || !Number.isInteger(fila) || fila < 2) throw new Error('fila de registro inválida');
  const auth = new google.auth.GoogleAuth({
    credentials: config.google.serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `Registros!B${fila}:F${fila}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[data.nombre, data.email, contactIdLabel(data.whatsapp), data.programa ?? '', data.area ?? 'Posgrado']] },
  });
  console.log('[registro] prospecto completado en Sheets:', maskPhone(data.whatsapp), maskEmail(data.email));
}

/**
 * Lee todas las filas de la pestaña "Registros" del Google Sheet.
 * Devuelve array de arrays: [fecha, nombre, email, whatsapp, programa, área]
 * (las filas guardadas antes de la columna F vienen con área vacía → el
 * panel las trata como "Posgrado" para no perder el histórico).
 */
export async function leerRegistrosPosgrado(): Promise<string[][]> {
  const sheetId = config.google.registroPosgradoSheetId;
  if (!sheetId) return [];

  const auth = new google.auth.GoogleAuth({
    credentials: config.google.serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Registros!A2:F',
  });

  return response.data.values as string[][] ?? [];
}
