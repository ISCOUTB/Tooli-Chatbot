#!/usr/bin/env python3
"""Read-only deployment checks. Never print environment values or credentials."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def read_env(path):
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def check_secrets(env):
    errors = []
    if env.get('MESSAGING_ADAPTER', 'evolution') == 'meta' and not env.get('META_APP_SECRET'):
        errors.append('Falta META_APP_SECRET: la nueva versión rechazaría mensajes de Meta.')
    if env.get('CHATWOOT_API_TOKEN') and len(env.get('CHATWOOT_WEBHOOK_TOKEN', '')) < 32:
        errors.append('CHATWOOT_WEBHOOK_TOKEN debe tener al menos 32 caracteres y estar configurado en Chatwoot.')
    if len(env.get('JWT_SECRET', '')) < 32:
        errors.append('JWT_SECRET debe tener al menos 32 caracteres.')
    return errors


def docker_json(*args):
    result = subprocess.run(['docker', *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('No se pudo inspeccionar Docker/Compose; revisa su configuración sin divulgar secretos.')
    return json.loads(result.stdout)


def main():
    root = Path(__file__).resolve().parent.parent
    os.chdir(root)
    env_path = root / '.env'
    if not env_path.exists():
        print('Despliegue detenido: falta .env.', file=sys.stderr)
        return 1
    errors = check_secrets(read_env(env_path))
    free_gib = shutil.disk_usage(root).free / 1024**3
    if free_gib < 6:
        errors.append(f'Solo hay {free_gib:.1f} GiB libres; reserva al menos 6 GiB para construir conservando la imagen anterior.')
    try:
        compose = docker_json('compose', 'config', '--format', 'json')
        for service, target in [('redis', '/data'), ('chatwoot-redis', '/data'), ('chatwoot-app', '/app/storage')]:
            result = subprocess.run(['docker', 'compose', 'ps', '-a', '-q', service], capture_output=True, text=True, check=True)
            if not result.stdout.strip():
                continue
            container = docker_json('inspect', result.stdout.strip())[0]
            volumes = compose['services'][service].get('volumes', [])
            source = next(v['source'] for v in volumes if v['target'] == target)
            expected = compose['volumes'][source]['name']
            actual = next((m.get('Name') for m in container['Mounts'] if m['Destination'] == target), None)
            if actual != expected:
                errors.append(f'{service}: migra y verifica el volumen {target} antes de actualizar; el contenedor actual usa otro almacenamiento.')
            elif service in ('redis', 'chatwoot-redis'):
                persistence = subprocess.check_output(['docker', 'exec', container['Id'], 'redis-cli', 'INFO', 'persistence'], text=True)
                if 'aof_enabled:1' not in persistence or 'aof_last_write_status:ok' not in persistence:
                    errors.append(f'{service}: AOF aún no está activo y saludable.')
    except (RuntimeError, subprocess.SubprocessError, KeyError, StopIteration, ValueError) as exc:
        errors.append(str(exc) if isinstance(exc, RuntimeError) else 'No se pudo validar la migración de almacenamiento.')
    if errors:
        for error in errors:
            print(f'BLOQUEO: {error}', file=sys.stderr)
        print('No se ha reconstruido ni reiniciado ningún servicio.', file=sys.stderr)
        return 1
    print(f'Preflight OK: secretos presentes, almacenamiento migrado y {free_gib:.1f} GiB libres.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
