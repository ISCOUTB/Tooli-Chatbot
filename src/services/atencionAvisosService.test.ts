import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConversacionEnEspera } from './atencionEquipoService';
import {
  actualizarPrimeraVez,
  AsesorAvisos,
  planificarAvisosCorreo,
  textoAvisoCorreo,
} from './atencionAvisosService';

const AHORA = 4_000_000;
const enEspera: ConversacionEnEspera[] = [
  { id: 1, area: 'admisiones' },
  { id: 2, area: 'ti' },
];
const asesor = (cambios: Partial<AsesorAvisos> = {}): AsesorAvisos => ({
  username: 'ana',
  email: 'ana@example.com',
  area: 'admisiones',
  vinculado: true,
  conectado: false,
  estado: 'disponible',
  ultimoAviso: 0,
  ...cambios,
});

describe('planificación de avisos por correo', () => {
  it('solo cuenta lo que lleva dos minutos o más', () => {
    const plan = planificarAvisosCorreo({
      enEspera: [{ id: 1, area: 'admisiones' }, { id: 3, area: 'admisiones' }, { id: 4, area: 'admisiones' }],
      primeraVez: new Map([[1, AHORA - 120_000], [3, AHORA - 119_999]]),
      asesores: [asesor()],
      ahora: AHORA,
    });
    assert.deepEqual(plan[0].porArea, { ti: 0, admisiones: 1 });
  });

  it('omite el área con alguien conectado y Disponible, pero avisa por la otra', () => {
    const plan = planificarAvisosCorreo({
      enEspera,
      primeraVez: new Map([[1, AHORA - 120_000], [2, AHORA - 120_000]]),
      asesores: [
        asesor({ username: 'conectada', conectado: true }),
        asesor({ username: 'general', area: 'all' }),
      ],
      ahora: AHORA,
    });
    assert.deepEqual(plan, [{ username: 'general', email: 'ana@example.com', porArea: { ti: 1, admisiones: 0 } }]);
  });

  it('excluye panel abierto, Ausente, correo vacío y asesor sin vínculo', () => {
    const primeraVez = new Map([[1, AHORA - 120_000]]);
    const plan = planificarAvisosCorreo({
      enEspera: [enEspera[0]], primeraVez, ahora: AHORA,
      asesores: [
        asesor({ username: 'abierta', conectado: true, estado: 'ocupado' }),
        asesor({ username: 'ausente', estado: 'ausente' }),
        asesor({ username: 'sin-correo', email: '  ' }),
        asesor({ username: 'sin-vinculo', vinculado: false }),
      ],
    });
    assert.deepEqual(plan, []);
  });

  it('respeta treinta minutos desde el último aviso', () => {
    const datos = { enEspera: [enEspera[0]], primeraVez: new Map([[1, AHORA - 120_000]]), ahora: AHORA };
    assert.deepEqual(planificarAvisosCorreo({ ...datos, asesores: [asesor({ ultimoAviso: AHORA - 29 * 60_000 })] }), []);
    assert.equal(planificarAvisosCorreo({ ...datos, asesores: [asesor({ ultimoAviso: AHORA - 30 * 60_000 })] }).length, 1);
  });

  it('el área all suma ambas y TI solo suma TI', () => {
    const plan = planificarAvisosCorreo({
      enEspera,
      primeraVez: new Map([[1, AHORA - 120_000], [2, AHORA - 120_000]]),
      asesores: [asesor({ username: 'general', area: 'all' }), asesor({ username: 'soporte', area: 'ti' })],
      ahora: AHORA,
    });
    assert.deepEqual(plan.map((item) => item.porArea), [
      { ti: 1, admisiones: 1 },
      { ti: 1, admisiones: 0 },
    ]);
  });
});

describe('seguimiento del inicio de la espera', () => {
  it('conserva, agrega y descarta sin mutar el mapa anterior', () => {
    const anterior = new Map([[1, 100], [2, 200]]);
    const actualizado = actualizarPrimeraVez(anterior, [2, 3], 500);
    assert.deepEqual([...actualizado], [[2, 200], [3, 500]]);
    assert.deepEqual([...anterior], [[1, 100], [2, 200]]);
    assert.notEqual(actualizado, anterior);
  });
});

describe('contenido del aviso', () => {
  it('usa singular y plural, omite el área en cero y normaliza el enlace', () => {
    const uno = textoAvisoCorreo({ admisiones: 1, ti: 0 }, 'https://panel.example/');
    assert.match(uno.text, /1 conversación de Admisiones/);
    assert.doesNotMatch(uno.text, /TI/);
    assert.match(uno.text, /https:\/\/panel\.example\/app\/#atencion/);
    assert.doesNotMatch(uno.text, /panel\.example\/\/app/);

    const varias = textoAvisoCorreo({ admisiones: 2, ti: 1 }, 'https://panel.example///');
    assert.match(varias.text, /2 conversaciones de Admisiones y 1 conversación de TI/);
    assert.match(varias.html, /https:\/\/panel\.example\/app\/#atencion/);
    for (const datoPersonal of ['Ana', '573001234567', 'Hola, necesito ayuda']) {
      assert.doesNotMatch(`${varias.subject}${varias.text}${varias.html}`, new RegExp(datoPersonal));
    }
  });
});
