import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSavioResumenForEmail, SavioServiceError } from './savioService';

const AHORA = new Date('2026-11-22T12:00:00Z');
const seg = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function fakeSavio(respuestas: unknown[], llamadas: URLSearchParams[]): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    llamadas.push(new URLSearchParams(String(init?.body)));
    const siguiente = respuestas.shift();
    if (siguiente instanceof Error) throw siguiente;
    return new Response(JSON.stringify(siguiente), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const USUARIO = [{ id: 25, email: 'ana@utb.edu.co' }];
const CURSOS = [{ id: 15, fullname: 'Cálculo I' }, { id: 16, fullname: 'Física' }];

describe('tareas próximas de Savio (token de servicio, solo lectura)', () => {
  it('trae las que vencen dentro de la ventana, ordenadas, y quita las ya entregadas', async () => {
    const llamadas: URLSearchParams[] = [];
    const fetchImpl = fakeSavio([
      USUARIO, CURSOS,
      {
        courses: [
          { id: 15, assignments: [
            { id: 100, name: ' Taller 1 ', duedate: seg('2026-11-25T12:00:00Z') },
            { id: 101, name: 'Ya vencida', duedate: seg('2026-11-20T12:00:00Z') },
            { id: 102, name: 'Muy lejana', duedate: seg('2027-03-01T12:00:00Z') },
            { id: 103, name: 'Sin fecha', duedate: 0 },
          ] },
          { id: 16, assignments: [
            { id: 200, name: 'Informe', duedate: seg('2026-11-24T12:00:00Z') },
            { id: 201, name: 'Entregada', duedate: seg('2026-11-26T12:00:00Z') },
          ] },
        ],
      },
      // Orden de las candidatas por fecha: Informe, Taller 1, Entregada.
      { lastattempt: { submission: { status: 'new' } } },
      { lastattempt: { submission: { status: 'draft' } } },
      { lastattempt: { submission: { status: 'submitted' } } },
    ], llamadas);
    const r = await getSavioResumenForEmail('ana@utb.edu.co', 'token-secreto', fetchImpl, AHORA);
    assert.equal(r.accountFound, true);
    assert.deepEqual(r.tareas.map((t) => [t.titulo, t.curso]), [['Informe', 'Física'], ['Taller 1', 'Cálculo I']]);
    assert.equal(r.tareas[0].vence, '2026-11-24T12:00:00.000Z');
    // Se pidió el estado de entrega SOLO de las 3 candidatas y del usuario correcto.
    const estados = llamadas.filter((p) => p.get('wsfunction') === 'mod_assign_get_submission_status');
    assert.equal(estados.length, 3);
    assert.ok(estados.every((p) => p.get('userid') === '25'));
    assert.equal(llamadas[2].get('courseids[0]'), '15');
    assert.equal(llamadas[2].get('courseids[1]'), '16');
  });

  it('si falla el estado de entrega de una tarea, se conserva (mejor avisar de más)', async () => {
    const fetchImpl = fakeSavio([
      USUARIO, [CURSOS[0]],
      { courses: [{ id: 15, assignments: [{ id: 100, name: 'Taller', duedate: seg('2026-11-25T12:00:00Z') }] }] },
      new Error('red caída'),
    ], []);
    const r = await getSavioResumenForEmail('ana@utb.edu.co', 'token', fetchImpl, AHORA);
    assert.equal(r.tareas.length, 1);
  });

  it('cuenta inexistente o sin cursos: sin tareas y sin más llamadas', async () => {
    const llamadas: URLSearchParams[] = [];
    const sinCuenta = await getSavioResumenForEmail('ana@utb.edu.co', 't', fakeSavio([[]], llamadas), AHORA);
    assert.deepEqual(sinCuenta, { accountFound: false, courses: [], tareas: [] });
    assert.equal(llamadas.length, 1);
    const sinCursos = await getSavioResumenForEmail('ana@utb.edu.co', 't', fakeSavio([USUARIO, []], []), AHORA);
    assert.deepEqual(sinCursos.tareas, []);
  });

  it('una respuesta de tareas con forma rara es error (sin filtrar la respuesta)', async () => {
    await assert.rejects(
      getSavioResumenForEmail('ana@utb.edu.co', 't', fakeSavio([USUARIO, CURSOS, { raro: true }], []), AHORA),
      SavioServiceError,
    );
  });
});
