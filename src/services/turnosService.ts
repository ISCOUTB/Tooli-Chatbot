import { google } from 'googleapis';
import { config } from '../config';

const SPREADSHEET_ID = '1OdXAteKM4-Dwoz4bEumZuhMat-IPP39hpKd1duS9-XQ';
const RANGE = 'A:K'; // todas las columnas

// Índices de columna (0-based)
const COL = {
  codigo:     1,  // B
  programa:   2,  // C
  nombre:     3,  // D
  apellido:   4,  // E
  turno:      5,  // F
  fechaTurno: 6,  // G
  horaTurno:  7,  // H
  fechaLimite:8,  // I
  horaLimite: 9,  // J
};

export interface TurnoInfo {
  codigo: string;
  nombre: string;
  apellido: string;
  programa: string;
  turno: string;
  fecha: string;
  hora: string;
  /** Columnas I y J de la hoja (fecha y hora límite), cuando existen. */
  fechaLimite?: string;
  horaLimite?: string;
}

function buildAuth() {
  return new google.auth.GoogleAuth({
    credentials: config.google.serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

export async function consultarTurno(codigoEstudiante: string): Promise<TurnoInfo | null> {
  const auth = buildAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });

  const rows = response.data.values ?? [];
  const codigo = codigoEstudiante.trim().toUpperCase();

  const fila = rows.find(row => {
    const celda = (row[COL.codigo] ?? '').toString().trim().toUpperCase();
    return celda === codigo;
  });

  if (!fila) return null;

  return {
    codigo,
    nombre:   fila[COL.nombre]   ?? '',
    apellido: fila[COL.apellido] ?? '',
    programa: fila[COL.programa] ?? '',
    turno:    fila[COL.turno]    ?? '',
    fecha:    fila[COL.fechaTurno] ?? '',
    hora:     fila[COL.horaTurno]  ?? '',
    ...(fila[COL.fechaLimite] ? { fechaLimite: String(fila[COL.fechaLimite]) } : {}),
    ...(fila[COL.horaLimite] ? { horaLimite: String(fila[COL.horaLimite]) } : {}),
  };
}
