# Migración de volúmenes de producción

Guion para sacar `redis`, `chatwoot-redis` y `chatwoot-app` de su almacenamiento
actual y ponerlos sobre los volúmenes con nombre que declara `docker-compose.yml`.
Es el último bloqueo que impide que el CI despliegue.

> Estado verificado el 26 de octubre de 2026 en `ubuntu@193.122.159.98`.
> Confirmar los datos antes de ejecutar: pueden haber cambiado.

## Por qué está bloqueado

`tools/deploy-preflight.py` compara, para cada servicio, el volumen que declara el
compose contra el que usa el contenedor en marcha. Si no coinciden, corta el
despliegue **antes** de tocar nada. Es deliberado: recrear un servicio sin migrar
sus datos engancharía un volumen nuevo y vacío.

| Servicio | Usa ahora | Debería usar |
|---|---|---|
| `redis` | volumen anónimo `18b54b8e38be…` | `tooli-chatbot_redis-data` |
| `chatwoot-redis` | volumen anónimo `bb33ca2baf6d…` | `tooli-chatbot_chatwoot-redis-data` |
| `chatwoot-app` | **ningún volumen**: escribe en la capa del contenedor | `tooli-chatbot_chatwoot-storage` |

Ninguno de los tres volúmenes con nombre existe todavía.

## Qué está realmente en juego

Menos de lo que parece. **Lo importante ya está a salvo:** las conversaciones,
contactos y mensajes de Chatwoot viven en PostgreSQL, y `chatwoot-postgres` ya
monta `tooli-chatbot_chatwoot-pg-data`, un volumen con nombre. Lo mismo
`evolution-postgres`.

Lo que está sobre almacenamiento frágil es poco y en su mayoría regenerable:

| Qué | Tamaño | Si se pierde |
|---|---|---|
| `redis` — sesiones del bot | 4 KB, 7 claves | Siete personas a mitad de conversación vuelven al menú. Las sesiones ya expiran solas por TTL. |
| `chatwoot-redis` — colas Sidekiq y caché | 4 KB, 1691 claves | Trabajos en cola pendientes. Chatwoot los reconstruye. |
| `chatwoot-app` — `/app/storage` | 32 KB | Adjuntos subidos en el panel. **Esto sí es irrecuperable**, y hoy vive en la capa del contenedor: cualquier recreación lo borra, con migración o sin ella. |

**El caso de `chatwoot-app` es el urgente**, y no por el despliegue: mientras siga
sin volumen, un `docker compose up --force-recreate` cualquiera se lleva esos
adjuntos para siempre.

Un detalle más: el `redis` en marcha tiene **`aof_enabled:0`**, aunque el compose
pide `--appendonly yes`. O sea que el contenedor actual arrancó con otra orden y
no está persistiendo como debería. El preflight también exige AOF activo, así que
ese segundo chequeo solo pasará una vez recreado el contenedor.

## Antes de empezar

- Hacerlo en hora de poco tráfico: recrear `redis` corta las conversaciones vivas
  y recrear `chatwoot-app` deja el panel de asesores unos segundos fuera.
- `redis` tiene AOF apagado, así que **lo que hay en disco puede estar viejo**.
  Forzar un volcado antes de copiar nada.

```bash
cd ~/tooli-chatbot
mkdir -p ~/respaldo-volumenes-$(date +%Y%m%d)
cd ~/respaldo-volumenes-$(date +%Y%m%d)

# Volcado fresco de los dos Redis
docker compose -f ~/tooli-chatbot/docker-compose.yml exec -T redis redis-cli SAVE
docker compose -f ~/tooli-chatbot/docker-compose.yml exec -T chatwoot-redis redis-cli SAVE

# Copias fuera de Docker
docker cp $(docker compose -f ~/tooli-chatbot/docker-compose.yml ps -q redis):/data/. ./redis-bot/
docker cp $(docker compose -f ~/tooli-chatbot/docker-compose.yml ps -q chatwoot-redis):/data/. ./redis-chatwoot/
docker cp $(docker compose -f ~/tooli-chatbot/docker-compose.yml ps -q chatwoot-app):/app/storage/. ./chatwoot-storage/

ls -laR .   # comprobar que no están vacías antes de seguir
```

## Migración

```bash
cd ~/tooli-chatbot
R=~/respaldo-volumenes-$(date +%Y%m%d)

# 1. Crear los volúmenes con nombre
docker volume create tooli-chatbot_redis-data
docker volume create tooli-chatbot_chatwoot-redis-data
docker volume create tooli-chatbot_chatwoot-storage

# 2. Sembrarlos con los datos respaldados
docker run --rm -v "$R/redis-bot":/from -v tooli-chatbot_redis-data:/to \
  alpine sh -c 'cp -a /from/. /to/'
docker run --rm -v "$R/redis-chatwoot":/from -v tooli-chatbot_chatwoot-redis-data:/to \
  alpine sh -c 'cp -a /from/. /to/'
docker run --rm -v "$R/chatwoot-storage":/from -v tooli-chatbot_chatwoot-storage:/to \
  alpine sh -c 'cp -a /from/. /to/'

# 3. Recrear solo esos tres servicios
docker compose up -d --force-recreate redis chatwoot-redis chatwoot-app
```

## Verificación

```bash
cd ~/tooli-chatbot

# Cada servicio engancha el volumen correcto
for S in redis chatwoot-redis chatwoot-app; do
  printf "%-16s " "$S"
  docker inspect $(docker compose ps -q $S) --format '{{range .Mounts}}{{.Name}} {{end}}'
done

# AOF activo y sano (el otro chequeo del preflight)
docker compose exec -T redis redis-cli INFO persistence | grep -E 'aof_enabled|aof_last_write_status'

# Los datos siguen ahí
docker compose exec -T chatwoot-redis redis-cli DBSIZE   # ~1691
docker compose exec -T chatwoot-app ls /app/storage

# El servicio responde
curl -s localhost:3000/health/deep
```

Y el preflight completo, que es lo que decide:

```bash
python3 tools/deploy-preflight.py && echo "listo para desplegar"
```

Debe imprimir `Preflight OK` y, si `META_APP_SECRET` sigue sin definirse, el aviso
de la firma, que ya no bloquea.

## Si algo sale mal

Los volúmenes anónimos **no se borran** en ningún paso, así que la vuelta atrás es
recrear los servicios apuntando al almacenamiento viejo, o restaurar desde
`~/respaldo-volumenes-<fecha>`. Conviene conservar ambos hasta comprobar que
Chatwoot y el bot funcionan con normalidad durante un día.

Una vez verificado, los anónimos se pueden recuperar con `docker volume rm`.

## Lo que esto no arregla

`META_APP_SECRET` sigue sin estar en el `.env` del VPS. Desde que se integró
`fix/meta-firma-opcional`, eso ya no bloquea el despliegue, pero significa que
`POST /meta-webhook` acepta entregas **sin verificar la firma**: cualquiera que
conozca la URL puede inyectar mensajes falsos. Definir el secreto desde el panel
de la app de Meta cierra ese hueco y no cuesta nada.
