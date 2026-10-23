import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { config } from '../config';
import { createChatwootUser, deleteChatwootUser, isChatwootSsoEnabled } from './chatwootSsoService';
import { isAcceptableNewPassword, MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from './passwordPolicy';

const redis = new Redis(config.redis.url);

export type UserRole = 'admin' | 'asesor';

export interface User {
  username: string;
  passwordHash: string;
  fullName: string;
  email?: string;
  role: UserRole;
  area?: 'ti' | 'admisiones' | 'all';
  createdAt: number;
  chatwootUserId?: number;
  sessionVersion?: string;
}

export interface PublicUser {
  username: string;
  fullName: string;
  email?: string;
  role: UserRole;
  area?: 'ti' | 'admisiones' | 'all';
  createdAt: number;
  chatwootUserId?: number;
}

const KEY = (username: string) => `user:${username.toLowerCase()}`;
const INDEX_KEY = 'users:index';

export function toPublic(u: User): PublicUser {
  const { passwordHash: _, sessionVersion: __, ...rest } = u;
  return rest;
}

export async function getUser(username: string): Promise<User | null> {
  const raw = await redis.get(KEY(username));
  return raw ? (JSON.parse(raw) as User) : null;
}

export async function listUsers(): Promise<PublicUser[]> {
  const usernames = await redis.smembers(INDEX_KEY);
  const users: PublicUser[] = [];
  for (const u of usernames) {
    const user = await getUser(u);
    if (user) users.push(toPublic(user));
  }
  return users.sort((a, b) => a.createdAt - b.createdAt);
}

export async function createUser(input: {
  username: string;
  password: string;
  fullName: string;
  email?: string;
  role?: UserRole;
  area?: 'ti' | 'admisiones' | 'all';
}): Promise<PublicUser> {
  if (typeof input.username !== 'string' || typeof input.fullName !== 'string') {
    throw new Error('Usuario y nombre son obligatorios');
  }
  const username = input.username.toLowerCase().trim();
  if (!username || username.length > 128 || !input.fullName.trim() || input.fullName.length > 200 ||
      (input.email !== undefined && (typeof input.email !== 'string' || input.email.length > 254)) ||
      (input.role !== undefined && input.role !== 'admin' && input.role !== 'asesor') ||
      (input.area !== undefined && input.area !== 'ti' && input.area !== 'admisiones' && input.area !== 'all')) {
    throw new Error('Datos de usuario inválidos');
  }
  if (!isAcceptableNewPassword(input.password)) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres y máximo ${MAX_PASSWORD_BYTES} bytes`);
  }

  const existing = await getUser(username);
  if (existing) throw new Error('El usuario ya existe');

  const user: User = {
    username,
    passwordHash: await bcrypt.hash(input.password, 10),
    fullName: input.fullName,
    email: input.email,
    role: input.role ?? 'asesor',
    area: input.area ?? 'all',
    createdAt: Date.now(),
    sessionVersion: randomUUID(),
  };

  // Si Chatwoot SSO está configurado y el usuario tiene email, crear cuenta en Chatwoot también
  if (input.email && isChatwootSsoEnabled()) {
    try {
      const teamIds: number[] = [];
      if (user.area === 'ti' || user.area === 'all') {
        const id = parseInt(config.chatwoot.teamTiId);
        if (id) teamIds.push(id);
      }
      if (user.area === 'admisiones' || user.area === 'all') {
        const id = parseInt(config.chatwoot.teamAdmisionesId);
        if (id) teamIds.push(id);
      }
      const cw = await createChatwootUser({
        email: input.email,
        name: input.fullName,
        password: input.password,
        role: user.role === 'admin' ? 'administrator' : 'agent',
        teamIds,
      });
      user.chatwootUserId = cw.userId;
      console.log(`[users] usuario ${username} creado en Chatwoot con id ${cw.userId}`);
    } catch (err: any) {
      const detail = err?.response?.data ?? err?.message;
      console.warn(`[users] no se pudo crear ${username} en Chatwoot:`, JSON.stringify(detail));
    }
  }

  await redis.set(KEY(username), JSON.stringify(user));
  await redis.sadd(INDEX_KEY, username);
  return toPublic(user);
}

export async function setChatwootUserId(username: string, chatwootUserId: number): Promise<void> {
  const user = await getUser(username);
  if (!user) throw new Error('Usuario no encontrado');
  user.chatwootUserId = chatwootUserId;
  await redis.set(KEY(username), JSON.stringify(user));
}

export async function deleteUser(username: string): Promise<void> {
  const user = await getUser(username);
  if (user?.chatwootUserId) await deleteChatwootUser(user.chatwootUserId);
  await redis.del(KEY(username));
  await redis.srem(INDEX_KEY, username.toLowerCase());
}

export async function verifyPassword(username: string, password: string): Promise<User | null> {
  const user = await getUser(username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

export async function updatePassword(username: string, newPassword: string): Promise<void> {
  if (!isAcceptableNewPassword(newPassword)) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres y máximo ${MAX_PASSWORD_BYTES} bytes`);
  }
  const user = await getUser(username);
  if (!user) throw new Error('Usuario no encontrado');
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.sessionVersion = randomUUID();
  await redis.set(KEY(username), JSON.stringify(user));
}

/**
 * Crea el usuario admin por defecto si no existe ningún usuario.
 * Se llama al arranque del servidor.
 */
export async function seedDefaultAdmin(): Promise<void> {
  const count = await redis.scard(INDEX_KEY);
  if (count > 0) {
    console.log('[users] ya hay usuarios en el sistema, no se siembra admin por defecto');
    return;
  }
  // En un despliegue nuevo sin ADMIN_PASSWORD definida, esto crearía una cuenta
  // admin/admin con acceso a datos personales de estudiantes. Mejor no arrancar
  // que arrancar con credenciales por defecto: el despliegue existente no se ve
  // afectado porque si ya hay usuarios ni se llega hasta acá.
  const usandoDefaults = config.auth.adminPassword === 'admin' || config.auth.adminPassword.length < MIN_PASSWORD_LENGTH;
  if (usandoDefaults && process.env.NODE_ENV === 'production') {
    console.error(
      '[FATAL] No hay usuarios y ADMIN_PASSWORD no está definida (o es muy corta). ' +
      'Define ADMIN_USER y ADMIN_PASSWORD antes de arrancar en producción.'
    );
    process.exit(1);
  }

  await createUser({
    username: config.auth.adminUser,
    password: config.auth.adminPassword,
    fullName: 'Administrador',
    role: 'admin',
    area: 'all',
  });
  // La contraseña NO se imprime: el log se rota, se copia y a veces se envía a
  // un servicio externo.
  console.log(`[users] usuario admin creado: ${config.auth.adminUser}`);
  if (usandoDefaults) {
    console.warn('[users] ⚠️  contraseña por defecto en uso (solo desarrollo). Define ADMIN_PASSWORD antes de publicar.');
  }
}
