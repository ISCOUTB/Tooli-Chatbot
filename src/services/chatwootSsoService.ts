import axios from 'axios';
import { randomBytes } from 'crypto';
import { config } from '../config';
import { describeError, describeId } from './logSafe';

export function equiposPorArea(
  area: 'ti' | 'admisiones' | 'all' | undefined,
  tiId: string,
  admisionesId: string
): number[] {
  const ids: number[] = [];
  const agregar = (value: string) => {
    const id = Number(value.trim());
    if (Number.isSafeInteger(id) && id > 0) ids.push(id);
  };
  if (area === 'ti' || area === 'all') agregar(tiId);
  if (area === 'admisiones' || area === 'all') agregar(admisionesId);
  return ids;
}

export function buscarAgentePorCorreo(agentes: unknown[], correo: string): number | null {
  const buscado = correo.trim().toLowerCase();
  for (const agente of agentes) {
    if (!agente || typeof agente !== 'object') continue;
    const value = agente as Record<string, unknown>;
    if (typeof value.email !== 'string' || value.email.trim().toLowerCase() !== buscado) continue;
    if (typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0) return value.id;
  }
  return null;
}

export function claveAleatoriaAtencion(): string {
  // El prefijo garantiza la política y los bytes aleatorios evitan reutilizar
  // una credencial que, aunque nadie escriba, sigue siendo válida en Chatwoot.
  return `Aa1!${randomBytes(18).toString('base64url')}`;
}

export type AtencionVinculoErrorCode = 'no_configurado' | 'sin_plataforma' | 'correo_en_uso';

export class AtencionVinculoError extends Error {
  constructor(public codigo: AtencionVinculoErrorCode, message: string) {
    super(message);
    this.name = 'AtencionVinculoError';
  }
}

type DatosAgente = {
  email: string;
  name: string;
  role: 'agent' | 'administrator';
  teamIds: number[];
};

