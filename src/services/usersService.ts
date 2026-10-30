import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { config } from '../config';
import { createChatwootUser, deleteChatwootUser, isChatwootSsoEnabled } from './chatwootSsoService';
import { isAcceptableNewPassword, MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from './passwordPolicy';
import { normalizarUsuario, validarUsuario } from './usernamePolicy';
import { renombrarUsuarioEnAuditoria } from './auditService';
import { renombrarUsuarioEnCrm } from './crmService';
import { renombrarUsuarioEnRespuestasRapidas } from './quickRepliesService';
import { renombrarUsuarioEnMacros } from './atencionMacrosService';
import { renombrarUsuarioEnRecordatorios } from './reminderService';
import { renombrarUsuarioEnBroadcasts } from './broadcastJobService';

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

export type UserServiceErrorCode = 'invalid_username' | 'invalid_data' | 'last_admin' | 'not_found' | 'username_taken';

/** Error con un código estable para la API y un mensaje que el panel muestra tal cual. */
export class UserServiceError extends Error {
  constructor(public code: UserServiceErrorCode, message: string) {
    super(message);
  }
}

const KEY = (username: string) => `user:${username.toLowerCase()}`;
const INDEX_KEY = 'users:index';

type EditableUserFields = Pick<User, 'fullName' | 'email' | 'role' | 'area'>;

/** Valida los datos que se pueden editar; los mismos límites al crear y al editar. */
function validarCampos(input: Partial<EditableUserFields>, requireFullName = false): Partial<EditableUserFields> {
  const out: Partial<EditableUserFields> = {};
  if (requireFullName || input.fullName !== undefined) {
    if (typeof input.fullName !== 'string' || !input.fullName.trim() || input.fullName.trim().length > 200) {
      throw new UserServiceError('invalid_data', 'El nombre visible es obligatorio y no puede superar 200 caracteres');
    }
    out.fullName = input.fullName.trim();
  }
  if (input.email !== undefined) {
    if (typeof input.email !== 'string' || input.email.length > 254) {
      throw new UserServiceError('invalid_data', 'El correo no puede superar 254 caracteres');
    }
    out.email = input.email.trim() || undefined;
  }
  if (input.role !== undefined) {
    if (input.role !== 'admin' && input.role !== 'asesor') throw new UserServiceError('invalid_data', 'El rol no es válido');
    out.role = input.role;
  }
  if (input.area !== undefined) {
    if (input.area !== 'ti' && input.area !== 'admisiones' && input.area !== 'all') {
      throw new UserServiceError('invalid_data', 'El área no es válida');
    }
    out.area = input.area;
  }
  return out;
}

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
}, opts: { omitirPoliticaUsuario?: boolean } = {}): Promise<PublicUser> {
  if (typeof input.username !== 'string') throw new UserServiceError('invalid_username', 'El usuario es obligatorio');
  const username = normalizarUsuario(input.username);
  // Sin tildes ni espacios, como en las redes sociales: un usuario como
  // "ángel acero" se escribe distinto en cada teclado y nadie lo recuerda.
  const usernameError = opts.omitirPoliticaUsuario ? (username ? null : 'El usuario es obligatorio') : validarUsuario(username);
  if (usernameError) throw new UserServiceError('invalid_username', usernameError);
  const fields = validarCampos(input, true);
  if (!isAcceptableNewPassword(input.password)) {
    throw new UserServiceError('invalid_data', `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres y máximo ${MAX_PASSWORD_BYTES} bytes`);
  }

  const existing = await getUser(username);
  if (existing) throw new UserServiceError('username_taken', 'El nombre de usuario ya está en uso');

  const user: User = {
    username,
    passwordHash: await bcrypt.hash(input.password, 10),
    fullName: fields.fullName!,
    email: fields.email,
    role: fields.role ?? 'asesor',
    area: fields.area ?? 'all',
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

/**
 * Edita nombre visible, correo, rol y área. No toca la contraseña ni las
 * sesiones, ni la cuenta de Chatwoot (que ya no se edita: está vinculada por
 * chatwootUserId, no por estos datos).
 */
export async function updateUser(username: string, cambios: Partial<EditableUserFields>): Promise<PublicUser> {
  const user = await getUser(username);
  if (!user) throw new UserServiceError('not_found', 'El usuario no existe');
  const fields = validarCampos(cambios);
  if (user.role === 'admin' && fields.role === 'asesor') {
    const admins = (await listUsers()).filter((item) => item.role === 'admin').length;
    if (admins <= 1) throw new UserServiceError('last_admin', 'Debe quedar al menos un administrador');
  }
  Object.assign(user, fields);
  // Correo vacío = quitarlo, no guardarlo como cadena vacía.
  if (fields.email === undefined && Object.prototype.hasOwnProperty.call(cambios, 'email')) delete user.email;
  await redis.set(KEY(user.username), JSON.stringify(user));
  return toPublic(user);
}

/**
 * Cambia el usuario con el que se entra. El usuario es la clave de la cuenta y
 * queda guardado en la auditoría, el CRM, las respuestas rápidas, las macros,
 * los recordatorios y los envíos masivos: todo eso se migra al nuevo.
 *
 * Orden seguro: primero la cuenta nueva (SET NX: si el usuario ya existe no se
 * pisa nada), luego las referencias y al final se borra la cuenta vieja. Si una
 * migración falla se registra y se siguen las demás: la cuenta ya quedó
 * renombrada, y eso es preferible a dejar a la persona sin poder entrar. El
 * sessionVersion nuevo cierra las sesiones abiertas con el usuario viejo.
 */
export async function renameUser(viejo: string, nuevo: string): Promise<PublicUser> {
  const user = await getUser(viejo);
  if (!user) throw new UserServiceError('not_found', 'El usuario no existe');
  const username = normalizarUsuario(nuevo);
  const usernameError = validarUsuario(username);
  if (usernameError) throw new UserServiceError('invalid_username', usernameError);
  if (user.username === username) return toPublic(user);

  const renamed: User = { ...user, username, sessionVersion: randomUUID() };
  if (!await redis.set(KEY(username), JSON.stringify(renamed), 'NX')) {
    throw new UserServiceError('username_taken', 'El nombre de usuario ya está en uso');
  }
  await redis.sadd(INDEX_KEY, username);
  const migraciones: Array<[string, () => Promise<void>]> = [
    ['auditoría', () => renombrarUsuarioEnAuditoria(user.username, username)],
    ['CRM', () => renombrarUsuarioEnCrm(user.username, username)],
    ['respuestas rápidas', () => renombrarUsuarioEnRespuestasRapidas(user.username, username)],
    ['macros', () => renombrarUsuarioEnMacros(user.username, username)],
    ['recordatorios', () => renombrarUsuarioEnRecordatorios(user.username, username)],
    ['envíos masivos', () => renombrarUsuarioEnBroadcasts(user.username, username)],
  ];
  for (const [nombre, migrar] of migraciones) {
    try {
      await migrar();
    } catch {
      console.error(`[users] falló la migración de referencias en ${nombre}`);
    }
  }
  await redis.del(KEY(user.username));
  await redis.srem(INDEX_KEY, user.username);
  return toPublic(renamed);
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

  // Única excepción a la política de usuarios: un ADMIN_USER heredado debe
  // poder arrancar el sistema; después se renombra desde el panel.
  await createUser({
    username: config.auth.adminUser,
    password: config.auth.adminPassword,
    fullName: 'Administrador',
    role: 'admin',
    area: 'all',
  }, { omitirPoliticaUsuario: true });
  // La contraseña NO se imprime: el log se rota, se copia y a veces se envía a
  // un servicio externo.
  console.log(`[users] usuario admin creado: ${config.auth.adminUser}`);
  if (usandoDefaults) {
    console.warn('[users] ⚠️  contraseña por defecto en uso (solo desarrollo). Define ADMIN_PASSWORD antes de publicar.');
  }
}
