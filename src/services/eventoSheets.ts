import { google } from 'googleapis';
import { config } from '../config';
import { maskPhone } from './logSafe';

export interface RegistroEvento {
  whatsapp: string;
  nombre: string;
  esEstudianteUTB: string;
  carrera: string;
  diplomado: string;
  interesaPosgrado: string;
  aceptaContacto: string;
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
 * Guarda un registro del evento Talento Tech en Google Sheets.
 * Devuelve el número de fila donde quedó (para luego actualizar la confirmación),
 * o 0 si no se pudo determinar / no hay hoja configurada.
 *
 * Estructura de la hoja (crear manualmente y compartir con el service account
 * como Editor):
 *   A: Fecha/hora   B: WhatsApp           C: Nombre              D: ¿Estudiante UTB?
 *   E: Carrera      F: Diplomado          G: ¿Interesa posgrado? H: ¿Acepta contacto?
 *   I: ¿Confirma asistencia sábado?
 */
export async function guardarRegistroEvento(data: RegistroEvento): Promise<number> {
  const sheetId = config.evento.sheetId;
  if (!sheetId) {
    console.warn('[evento] EVENTO_SHEET_ID no configurado — registro no persistido', {
      whatsapp: maskPhone(data.whatsapp),
      aceptaContacto: data.aceptaContacto,
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
    range: 'A:I',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        ahora,
        data.whatsapp,
        data.nombre,
        data.esEstudianteUTB,
        data.carrera,
        data.diplomado,
        data.interesaPosgrado,
        data.aceptaContacto,
        '', // I: confirmación (se completa al confirmar asistencia)
      ]],
    },
  });

  console.log('[evento] registro guardado:', maskPhone(data.whatsapp), '·', data.diplomado);

  // Extraer el número de fila del rango actualizado, ej: "Hoja1!A45:I45" → 45
  const updatedRange = res.data.updates?.updatedRange ?? '';
  const match = updatedRange.match(/![A-Z]+(\d+):/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Actualiza la columna I (confirmación de asistencia) de una fila ya guardada.
 */
export async function actualizarConfirmacionEvento(fila: number, valor: string): Promise<void> {
  const sheetId = config.evento.sheetId;
  if (!sheetId || !fila) return;

  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `I${fila}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[valor]] },
  });

  console.log('[evento] confirmación actualizada — fila', fila, ':', valor);
}

/**
 * Lee todos los registros guardados (columnas A-I desde la fila 2).
 */
export async function leerRegistrosEvento(): Promise<string[][]> {
  const sheetId = config.evento.sheetId;
  if (!sheetId) return [];

  const sheets = getSheetsClient(true);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'A2:I',
  });

  return (response.data.values as string[][]) ?? [];
}
