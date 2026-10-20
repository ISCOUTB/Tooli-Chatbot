/** Acceso de solo lectura a cursos de Savio (Moodle). No recibe contraseñas de estudiantes. */
export interface SavioCourse {
  id: number;
  name: string;
  url: string;
}

export interface SavioCoursesResult {
  accountFound: boolean;
  courses: SavioCourse[];
}

export class SavioServiceError extends Error {
  constructor() { super('Savio no está disponible para esta consulta'); }
}

const SAVIO_ORIGIN = 'https://savio.utb.edu.co';
const API_URL = `${SAVIO_ORIGIN}/webservice/rest/server.php`;
const INSTITUTIONAL_EMAIL = /^[^\s@]+@(utb\.edu\.co|utbvirtual\.edu\.co)$/i;

export function savioEnabled(): boolean {
  return process.env.TOOLI_SAVIO_ENABLED === '1' && Boolean(process.env.SAVIO_WS_TOKEN?.trim());
}

type FetchLike = typeof fetch;

async function callSavio(
  token: string,
  wsfunction: 'core_user_get_users_by_field' | 'core_enrol_get_users_courses',
  params: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<unknown> {
  const body = new URLSearchParams({
    wstoken: token,
    wsfunction,
    moodlewsrestformat: 'json',
    ...params,
  });
  try {
    const response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new SavioServiceError();
    const contentLength = Number(response.headers.get('content-length'));
    if (contentLength > 1_000_000) throw new SavioServiceError();
    const raw = await response.text();
    if (raw.length > 1_000_000) throw new SavioServiceError();
    const payload: unknown = JSON.parse(raw);
    if (payload && typeof payload === 'object' && 'exception' in payload) throw new SavioServiceError();
    return payload;
  } catch {
    // No incluir respuesta, token, email ni URL con parámetros en los logs.
    throw new SavioServiceError();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Busca por correo verificado, exige coincidencia exacta y consulta solo sus cursos. */
export async function getSavioCoursesForEmail(
  email: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<SavioCoursesResult> {
  const normalized = email.trim().toLowerCase();
  if (!INSTITUTIONAL_EMAIL.test(normalized) || !token.trim()) throw new SavioServiceError();

  const users = await callSavio(token, 'core_user_get_users_by_field', {
    field: 'email', 'values[0]': normalized,
  }, fetchImpl);
  if (!Array.isArray(users)) throw new SavioServiceError();
  const exact = users.filter((user) => isRecord(user) &&
    typeof user.email === 'string' && user.email.trim().toLowerCase() === normalized &&
    Number.isSafeInteger(user.id) && Number(user.id) > 0);
  if (exact.length === 0) return { accountFound: false, courses: [] };
  if (exact.length !== 1) throw new SavioServiceError();

  const courses = await callSavio(token, 'core_enrol_get_users_courses', {
    userid: String((exact[0] as Record<string, unknown>).id),
  }, fetchImpl);
  if (!Array.isArray(courses)) throw new SavioServiceError();
  const safeCourses: SavioCourse[] = courses
    .filter((course) => isRecord(course) && Number.isSafeInteger(course.id) && Number(course.id) > 0 &&
      typeof course.fullname === 'string' && course.fullname.trim())
    .slice(0, 20)
    .map((course) => ({
      id: Number((course as Record<string, unknown>).id),
      name: String((course as Record<string, unknown>).fullname).replace(/\s+/g, ' ').trim().slice(0, 120),
      url: `${SAVIO_ORIGIN}/course/view.php?id=${(course as Record<string, unknown>).id}`,
    }));
  return { accountFound: true, courses: safeCourses };
}
