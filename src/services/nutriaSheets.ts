import { google } from 'googleapis';
import { config } from '../config';
import { maskPhone } from './logSafe';

export interface EncuestaNutria {
  whatsapp: string;
  edad: string;
  genero: string;
  tiempoCelular: string;
  verificarMetricas: string;
  imagenMetricas?: string;
  tiempoRedes: string;
  redPrincipal: string;
  sabeUltraprocesado: string;
  vioPublicidad: string;
  redPublicidad: string;
  publicidadMotivo: string;
  consumoBebidas: string;
  consumoPanaderia: string;
  consumoPostres: string;
  consumoMecatos: string;
  comproDespues: string;
  sellos: string;
  consumiriaSello: string;
  motivacion: string;
  comoEntero: string;
  contacto: string;
}

/**
 * Guarda una respuesta de la encuesta NutriA en Google Sheets.
 *
 * Estructura de la hoja "Encuestas" (crear manualmente):
 *   A: Fecha/hora     B: WhatsApp (anon)  C: Edad            D: Género
 *   E: T.Celular/día  F: VerificarMétricas G: Imagen métricas H: T.Redes/día
 *   I: Red principal  J: Sabía UP         K: Vio publicidad  L: Red publicidad
 *   M: Publicidad motivó N: Bebidas/sem   O: Panadería/sem   P: Postres/sem
 *   Q: Mecatos/sem    R: Compró x redes   S: Sellos          T: Consomiría sello
 *   U: Motivación     V: Cómo se enteró   W: Contacto futuro
 *
 * Tip analista: para ver la imagen dentro de la celda usa =IMAGE(G2)
 *
 * Compartir el sheet con el service account con permisos de Editor.
 */
export async function guardarEncuestaNutria(data: EncuestaNutria): Promise<void> {
  const sheetId = config.nutria.sheetId;
  if (!sheetId) {
    console.warn('[nutria] NUTRIA_SHEET_ID no configurado — guardando solo en logs');
    console.log('[nutria] ENCUESTA:', JSON.stringify(data));
    return;
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

  // El número se guarda COMPLETO en el Sheet privado, a propósito: la
  // campaña contacta a quien marcó "contacto: Sí". La variable se llamaba
  // `whatsappAnon`, que era mentira, y esa mentira sostenía la idea de que
  // la fila era anónima: sobre esa idea se publicó el endpoint de lectura
  // sin autenticación. Quien lo exponga hacia fuera lo enmascara en la
  // ruta (ver `routes/tools/nutria.ts`).
  const whatsapp = data.whatsapp;

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'A:W',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        ahora,
        whatsapp,
        data.edad,
        data.genero,
        data.tiempoCelular,
        data.verificarMetricas,
        data.imagenMetricas ?? '',
        data.tiempoRedes,
        data.redPrincipal,
        data.sabeUltraprocesado,
        data.vioPublicidad,
        data.redPublicidad,
        data.publicidadMotivo,
        data.consumoBebidas,
        data.consumoPanaderia,
        data.consumoPostres,
        data.consumoMecatos,
        data.comproDespues,
        data.sellos,
        data.consumiriaSello,
        data.motivacion,
        data.comoEntero,
        data.contacto,
      ]],
    },
  });

  console.log('[nutria] encuesta guardada:', maskPhone(whatsapp), data.edad, data.genero);
}

/**
 * Lee todas las encuestas guardadas.
 * Devuelve array de arrays: columnas A-U desde fila 2.
 */
export async function leerEncuestasNutria(): Promise<string[][]> {
  const sheetId = config.nutria.sheetId;
  if (!sheetId) return [];

  const auth = new google.auth.GoogleAuth({
    credentials: config.google.serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'A2:W',
  });

  return (response.data.values as string[][]) ?? [];
}