async function completarInboxYEquipos(userId: number, teamIds: number[]): Promise<void> {
  if (!config.chatwoot.url || !config.chatwoot.accountId || !config.chatwoot.apiToken) return;
  const requestConfig = {
    headers: { api_access_token: config.chatwoot.apiToken },
    timeout: 10_000,
  };
  if (config.chatwoot.inboxId) {
    await axios.post(
      `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/inbox_members`,
      { inbox_id: config.chatwoot.inboxId, user_ids: [userId] },
      requestConfig
    ).catch((err: unknown) => {
      console.warn('[chatwoot-sso] no se pudo agregar al inbox:', describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
    });
  }
  for (const teamId of teamIds) {
    await axios.post(
      `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/teams/${teamId}/team_members`,
      { user_ids: [userId] },
      requestConfig
    ).catch((err: unknown) => {
      console.warn(`[chatwoot-sso] no se pudo agregar al equipo ${describeId(teamId)}:`, describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
    });
  }
}

/**
 * Crea un usuario en Chatwoot vía Platform API y lo agrega a la cuenta como agente.
 * Requiere CHATWOOT_PLATFORM_TOKEN configurado (creado en Super Admin → Platform Apps).
 *
 * Devuelve { userId } o lanza si falla.
 */
export async function createChatwootUser(params: {
  email: string;
  name: string;
  password: string;
  role?: 'agent' | 'administrator';
  teamIds?: number[];
}): Promise<{ userId: number }> {
  if (!config.chatwoot.platformToken || !config.chatwoot.url) {
    throw new Error('chatwoot_platform_not_configured');
  }

  const headers = { api_access_token: config.chatwoot.platformToken };

  const userRes = await axios.post(
    `${config.chatwoot.url}/platform/api/v1/users`,
    {
      name: params.name,
      email: params.email,
      password: params.password,
      custom_attributes: { source: 'tooli-asesores' },
    },
    { headers, timeout: 10_000 }
  );
  const userId = userRes.data?.id;
  if (!userId) throw new Error('chatwoot_user_creation_failed');

  if (config.chatwoot.accountId && config.chatwoot.apiToken) {
    await axios.post(
      `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/agents`,
      { email: params.email, name: params.name, role: params.role ?? 'agent' },
      { headers: { api_access_token: config.chatwoot.apiToken }, timeout: 10_000 }
    ).catch((err: unknown) => {
      console.warn('[chatwoot-sso] no se pudo asociar usuario a cuenta:', describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
    });

    await completarInboxYEquipos(userId, params.teamIds ?? []);
  }

  return { userId };
}

async function leerAgentes(): Promise<unknown[]> {
  const res = await axios.get(
    `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/agents`,
    { headers: { api_access_token: config.chatwoot.apiToken }, timeout: 10_000 }
  );
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Vincula a un usuario ya creado en el panel. Primero busca un agente de la
 * cuenta con su correo, para no duplicar a quien ya atendía en Chatwoot; si no
 * hay, lo crea como al dar de alta un usuario. La clave es aleatoria porque la
 * persona entra al panel, no a Chatwoot, y el panel nunca conoce su contraseña.
 */
export async function vincularAgenteAtencion(params: DatosAgente): Promise<{ userId: number; creado: boolean }> {
  if (!config.chatwoot.url || !config.chatwoot.accountId || !config.chatwoot.apiToken) {
    throw new AtencionVinculoError('no_configurado', 'La atención no está configurada en este servidor.');
  }
  const existente = buscarAgentePorCorreo(await leerAgentes(), params.email);
  if (existente) {
    await completarInboxYEquipos(existente, params.teamIds);
    return { userId: existente, creado: false };
  }
  if (!config.chatwoot.platformToken) {
    throw new AtencionVinculoError('sin_plataforma', 'No hay una cuenta de Atención con ese correo y este servidor no puede crearla.');
  }
  try {
    const creado = await createChatwootUser({ ...params, password: claveAleatoriaAtencion() });
    return { userId: creado.userId, creado: true };
  } catch (err: unknown) {
    if (!axios.isAxiosError(err) || err.response?.status !== 422) throw err;
  }

  await axios.post(
    `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/agents`,
    { email: params.email, name: params.name, role: params.role },
    { headers: { api_access_token: config.chatwoot.apiToken }, timeout: 10_000 }
  ).catch((err: unknown) => {
    // La lectura siguiente decide si la asociación funcionó; aquí no se expone
    // el cuerpo que Chatwoot suele completar con el correo en conflicto.
    console.warn('[chatwoot-sso] no se pudo asociar el usuario existente:', describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
  });
  const asociado = buscarAgentePorCorreo(await leerAgentes(), params.email);
  if (!asociado) {
    throw new AtencionVinculoError('correo_en_uso', 'Ese correo ya tiene una cuenta en Chatwoot que no se pudo agregar a Atención.');
  }
  await completarInboxYEquipos(asociado, params.teamIds);
  return { userId: asociado, creado: false };
}

/**
 * Genera la URL SSO para un usuario de Chatwoot. Esta URL contiene un token
 * de un solo uso que loguea automáticamente al asesor.
 */
export async function getChatwootSsoUrl(chatwootUserId: number): Promise<string> {
  if (!config.chatwoot.platformToken || !config.chatwoot.url) {
    throw new Error('chatwoot_platform_not_configured');
  }
  const res = await axios.get(
    `${config.chatwoot.url}/platform/api/v1/users/${chatwootUserId}/login`,
    {
      headers: { api_access_token: config.chatwoot.platformToken },
      timeout: 10_000,
    }
  );
  const url = res.data?.url;
  if (!url) throw new Error('chatwoot_sso_url_failed');
  // Replace internal Docker hostname with the public URL accessible from the browser
  if (config.publicUrls.chatwoot) {
    const internalOrigin = new URL(config.chatwoot.url).origin;
    const publicOrigin = new URL(config.publicUrls.chatwoot).origin;
    return url.replace(internalOrigin, publicOrigin);
  }
  return url;
}

export function isChatwootSsoEnabled(): boolean {
  return !!(config.chatwoot.platformToken && config.chatwoot.url);
}

export async function deleteChatwootUser(chatwootUserId: number): Promise<void> {
  if (!config.chatwoot.platformToken || !config.chatwoot.url) return;
  await axios.delete(
    `${config.chatwoot.url}/platform/api/v1/users/${chatwootUserId}`,
    { headers: { api_access_token: config.chatwoot.platformToken }, timeout: 10_000 }
  ).catch((err: unknown) => {
    console.warn('[chatwoot-sso] no se pudo eliminar usuario:', describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
  });
}
