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
        if env.get('META_ALLOW_UNSIGNED') == '1':
            print('AVISO: falta META_APP_SECRET y META_ALLOW_UNSIGNED=1; los mensajes de Meta se aceptan sin verificar la firma.', file=sys.stderr)
        else:
            # En producción el bot rechaza las entregas sin el secreto: desplegar así lo dejaría sordo.
            errors.append('Falta META_APP_SECRET: en producción el webhook de Meta rechaza las entregas sin firma. Configúralo (o META_ALLOW_UNSIGNED=1 de forma temporal).')
    if env.get('CHATWOOT_API_TOKEN') and len(env.get('CHATWOOT_WEBHOOK_TOKEN', '')) < 32:
        errors.append('CHATWOOT_WEBHOOK_TOKEN debe tener al menos 32 caracteres y estar configurado en Chatwoot.')
    if len(env.get('JWT_SECRET', '')) < 32:
        errors.append('JWT_SECRET debe tener al menos 32 caracteres.')
    return errors


def clave_academica_valida(valor):
    # Misma regla que claveValida (src/services/academico/interruptores.ts): 32 bytes en hex (64) o en base64.
    import base64
    import binascii
    import re
    valor = (valor or '').strip()
    if not valor:
        return False
    if re.fullmatch(r'[0-9a-fA-F]{64}', valor):
        return True
    try:
        return len(base64.b64decode(valor + '=' * (-len(valor) % 4))) == 32
    except (binascii.Error, ValueError):
        return False


def check_academico(env):
    """Misma regla que problemasConfigAcademica (src/services/academico/interruptores.ts). Devuelve (bloqueos, avisos)."""
    errors, warnings = [], []
    con_clave = clave_academica_valida(env.get('TOOLI_ACADEMICO_CLAVE'))
    camino_a = env.get('TOOLI_NOTAS_CAMINO', '').strip().upper() == 'A'
    if env.get('TOOLI_ACADEMIC_LOOKUP_ENABLED') == '1' and not con_clave:
        errors.append('TOOLI_ACADEMIC_LOOKUP_ENABLED=1 necesita TOOLI_ACADEMICO_CLAVE (openssl rand -hex 32): sin ella la cédula no se guarda y el recibo no se puede descargar. Pon la clave o apaga el interruptor.')
    if camino_a and not con_clave:
        warnings.append('TOOLI_NOTAS_CAMINO=A sin TOOLI_ACADEMICO_CLAVE válida: las notas usan el camino B.')
    busqueda = env.get('TOOLI_BUSQUEDA_CLAVE', '').strip()
    if busqueda and len(busqueda) < 32:
        warnings.append('TOOLI_BUSQUEDA_CLAVE tiene menos de 32 caracteres y se ignora.')
    elif not busqueda and env.get('TOOLI_ACADEMIC_LOOKUP_ENABLED') == '1':
        warnings.append('Sin TOOLI_BUSQUEDA_CLAVE los índices por código y cédula dependen de TOOLI_ACADEMICO_CLAVE o JWT_SECRET; define TOOLI_BUSQUEDA_CLAVE y corre tools/migrar-indices-busqueda.ts.')
    horario_banner = env.get('TOOLI_HORARIO_PROVEEDOR', '').strip().lower() != 'simulado' or env.get('NODE_ENV') == 'production'
    if env.get('TOOLI_HORARIO_ENABLED') == '1' and horario_banner and (not con_clave or not camino_a):
        warnings.append('TOOLI_HORARIO_ENABLED=1 necesita TOOLI_NOTAS_CAMINO=A y TOOLI_ACADEMICO_CLAVE.')
    return errors, warnings


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
    env = read_env(env_path)
    errors = check_secrets(env)
    bloqueos_academicos, avisos_academicos = check_academico(env)
    errors.extend(bloqueos_academicos)
    for aviso in avisos_academicos:
        print(f'AVISO: {aviso}', file=sys.stderr)
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
