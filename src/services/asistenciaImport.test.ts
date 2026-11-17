import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
  ImportacionInvalidaError, detectarColumnas, leerCsv, leerTablaArchivo, leerXlsx,
  normalizarCelular, normalizarCorreo, prepararImportacion, validarMapeo,
} from './asistenciaImport';

/** ZIP mínimo, suficiente para armar un .xlsx de prueba sin dependencias. */
function zip(archivos: Record<string, string>, comprimir = true): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let offset = 0;
  for (const [nombre, contenido] of Object.entries(archivos)) {
    const crudo = Buffer.from(contenido, 'utf8');
    const datos = comprimir ? deflateRawSync(crudo) : crudo;
    const nombreBuf = Buffer.from(nombre, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(comprimir ? 8 : 0, 8);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(crudo.length, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(comprimir ? 8 : 0, 10);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt32LE(crudo.length, 24);
    central.writeUInt16LE(nombreBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locales.push(local, nombreBuf, datos);
    centrales.push(central, nombreBuf);
    offset += 30 + nombreBuf.length + datos.length;
  }
  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(archivos).length, 8);
  fin.writeUInt16LE(Object.keys(archivos).length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, directorio, fin]);
}

const LIBRO = '<workbook xmlns:r="x"><sheets><sheet name="Asistentes" sheetId="1" r:id="rId7"/></sheets></workbook>';
const RELS = '<Relationships><Relationship Id="rId7" Type="t" Target="worksheets/lista.xml"/></Relationships>';

function xlsx(hoja: string, compartidas: string[] = [], comprimir = true): Buffer {
  return zip({
    'xl/workbook.xml': LIBRO,
    'xl/_rels/workbook.xml.rels': RELS,
    'xl/sharedStrings.xml': `<sst>${compartidas.map(s => `<si><t>${s}</t></si>`).join('')}</sst>`,
    'xl/worksheets/lista.xml': `<worksheet><sheetData>${hoja}</sheetData></worksheet>`,
  }, comprimir);
}

test('lee la primera hoja de un xlsx: textos compartidos, en línea y números', () => {
  const filas = leerXlsx(xlsx(
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Correo</t></is></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>3.001234567E9</v></c><c r="D2" t="s"><v>3</v></c></row>',
    ['Nombre', 'Celular', 'Ana &amp; Luis  Pérez', 'ana@utb.edu.co'],
  ));
  assert.deepEqual(filas, [
    ['Nombre', 'Celular', '', 'Correo'],
    ['Ana & Luis Pérez', '3001234567', '', 'ana@utb.edu.co'],
  ]);
});

test('un xlsx sin comprimir y con texto enriquecido también se lee', () => {
  const buf = zip({
    'xl/workbook.xml': LIBRO,
    'xl/_rels/workbook.xml.rels': RELS,
    'xl/sharedStrings.xml': '<sst><si><r><t>Nom</t></r><r><t xml:space="preserve">bre</t></r><rPh><t>fonética</t></rPh></si><si><t>María</t></si></sst>',
    'xl/worksheets/lista.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c></row><row><c t="s"><v>1</v></c></row></sheetData></worksheet>',
  }, false);
  assert.deepEqual(leerXlsx(buf), [['Nombre'], ['María']]);
});

test('un archivo que no es un Excel se rechaza con un mensaje claro', () => {
  assert.throws(() => leerXlsx(Buffer.from('esto no es un zip')), ImportacionInvalidaError);
  const xlsViejo = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(40)]);
  assert.throws(() => leerTablaArchivo(xlsViejo, 'lista.xls'), /\.xls antiguo/);
  assert.throws(() => leerTablaArchivo(Buffer.alloc(0), 'vacio.csv'), /vacío/);
});

test('una hoja que se descomprime a un tamaño desmedido se rechaza', () => {
  const bomba = zip({
    'xl/workbook.xml': LIBRO,
    'xl/_rels/workbook.xml.rels': RELS,
    'xl/worksheets/lista.xml': `<worksheet><sheetData>${'<row><c><v>1</v></c></row>'.repeat(1_200_000)}</sheetData></worksheet>`,
  });
  assert.ok(bomba.length < 1_000_000, 'el archivo de prueba debe ser pequeño comprimido');
  assert.throws(() => leerXlsx(bomba), /demasiado grande/);
});

