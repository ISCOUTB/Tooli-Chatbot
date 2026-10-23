import axios from 'axios';
import { config } from '../config';
import { describeError, describeId } from './logSafe';

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

    if (config.chatwoot.inboxId) {
      await axios.post(
        `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/inbox_members`,
        { inbox_id: config.chatwoot.inboxId, user_ids: [userId] },
        { headers: { api_access_token: config.chatwoot.apiToken }, timeout: 10_000 }
      ).catch((err: unknown) => {
        console.warn('[chatwoot-sso] no se pudo agregar al inbox:', describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
      });
    }

    for (const teamId of params.teamIds ?? []) {
      await axios.post(
        `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/teams/${teamId}/team_members`,
        { user_ids: [userId] },
        { headers: { api_access_token: config.chatwoot.apiToken }, timeout: 10_000 }
      ).catch((err: unknown) => {
        console.warn(`[chatwoot-sso] no se pudo agregar al equipo ${describeId(teamId)}:`, describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
      });
    }
  }

  return { userId };
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
