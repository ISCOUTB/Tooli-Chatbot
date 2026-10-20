import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSavioCoursesForEmail, SavioServiceError } from './savioService';

function fakeSavio(responses: unknown[], calls: Array<{ url: string; body: URLSearchParams; redirect: unknown }>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: new URLSearchParams(String(init?.body)),
      redirect: init?.redirect,
    });
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('Savio de solo lectura', () => {
  it('usa el correo exacto y el ID devuelto por Moodle para listar cursos', async () => {
    const calls: Array<{ url: string; body: URLSearchParams; redirect: unknown }> = [];
    const fetchImpl = fakeSavio([
      [{ id: 25, email: 'ana@utb.edu.co' }, { id: 26, email: 'ana@otro.edu.co' }],
      [{ id: 15, fullname: 'Cálculo I' }, { id: 16, fullname: ' Física ' }],
    ], calls);
    const result = await getSavioCoursesForEmail(' ANA@UTB.EDU.CO ', 'token-secreto', fetchImpl);
    assert.equal(result.accountFound, true);
    assert.deepEqual(result.courses, [
      { id: 15, name: 'Cálculo I', url: 'https://savio.utb.edu.co/course/view.php?id=15' },
      { id: 16, name: 'Física', url: 'https://savio.utb.edu.co/course/view.php?id=16' },
    ]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://savio.utb.edu.co/webservice/rest/server.php');
    assert.equal(calls[0].redirect, 'error');
    assert.equal(calls[0].body.get('field'), 'email');
    assert.equal(calls[0].body.get('values[0]'), 'ana@utb.edu.co');
    assert.equal(calls[1].body.get('userid'), '25');
    assert.ok(!calls[0].url.includes('token-secreto'), 'el token no va en la URL');
  });

  it('no consulta cursos cuando Savio no devuelve una cuenta exacta', async () => {
    const calls: Array<{ url: string; body: URLSearchParams; redirect: unknown }> = [];
    const result = await getSavioCoursesForEmail('ana@utb.edu.co', 'token', fakeSavio([
      [{ id: 26, email: 'otra@utb.edu.co' }],
    ], calls));
    assert.deepEqual(result, { accountFound: false, courses: [] });
    assert.equal(calls.length, 1);
  });

  it('falla cerrado con datos ambiguos o errores Moodle', async () => {
    const calls: Array<{ url: string; body: URLSearchParams; redirect: unknown }> = [];
    await assert.rejects(
      getSavioCoursesForEmail('ana@utb.edu.co', 'token', fakeSavio([[{ id: 1, email: 'ana@utb.edu.co' }, { id: 2, email: 'ana@utb.edu.co' }]], calls)),
      SavioServiceError,
    );
    await assert.rejects(
      getSavioCoursesForEmail('ana@utb.edu.co', 'token', fakeSavio([{ exception: 'invalid_token', message: 'secret' }], [])),
      SavioServiceError,
    );
    await assert.rejects(getSavioCoursesForEmail('ana@gmail.com', 'token', fakeSavio([], [])), SavioServiceError);
  });
});
