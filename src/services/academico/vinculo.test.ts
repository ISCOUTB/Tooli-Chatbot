import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { vincularCodigoEstudiantil, type DepsVinculo } from './vinculo';
import type { VerificadorCodigo } from './proveedores/reciboIceberg';
import { crearVerificadorCodigoIceberg, type ResultadoIceberg } from './proveedores/reciboIceberg';

function armar(over: {
  encendido?: boolean;
  vinculo?: boolean;
  verificador?: VerificadorCodigo['verificar'];
  guardar?: DepsVinculo['guardar'];
} = {}) {
  const guardados: unknown[] = [];
  const verificados: Array<[string, string]> = [];
  const deps: DepsVinculo = {
    interruptores: { recibo: () => over.encendido ?? true },
    verificador: {
      verificar: async (c, d) => { verificados.push([c, d]); return over.verificador ? over.verificador(c, d) : { estado: 'ok', nombre: 'ANA PEREZ' }; },
    },
    tieneVinculo: async () => over.vinculo ?? true,
    guardar: async (t, datos) => { guardados.push([t, datos]); return over.guardar ? over.guardar(t, datos) : 'ok'; },
  };
  return { deps, guardados, verificados };
}

const ENTRADA = { telefono: '573001112233', codigo: 't00012345', cedula: '1.045.678.901' };

describe('vincular el código estudiantil', () => {
  it('comprueba el par código+cédula contra la fuente y solo entonces lo ata, como verificado', async () => {
    const { deps, guardados, verificados } = armar();
    const r = await vincularCodigoEstudiantil(deps, ENTRADA);
    assert.deepEqual(r, { estado: 'ok', nombre: 'ANA PEREZ' });
    assert.deepEqual(verificados, [['T00012345', '1045678901']]);
    assert.deepEqual(guardados, [['573001112233', {
      codigo: 'T00012345', verificado: true, fuente: 'iceberg', cedula: '1045678901', nombre: 'ANA PEREZ',
    }]]);
  });

  it('con la fuente apagada no ata nada (un código sin comprobar no abre datos)', async () => {
    const { deps, guardados, verificados } = armar({ encendido: false });
    assert.deepEqual(await vincularCodigoEstudiantil(deps, ENTRADA), { estado: 'apagado' });
    assert.equal(guardados.length + verificados.length, 0);
  });

  it('sin vínculo por correo no se puede atar un código', async () => {
    const { deps, verificados } = armar({ vinculo: false });
    assert.deepEqual(await vincularCodigoEstudiantil(deps, ENTRADA), { estado: 'sin_identidad' });
    assert.equal(verificados.length, 0, 'ni siquiera se gasta un login en el portal');
  });

  it('código o cédula con formato malo se rechazan antes de ir al portal', async () => {
    const { deps, verificados } = armar();
    assert.deepEqual(await vincularCodigoEstudiantil(deps, { ...ENTRADA, codigo: '123' }), { estado: 'formato_codigo' });
    assert.deepEqual(await vincularCodigoEstudiantil(deps, { ...ENTRADA, cedula: 'abc' }), { estado: 'formato_cedula' });
    assert.equal(verificados.length, 0);
  });

  it('código que no es de esa cédula: no_coincide y no se guarda', async () => {
    const { deps, guardados } = armar({ verificador: async () => ({ estado: 'no_coincide' }) });
    assert.deepEqual(await vincularCodigoEstudiantil(deps, ENTRADA), { estado: 'no_coincide' });
    assert.equal(guardados.length, 0);
  });

  it('error del portal: error y no se guarda', async () => {
    const { deps, guardados } = armar({ verificador: async () => ({ estado: 'error' }) });
    assert.deepEqual(await vincularCodigoEstudiantil(deps, ENTRADA), { estado: 'error' });
    assert.equal(guardados.length, 0);
  });

  it('código ajeno: si ya está atado a OTRO correo vigente, en_uso', async () => {
    const { deps } = armar({ guardar: async () => 'en_uso' });
    assert.deepEqual(await vincularCodigoEstudiantil(deps, ENTRADA), { estado: 'en_uso' });
  });
});

describe('verificador contra Iceberg (el portal acepta el par solo si es de la misma persona)', () => {
  const con = (r: ResultadoIceberg | Error) => crearVerificadorCodigoIceberg(async () => { if (r instanceof Error) throw r; return r; });

  it('entrar al portal prueba el par, aunque no haya recibos', async () => {
    assert.deepEqual(await con({ ok: true, noRecibos: true, nombre: 'ANA', cedula: '1045678901' }).verificar('T00012345', '1045678901'), { estado: 'ok', nombre: 'ANA' });
  });

  it('una descarga fallida después de entrar sigue siendo un par válido', async () => {
    assert.equal((await con({ ok: false, error: 'falló la descarga', nombre: 'ANA' }).verificar('T00012345', '1045678901')).estado, 'ok');
  });

  it('si el portal muestra OTRA cédula, no coincide', async () => {
    assert.equal((await con({ ok: true, nombre: 'ANA', cedula: '999999999' }).verificar('T00012345', '1045678901')).estado, 'no_coincide');
  });

  it('login fallido: no_coincide; falla técnica o excepción: error', async () => {
    assert.equal((await con({ ok: false, error: 'Login falló tras 5 intentos' }).verificar('T00012345', '1045678901')).estado, 'no_coincide');
    assert.equal((await con({ ok: false, error: 'No se pudo completar la consulta del portal' }).verificar('T00012345', '1045678901')).estado, 'error');
    assert.equal((await con(new Error('boom clave=xyz')).verificar('T00012345', '1045678901')).estado, 'error');
  });
});
