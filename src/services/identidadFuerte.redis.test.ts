import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

/**
 * Identidad fuerte contra un Redis REAL (los scripts Lua no se pueden probar con
 * un doble). Se salta salvo TOOLI_TEST_REDIS=1, igual que identityService.redis.test.ts.
 * Ejemplo: docker run -d -p 6392:6379 redis:7-alpine y
 *   TOOLI_TEST_REDIS=1 REDIS_URL=redis://localhost:6392 npm test
 */
test('código estudiantil atado al vínculo: compatibilidad, unicidad, herencia y revocación', {
  skip: process.env.TOOLI_TEST_REDIS !== '1',
}, async () => {
  const clave = randomBytes(32);
  process.env.TOOLI_ACADEMICO_CLAVE = clave.toString('hex');
  const { default: Redis } = await import('ioredis');
  const { config } = await import('../config');
  const id = await import('./identityService');
  const { descifrar } = await import('./academico/cifrado');
  const redis = new Redis(config.redis.url);
  const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
  const tel = (n: number) => `test${sfx}${n}`;
  const correo = (n: number) => `ana${n}.${sfx}@utb.edu.co`;
  const codigo = `T${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const codigo2 = codigo.replace(/\d$/, (d) => String((Number(d) + 1) % 10));
  const emailKey = (e: string) => `identity-email:${createHash('sha256').update(e).digest('hex')}`;
  const sembrarViejo = async (t: string, e: string) => {
    // Vínculo anterior a la identidad fuerte: solo correo y fecha.
    await redis.setex(`identity:${t}`, 3600, JSON.stringify({ email: e, verifiedAt: Date.now() }));
    await redis.setex(emailKey(e), 3600, t);
  };
  const sembrarOtp = async (t: string, e: string, c: string) => {
    const codeHash = createHmac('sha256', config.auth.jwtSecret).update(`${t}:${c}`).digest('hex');
    await redis.setex(`otp:${t}`, 600, JSON.stringify({ email: e, codeHash, tries: 0 }));
  };
  try {
    // 1. Un vínculo viejo sigue valiendo y no trae código.
    await sembrarViejo(tel(1), correo(1));
    const viejo = await id.getIdentity(tel(1));
    assert.equal(viejo?.email, correo(1));
    assert.equal(viejo?.codigo, undefined);

    // 2. Atar el código no cambia el vencimiento del vínculo y deja la cédula cifrada.
    const ttlAntes = await redis.ttl(`identity:${tel(1)}`);
    assert.equal(await id.guardarCodigoEstudiantil(tel(1), {
      codigo, verificado: true, fuente: 'iceberg', nombre: 'ANA PEREZ', cedula: '1045678901',
    }), 'ok');
    const atado = await id.getIdentity(tel(1));
    assert.equal(atado?.codigo, codigo);
    assert.equal(atado?.codigoVerificado, true);
    assert.equal(atado?.nombre, 'ANA PEREZ');
    const ttlDespues = await redis.ttl(`identity:${tel(1)}`);
    assert.ok(ttlDespues > 0 && ttlDespues <= ttlAntes, `TTL ${ttlAntes} -> ${ttlDespues}`);
    const crudo = (await redis.get(`identity:${tel(1)}`)) ?? '';
    assert.ok(!crudo.includes('1045678901'), 'la cédula no queda en claro');
    assert.equal(descifrar(atado?.cedulaCifrada ?? '', `cedula:${tel(1)}`, clave), '1045678901');

    // 3. Búsqueda inversa por código y por cédula.
    assert.equal((await id.buscarIdentidadPorCodigo(codigo))?.telefono, tel(1));
    assert.equal((await id.buscarIdentidadPorCedula('1.045.678.901'))?.telefono, tel(1));
    assert.equal(await id.buscarIdentidadPorCodigo(codigo2), null);
    assert.equal(await id.buscarIdentidadPorCodigo('basura'), null);

    // 4. El mismo código no se ata a otro correo vigente.
    await sembrarViejo(tel(2), correo(2));
    assert.equal(await id.guardarCodigoEstudiantil(tel(2), { codigo, verificado: true, fuente: 'iceberg' }), 'en_uso');
    assert.equal((await id.getIdentity(tel(2)))?.codigo, undefined);
    // Sin vínculo no hay a qué atar el código.
    assert.equal(await id.guardarCodigoEstudiantil(tel(9), { codigo: codigo2, verificado: true, fuente: 'iceberg' }), 'sin_identidad');
    assert.equal(await id.guardarCodigoEstudiantil(tel(1), { codigo: 'mal', verificado: true, fuente: 'iceberg' }), 'formato');

    // 5. Renovar con el mismo correo conserva el código.
    await sembrarOtp(tel(1), correo(1), '111111');
    assert.deepEqual(await id.checkCode(tel(1), '111111'), { ok: true, email: correo(1) });
    assert.equal((await id.getIdentity(tel(1)))?.codigo, codigo);
    assert.equal((await id.buscarIdentidadPorCodigo(codigo))?.telefono, tel(1));

    // 6. Verificar el mismo correo desde otro teléfono hereda el código (no la cédula cifrada) y repunta el índice.
    await sembrarOtp(tel(3), correo(1), '222222');
    assert.deepEqual(await id.checkCode(tel(3), '222222'), { ok: true, email: correo(1) });
    const nuevo = await id.getIdentity(tel(3));
    assert.equal(nuevo?.codigo, codigo);
    assert.equal(nuevo?.codigoVerificado, true);
    assert.equal(nuevo?.cedulaCifrada, undefined, 'la cédula cifrada está atada al número anterior y no viaja');
    assert.equal(await id.getIdentity(tel(1)), null, 'el número anterior queda revocado');
    assert.equal((await id.buscarIdentidadPorCodigo(codigo))?.telefono, tel(3));

    // 7. Otro correo en el mismo número NO hereda nada.
    await sembrarOtp(tel(3), correo(4), '333333');
    assert.deepEqual(await id.checkCode(tel(3), '333333'), { ok: true, email: correo(4) });
    assert.equal((await id.getIdentity(tel(3)))?.codigo, undefined);

    // 8. Revocar borra el vínculo, el índice y la sesión de notas guardada.
    await sembrarViejo(tel(5), correo(5));
    assert.equal(await id.guardarCodigoEstudiantil(tel(5), { codigo: codigo2, verificado: true, fuente: 'iceberg' }), 'ok');
    await redis.setex(`notas-sesion:${tel(5)}`, 100, 'blob');
    await id.revokeIdentity(tel(5));
    assert.equal(await id.getIdentity(tel(5)), null);
    assert.equal(await id.buscarIdentidadPorCodigo(codigo2), null);
    assert.equal(await redis.get(`notas-sesion:${tel(5)}`), null);

    // 9. Un vínculo vencido no bloquea el código: otro correo puede atarlo.
    await sembrarViejo(tel(6), correo(6));
    assert.equal(await id.guardarCodigoEstudiantil(tel(6), { codigo: codigo2, verificado: true, fuente: 'iceberg' }), 'ok');
    await redis.del(`identity:${tel(6)}`);
    await sembrarViejo(tel(7), correo(7));
    assert.equal(await id.guardarCodigoEstudiantil(tel(7), { codigo: codigo2, verificado: true, fuente: 'iceberg' }), 'ok');
  } finally {
    const llaves = await redis.keys(`*${sfx}*`);
    if (llaves.length) await redis.del(...llaves);
    for (const e of [correo(1), correo(2), correo(4), correo(5), correo(6), correo(7)]) await redis.del(emailKey(e));
    redis.disconnect();
    id.closeIdentityService();
  }
});

test('índices con clave propia (#38): respaldo, «un código, un correo», migración idempotente y cédula confirmada', {
  skip: process.env.TOOLI_TEST_REDIS !== '1',
}, async () => {
  const clave = randomBytes(32);
  process.env.TOOLI_ACADEMICO_CLAVE = clave.toString('hex');
  delete process.env.TOOLI_BUSQUEDA_CLAVE;
  const { default: Redis } = await import('ioredis');
  const { config } = await import('../config');
  const id = await import('./identityService');
  const { claveBusqueda } = await import('./academico/identidadAcademica');
  const redis = new Redis(config.redis.url);
  const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
  const tel = (n: number) => `test${sfx}${n}`;
  const correo = (n: number) => `luis${n}.${sfx}@utb.edu.co`;
  const codigo = `T${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const cedula = String(Math.floor(1e9 + Math.random() * 8e9));
  const emailKey = (e: string) => `identity-email:${createHash('sha256').update(e).digest('hex')}`;
  const sembrar = async (t: string, e: string) => {
    await redis.setex(`identity:${t}`, 3600, JSON.stringify({ email: e, verifiedAt: Date.now() }));
    await redis.setex(emailKey(e), 3600, t);
  };
  const viejoCodigo = claveBusqueda('codigo', codigo, clave.toString('hex'));
  const viejoCedula = claveBusqueda('cedula', cedula, clave.toString('hex'));
  const propia = `busqueda-${sfx}-de-prueba-con-mas-de-32-caracteres`;
  const { clavesIndice, secretosBusqueda } = await import('./academico/indicesBusqueda');
  const nuevas = secretosBusqueda({ busqueda: propia, jwt: config.auth.jwtSecret });
  const creadas: string[] = [viejoCodigo, viejoCedula, clavesIndice('codigo', codigo, nuevas)[0], clavesIndice('cedula', cedula, nuevas)[0]];
  try {
    // Atado con la clave de antes (sin TOOLI_BUSQUEDA_CLAVE).
    await sembrar(tel(1), correo(1));
    assert.equal(await id.guardarCodigoEstudiantil(tel(1), { codigo, verificado: true, fuente: 'iceberg', cedula }), 'ok');
    assert.equal(await redis.get(viejoCodigo), tel(1));

    // Se activa la clave propia: respaldo y el Lua nuevo mira también el índice viejo.
    process.env.TOOLI_BUSQUEDA_CLAVE = propia;
    assert.equal((await id.buscarIdentidadPorCodigo(codigo))?.telefono, tel(1));
    assert.equal((await id.buscarIdentidadPorCedula(cedula))?.telefono, tel(1));
    await sembrar(tel(2), correo(2));
    assert.equal(await id.guardarCodigoEstudiantil(tel(2), { codigo, verificado: true, fuente: 'iceberg', cedula }), 'en_uso');

    // Migración real (SCAN, TTL, el script CAS con KEEPTTL) e idempotencia.
    const ttl = await redis.ttl(`identity:${tel(1)}`);
    const r1 = await id.migrarIndicesDeBusqueda({ aplicar: true });
    assert.ok(r1.codigos >= 1 && r1.cedulas >= 1, JSON.stringify(r1));
    const r2 = await id.migrarIndicesDeBusqueda({ aplicar: true });
    assert.equal(r2.codigos + r2.cedulas, 0, `idempotente: ${JSON.stringify(r2)}`);
    assert.equal(await redis.get(viejoCodigo), null);
    assert.equal(await redis.get(viejoCedula), null);
    const t2 = await redis.ttl(`identity:${tel(1)}`);
    assert.ok(t2 > 0 && t2 <= ttl, 'el vínculo conserva su vencimiento');
    process.env.TOOLI_ACADEMICO_CLAVE = randomBytes(32).toString('hex');
    assert.equal((await id.buscarIdentidadPorCodigo(codigo))?.telefono, tel(1), 'ya no depende de la clave AES');
    assert.equal((await id.buscarIdentidadPorCedula(cedula))?.telefono, tel(1));

    // Revocar suelta los dos índices.
    const huella = (await id.getIdentity(tel(1)))?.cedulaIndice;
    assert.match(huella ?? '', /^[0-9a-f]{64}$/);
    creadas.push(`identity-cedula:${huella}`);
    await id.revokeIdentity(tel(1));
    assert.equal(await redis.get(`identity-cedula:${huella}`), null);
    assert.equal(await id.buscarIdentidadPorCodigo(codigo), null);
  } finally {
    delete process.env.TOOLI_BUSQUEDA_CLAVE;
    const llaves = await redis.keys(`*${sfx}*`);
    if (llaves.length) await redis.del(...llaves);
    await redis.del(...creadas, emailKey(correo(1)), emailKey(correo(2)));
    redis.disconnect();
    id.closeIdentityService();
  }
});