test('lee CSV con punto y coma, comillas y saltos dentro de un campo', () => {
  const csv = 'Nombre;Correo;Programa\r\n"Pérez; Ana";ana@utb.edu.co;"Maestría en\nIngeniería"\r\nLuis "El profe";luis@x.co;\r\n';
  assert.deepEqual(leerCsv(Buffer.from(csv, 'utf8')), [
    ['Nombre', 'Correo', 'Programa'],
    ['Pérez; Ana', 'ana@utb.edu.co', 'Maestría en Ingeniería'],
    ['Luis "El profe"', 'luis@x.co', ''],
  ]);
});

test('un CSV de Excel en Latin-1 conserva las tildes', () => {
  const filas = leerCsv(Buffer.from('Nombre,Teléfono\nMaría Núñez,3001234567\n', 'latin1'));
  assert.deepEqual(filas, [['Nombre', 'Teléfono'], ['María Núñez', '3001234567']]);
});

test('reconoce las columnas por su encabezado', () => {
  assert.deepEqual(
    detectarColumnas(['Marca temporal', 'Nombres', 'Apellidos', 'Correo electrónico', 'Número de celular', 'Tipo de documento', 'Identificación', 'Nombre del programa']),
    { nombre: 1, apellido: 2, whatsapp: 4, correo: 3, documento: 6, programa: 7 },
  );
  // "Tipo de documento" trae CC/TI: sola, no se toma como el número.
  assert.equal(detectarColumnas(['Nombre', 'Tipo de documento']).documento, null);
  assert.equal(detectarColumnas(['Asistente', 'WhatsApp de contacto']).whatsapp, 1);
});

test('normaliza celulares y correos, y descarta lo que no sirve', () => {
  assert.equal(normalizarCelular('300 123 4567'), '573001234567');
  assert.equal(normalizarCelular('+57 (300) 123-4567'), '573001234567');
  assert.equal(normalizarCelular('+1 415 555 2671'), '14155552671');
  assert.equal(normalizarCelular('6601234'), '');
  assert.equal(normalizarCelular('no tiene'), '');
  assert.equal(normalizarCorreo('  Ana@UTB.edu.co '), 'ana@utb.edu.co');
  assert.equal(normalizarCorreo('ana arroba utb'), '');
});

test('toma como encabezados la fila que se reconoce, no el título del reporte', () => {
  const csv = 'Reporte de asistencia,,\n\nNombre,Celular,Correo\nAna Pérez,3001234567,ana@utb.edu.co\n,,\nSin Contacto,,\n,abc,\n';
  const preparada = prepararImportacion(leerTablaArchivo(Buffer.from(csv), 'reporte.csv'));
  assert.deepEqual(preparada.columnas, ['Nombre', 'Celular', 'Correo']);
  assert.deepEqual(preparada.asistentes, [
    { nombre: 'Ana Pérez', whatsapp: '573001234567', correo: 'ana@utb.edu.co', documento: '', programa: '' },
    { nombre: 'Sin Contacto', whatsapp: '', correo: '', documento: '', programa: '' },
  ]);
  assert.equal(preparada.totalFilas, 3);
  assert.equal(preparada.omitidas, 1, 'la fila que solo trae un celular inválido no identifica a nadie');
  assert.equal(preparada.sinWhatsapp, 1);
  assert.equal(preparada.celularesInvalidos, 1);
});

test('nombre y apellido en columnas separadas se juntan', () => {
  const tabla = leerTablaArchivo(Buffer.from('Nombres,Apellidos,Cédula\nAna María,Pérez Díaz,1.047.123.456\n'), 'l.csv');
  assert.deepEqual(prepararImportacion(tabla).asistentes[0], {
    nombre: 'Ana María Pérez Díaz', whatsapp: '', correo: '', documento: '1047123456', programa: '',
  });
});

test('el mapeo corregido a mano manda sobre el detectado y se valida', () => {
  const tabla = leerTablaArchivo(Buffer.from('A,B\nAna,3001234567\n'), 'l.csv');
  assert.throws(() => prepararImportacion(tabla), /No se reconoció ninguna columna/);
  const mapeo = validarMapeo({ nombre: 0, whatsapp: '1', correo: '' }, tabla.columnas.length);
  assert.deepEqual(prepararImportacion(tabla, mapeo).asistentes, [
    { nombre: 'Ana', whatsapp: '573001234567', correo: '', documento: '', programa: '' },
  ]);
  assert.throws(() => validarMapeo({ nombre: 9 }, 2), /no existe en el archivo/);
  assert.equal(validarMapeo(undefined, 2), null);
});
