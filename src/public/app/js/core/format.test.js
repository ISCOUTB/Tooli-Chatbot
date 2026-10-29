import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* format.js importa de dom.js, que usa `document` al cargarse. Acá no hay
   navegador, así que se le da lo mínimo para que el módulo se pueda importar:
   ninguna de las funciones que se prueban toca el DOM. */
globalThis.document ??= {
  querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
  body: { appendChild() {} },
};

let F;
before(async () => { F = await import('./format.js'); });

describe('avatarTone', () => {
  it('el mismo dato siempre da el mismo color', () => {
    assert.equal(F.avatarTone('573001234567'), F.avatarTone('573001234567'));
  });

  it('el color siempre sale de la paleta', () => {
    for (const semilla of ['573001234567', 'luis', 'ana', '', 'ñandú']) {
      assert.ok(F.AVATAR_TONES.includes(F.avatarTone(semilla)), `color fuera de paleta para "${semilla}"`);
    }
  });
});

describe('initialsFor', () => {
  it('con nombre usa las dos primeras iniciales, en mayúscula', () => {
    assert.equal(F.initialsFor('573001234567', 'maría josé restrepo'), 'MJ');
  });

  it('con un solo nombre devuelve una inicial', () => {
    assert.equal(F.initialsFor('573001234567', 'Carlos'), 'C');
  });

  it('sin nombre cae en los dos últimos dígitos del teléfono', () => {
    assert.equal(F.initialsFor('573001234567'), '67');
  });

  it('no se rompe con espacios de más', () => {
    assert.equal(F.initialsFor('573001234567', '  ana   díaz  '), 'AD');
  });
});

describe('relativeTime', () => {
  const ahora = Date.now();

  it('menos de un minuto es "ahora"', () => {
    assert.equal(F.relativeTime(ahora - 10_000), 'ahora');
  });

  it('minutos y horas en la escala corta', () => {
    assert.equal(F.relativeTime(ahora - 5 * 60_000), '5 min');
    assert.equal(F.relativeTime(ahora - 3 * 3600_000), '3 h');
  });

  it('días hasta la semana', () => {
    assert.equal(F.relativeTime(ahora - 2 * 864e5), '2 d');
  });

  it('pasada la semana muestra la fecha, no "37 d"', () => {
    const texto = F.relativeTime(ahora - 10 * 864e5);
    assert.ok(!texto.endsWith(' d'), `siguió contando días: "${texto}"`);
    assert.match(texto, /\d/);
  });
});

describe('friendlyDate', () => {
  it('devuelve vacío cuando no hay dato', () => {
    assert.equal(F.friendlyDate(''), '');
    assert.equal(F.friendlyDate(undefined), '');
  });

  it('devuelve el texto tal cual si no es una fecha', () => {
    // Las filas del Sheet a veces traen texto escrito a mano: mejor mostrarlo
    // que mostrar "Invalid Date".
    assert.equal(F.friendlyDate('sin fecha'), 'sin fecha');
  });

  it('formatea una fecha real con día, mes, año y hora', () => {
    const texto = F.friendlyDate('2026-09-11T12:18:00Z');
    assert.match(texto, /2026/);
    assert.match(texto, /sept/);
    assert.ok(texto.includes('·'), 'falta el separador entre fecha y hora');
  });
});

describe('csvEscape', () => {
  it('deja intacto lo que no necesita comillas', () => {
    assert.equal(F.csvEscape('Maestría en Ingeniería'), 'Maestría en Ingeniería');
  });

  it('entrecomilla cuando hay separadores', () => {
    assert.equal(F.csvEscape('a,b'), '"a,b"');
    assert.equal(F.csvEscape('a;b'), '"a;b"');
    assert.equal(F.csvEscape('a\nb'), '"a\nb"');
  });

  it('duplica las comillas internas, que es lo que exige el formato', () => {
    // Un escape mal hecho corre las columnas del archivo que abre el
    // coordinador en Excel, y se nota tarde.
    assert.equal(F.csvEscape('dice "hola"'), '"dice ""hola"""');
  });

  it('trata null y undefined como celda vacía', () => {
    assert.equal(F.csvEscape(null), '');
    assert.equal(F.csvEscape(undefined), '');
  });
});

describe('fechaParaCsv', () => {
  it('usa un formato que Excel entiende', () => {
    assert.match(F.fechaParaCsv('2026-09-11T12:18:00Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('devuelve el original si no es una fecha', () => {
    assert.equal(F.fechaParaCsv('no es fecha'), 'no es fecha');
  });

  it('deja la celda vacía cuando no hay fecha', () => {
    // Antes devolvía "1969-12-31 19:00" (el epoch) para las filas viejas del
    // Sheet que no traen fecha.
    assert.equal(F.fechaParaCsv(null), '');
    assert.equal(F.fechaParaCsv(undefined), '');
    assert.equal(F.fechaParaCsv(''), '');
  });
});

describe('formatTelefono', () => {
  it('agrupa un celular colombiano como se lee en voz alta', () => {
    assert.equal(F.formatTelefono('573001234567'), '+57 300 123 4567');
    assert.equal(F.formatTelefono('+57 300-123-4567'), '+57 300 123 4567');
  });

  it('otros números conservan sus dígitos con +, sin inventar grupos', () => {
    assert.equal(F.formatTelefono('15551234567'), '+15551234567');
    assert.equal(F.formatTelefono('5753001234'), '+5753001234');
  });

  it('sin número devuelve vacío para que la pantalla ponga su guion', () => {
    assert.equal(F.formatTelefono(''), '');
    assert.equal(F.formatTelefono(undefined), '');
  });
});

describe('formatWhatsApp', () => {
  it('aplica los cuatro formatos de WhatsApp', () => {
    assert.equal(F.formatWhatsApp('esto *va* fin'), 'esto <strong>va</strong> fin');
    assert.equal(F.formatWhatsApp('esto _va_ fin'), 'esto <em>va</em> fin');
    assert.equal(F.formatWhatsApp('esto ~va~ fin'), 'esto <s>va</s> fin');
    assert.equal(F.formatWhatsApp('ver ```codigo``` fin'), 'ver <code>codigo</code> fin');
  });

  it('convierte los saltos de línea', () => {
    assert.equal(F.formatWhatsApp('uno\ndos'), 'uno<br>dos');
  });

  it('no convierte marcas sueltas dentro de una palabra', () => {
    // Se aplica sobre texto escrito por estudiantes: "son 2*3 cosas" o
    // "archivo_de_prueba" no deben salir en negrita ni en cursiva.
    assert.equal(F.formatWhatsApp('son 2*3 cosas'), 'son 2*3 cosas');
    assert.equal(F.formatWhatsApp('archivo_de_prueba'), 'archivo_de_prueba');
  });

  it('respeta el signo de puntuación pegado al cierre', () => {
    assert.equal(F.formatWhatsApp('es *importante*.'), 'es <strong>importante</strong>.');
  });
});
