# Despliegue privado con Tailscale Serve

Esta guía instala un entorno experimental aislado en Ubuntu Server 24.04. Tailscale termina TLS y reenvía al único puerto publicado por Compose: el gateway HTTP enlazado a `127.0.0.1`. Con `AUTH_MODE=local`, Keycloak y n8n no arrancan y ningún servicio interno se publica en el host.

## 1. Requisitos

- Ubuntu Server 24.04 actualizado.
- Usuario operativo sin uso cotidiano de `root`, con acceso al grupo Docker.
- Docker Engine y plugin Compose actuales.
- Git, Node.js 22+ y Tailscale activo.
- Acceso SSH mediante llave y UFW activo.
- Al menos 4 CPU, 8 GB RAM y 40 GB libres para la prueba integrada.
- Un backup externo antes de cualquier actualización con datos.

Compruebe:

```bash
docker --version
docker compose version
tailscale status
node --version
```

## 2. Clonar el repositorio

```bash
sudo mkdir -p /srv/stacks/presupuesto-dev
sudo chown hunter:hunter /srv/stacks/presupuesto-dev
git clone https://github.com/Wilmesa/finanzas-hogar.git /srv/stacks/presupuesto-dev/app
cd /srv/stacks/presupuesto-dev/app
```

Si el repositorio se vuelve privado, configure una deploy key de solo lectura en el servidor y cambie el remoto a SSH. No copie la clave privada del computador personal.

## 3. Crear `.env`

```bash
node scripts/init-env.mjs
chmod 600 .env
nano .env
```

El generador es idempotente: añade variables ausentes y sustituye únicamente secretos vacíos o marcadores inseguros. No imprime secretos ni reemplaza valores válidos existentes.

## 4. Variables requeridas

Para este entorno de prueba configure, como mínimo:

```dotenv
DEPLOY_TARGET=private
COMPOSE_PROJECT_NAME=finanzas-hogar-dev
AUTH_MODE=local
PUBLIC_AUTH_MODE=local
APP_ORIGIN=https://nombre-del-servidor.tailnet-ejemplo.ts.net:8446
APP_LOCAL_PORT=3100
DEV_AUTH_ENABLED=false
```

Complete nombres del hogar y miembros. Los tres PAT de Firefly se añaden después del bootstrap. No reutilice credenciales de Supabase, n8n externo o cualquier otro stack.

Para una futura producción use otro nombre, por ejemplo `finanzas-hogar-prod`, otro `.env`, otra ruta y otro origen. El prefijo Compose mantiene separados volúmenes, redes y contenedores.

## 5. APP_ORIGIN

`APP_ORIGIN` es la fuente canónica del origen externo. Debe ser una URL HTTPS completa, puede incluir puerto y no puede incluir ruta, query, fragmento ni credenciales.

Válido:

```text
https://nombre-del-servidor.tailnet-ejemplo.ts.net:8446
```

Inválidos:

```text
http://nombre-del-servidor
https://nombre-del-servidor/auth
```

La API usa el origen para CORS y cookies detrás del proxy confiable. Keycloak usa ese origen solo si se habilita. Las conexiones internas siguen usando DNS Docker.

## 6. Generar configuración y preflight

Primer bootstrap, todavía sin PAT de Firefly:

```bash
node scripts/preflight.mjs --bootstrap
git status --porcelain
```

El último comando debe quedar vacío. En modo local `configure-domain` no genera realm ni es necesario ejecutarlo.

Una vez configurados los PAT, el control obligatorio es:

```bash
node scripts/preflight.mjs
```

## 7. Despliegue privado inicial

```bash
DEPLOY_TARGET=private scripts/deploy.sh --bootstrap
```

El script valida configuración, construye imágenes propias, inicia dependencias con healthchecks, ejecuta migraciones Prisma e inicia API, PWA y gateway. No descarga ni inicia Keycloak o n8n.

Compruebe que solamente el gateway está publicado:

```bash
scripts/compose.sh ps
sudo ss -lntp | grep 3100
curl -fsS http://127.0.0.1:3100/healthz
```

La dirección esperada es `127.0.0.1:3100`, nunca `0.0.0.0:3100`.

### Administración temporal de Firefly

FinNest administra cuentas desde su propia interfaz. Solo para crear PAT o diagnosticar Firefly, habilite temporalmente su consola en loopback:

```bash
scripts/firefly-admin.sh start
scripts/firefly-admin.sh status
# al terminar
scripts/firefly-admin.sh stop
```

El override publica únicamente `127.0.0.1:${FIREFLY_LOCAL_PORT}`. `stop` recrea el servicio sin el puerto y no borra el volumen. Acceda mediante túnel SSH si trabaja desde otro equipo; nunca cambie el binding a `0.0.0.0`.

### Activar AI-CFO

Mantenga `AI_PROVIDER=disabled` hasta elegir un proveedor. Para OpenAI configure `OPENAI_API_KEY` y `OPENAI_MODEL`; para Gemini, `GEMINI_API_KEY` y `GEMINI_MODEL`; para NVIDIA, Groq, OpenRouter u otro compatible use `AI_PROVIDER=openai_compatible` y las variables `AI_COMPATIBLE_*` documentadas en `.env.example`. Después ejecute `node scripts/preflight.mjs`, recree `ai-cfo` y use **Copiloto → Probar conexión**. La interfaz nunca muestra la clave.

## 8. Publicar mediante Tailscale Serve

```bash
sudo tailscale serve --bg --https=8446 http://127.0.0.1:3100
sudo tailscale serve status
```

Tailscale termina HTTPS y Caddy conserva el mismo origen para `/` y `/api/*`. En modo local no existe `/auth`. No configure Funnel y no abra 80/443 en UFW.

## 9. Crear o restablecer los dos usuarios locales

Revise `MEMBER_A/B_ID`, nombre, correo y `MEMBER_A/B_USERNAME` en `.env`. Después ejecute por SSH:

```bash
scripts/bootstrap-local-users.sh
```

El script solicita ambas contraseñas sin mostrarlas, exige 12–128 caracteres y es idempotente. Si el usuario ya existe, reemplaza su hash e invalida todas sus sesiones. Para automatización puntual admite `MEMBER_A_BOOTSTRAP_PASSWORD` y `MEMBER_B_BOOTSTRAP_PASSWORD` como variables temporales del proceso; elimínelas del shell inmediatamente y nunca las escriba en `.env` o Git. No active `DEV_AUTH_ENABLED`.

Para restablecer únicamente una contraseña desde SSH, sin tocar la otra:

```bash
LOCAL_USER_LABEL=A scripts/bootstrap-local-users.sh
# o LOCAL_USER_LABEL=B
```

## 10. Configuración inicial de Firefly

Habilite temporalmente el puerto administrativo solo en loopback:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.private.yml \
  -f docker-compose.firefly-admin.yml \
  up -d firefly
```

Desde el computador administrador cree un túnel:

```bash
ssh -L 8081:127.0.0.1:8081 hunter@servidor-hogar
```

Abra `http://127.0.0.1:8081`, cree el contexto compartido y los contextos privados, y genere los tres PAT. Guárdelos únicamente en `.env`:

```dotenv
FIREFLY_HOUSEHOLD_TOKEN=...
FIREFLY_PRIVATE_TOKEN_MEMBER_A=...
FIREFLY_PRIVATE_TOKEN_MEMBER_B=...
```

Después ejecute el despliegue normal y retire el puerto temporal recreando Firefly con los archivos habituales:

```bash
DEPLOY_TARGET=private scripts/deploy.sh
scripts/compose.sh up -d --force-recreate firefly
sudo ss -lntp | grep 8081 && echo "REVISAR: el puerto temporal sigue activo" || true
```

## 11. Pruebas de aceptación con datos ficticios

Use cantidades pequeñas y ficticias:

1. Iniciar y cerrar sesión desde ambos usuarios y cambiar una contraseña de prueba.
2. Crear un bolsillo compartido y comprobar visibilidad mutua.
3. Crear uno privado y confirmar `404` desde el otro miembro.
4. Registrar un gasto ficticio y comprobar doble entrada en Firefly.
5. Repetir la misma idempotency key y confirmar que no se duplica.
6. Crear una meta por fecha y otra por aporte máximo.
7. Crear una fuente de ingreso, expectativa y plan con revisión.
8. Exportar e importar un respaldo JSON local ficticio.
9. Instalar la PWA y reabrir una vista visitada sin conexión.
10. Confirmar que `/api/*` no aparece en Cache Storage y que la cookie no es visible desde JavaScript.

No cargue movimientos reales hasta completar privacidad, backup y restauración.

## 12. n8n externo

El servidor usa su n8n existente. Mantenga `ENABLE_BUNDLED_N8N=false`. Más adelante:

1. Web Push ya se procesa cada 30 segundos dentro de la API; n8n no es obligatorio.
2. Si desea un disparador redundante, importe `infra/n8n/daily-reminder.workflow.json` en el n8n existente y configure la URL de API mediante el origen Tailscale y `/api`.
3. Guarde `N8N_AUTOMATION_TOKEN` como credencial de n8n, no dentro del workflow.
4. Verifique que el contenedor n8n pueda resolver y alcanzar el nombre Tailscale sin abrir nuevos puertos.
5. Ejecute manualmente con usuarios ficticios antes de activarlo. La clave única de entrega evita duplicados si coinciden el temporizador interno y n8n.

Cada miembro instala la PWA, abre **Más → Recordatorios**, agrega los horarios que necesite y acepta el permiso del sistema. Las preferencias se guardan en su zona horaria y cada navegador genera una suscripción independiente. En iPhone/iPad, Web Push requiere añadir primero la PWA a la pantalla de inicio; la solicitud de permiso debe hacerse desde el botón de la aplicación.

La variante incluida permanece disponible solo para instalaciones independientes. Defina secretos fuertes fuera de Git y actívela explícitamente:

```bash
ENABLE_BUNDLED_N8N=true scripts/compose.sh up -d n8n
```

Ese indicador añade `docker-compose.n8n.yml`; sin él, Docker Compose no lee las variables, servicio o volumen de n8n.

## 13. Logs y diagnóstico

```bash
scripts/compose.sh ps
scripts/compose.sh logs --tail=100 gateway api web firefly ai-cfo
scripts/compose.sh logs -f api
docker inspect --format '{{json .State.Health}}' finanzas-hogar-dev-api-1
```

No copie logs con tokens o datos financieros a servicios públicos.

## 14. Healthchecks

```bash
curl -fsS http://127.0.0.1:3100/healthz
curl -fsS http://127.0.0.1:3100/api/health
scripts/compose.sh ps
```

Todos los servicios iniciados deben aparecer como `healthy` antes de aceptar escrituras.

## 15. Backup

```bash
scripts/backup.sh
cat runtime/deploy/last-backup
```

El backup incluye todas las bases PostgreSQL, uploads de Firefly, Redis, volúmenes opcionales presentes, realm runtime, commit, versiones de imágenes y una copia `env.secrets`. El directorio contiene secretos: manténgalo con permisos restrictivos, cifre la copia externa y pruebe la restauración en un entorno aislado.

## 16. Actualización controlada

```bash
cd /srv/stacks/presupuesto-dev/app
git status --porcelain
DEPLOY_TARGET=private scripts/update-server.sh
```

El script cancela con árbol sucio, crea backup, registra el commit anterior, usa `git pull --ff-only`, valida, construye, migra, espera healthchecks y guarda metadatos en `runtime/deploy/last-update.env`. No existen actualizaciones automáticas.

## 17. Rollback manual

No se ejecuta automáticamente. Lea primero:

```bash
cat runtime/deploy/last-update.env
```

Después, en ventana de mantenimiento:

```bash
scripts/compose.sh stop gateway api web firefly ai-cfo
git switch --detach <PREVIOUS_COMMIT>
DEPLOY_TARGET=private scripts/deploy.sh
RESTORE_CONFIRM=SI_RESTAURAR scripts/restore.sh <BACKUP_PATH>
```

La restauración exige coincidencia de commit y proyecto. Los overrides `RESTORE_ALLOW_VERSION_MISMATCH=YES` o `RESTORE_ALLOW_PROJECT_MISMATCH=YES` solo se usan después de una revisión explícita. Finalice repitiendo toda la aceptación.

## 18. Promoción futura a producción

Use una ruta, `COMPOSE_PROJECT_NAME`, `.env`, origen y backups independientes. Pruebe la versión exacta en dev, cree un backup verificado, despliegue el mismo commit en producción y cambie Tailscale Serve o el proxy público únicamente durante la ventana aprobada. Nunca comparta volúmenes entre dev y producción.

## 19. Despliegue público opcional

Solo para otro servidor preparado para Internet:

```bash
DEPLOY_TARGET=public AUTH_MODE=keycloak PUBLIC_AUTH_MODE=keycloak scripts/deploy.sh
```

Ese target usa `docker-compose.public.yml` y publica 80/443 mediante Caddy. No lo ejecute en este servidor privado.

## 20. Migrar el primer despliegue fallido de Keycloak a autenticación local

No se necesita borrar PostgreSQL ni Firefly. Desde la ruta del clon:

```bash
# 1. Detener sin borrar volúmenes
scripts/compose.sh down

# 2. Actualizar por avance lineal
git switch main
git pull --ff-only

# 3. Editar .env
# AUTH_MODE=local
# PUBLIC_AUTH_MODE=local
# DEV_AUTH_ENABLED=false

# 4. Reconstruir, migrar e iniciar el núcleo local
DEPLOY_TARGET=private AUTH_MODE=local scripts/deploy.sh --bootstrap

# 5. Crear o restablecer las dos credenciales
scripts/bootstrap-local-users.sh

# 6. Confirmar topología y login desde la URL Tailscale
scripts/compose.sh ps
```

`ps` debe mostrar `postgres`, `redis`, `firefly`, `ai-cfo`, `api`, `web` y `gateway`, pero no Keycloak/n8n. Después de validar login, el contenedor antiguo puede eliminarse específicamente con `docker rm <nombre-exacto-keycloak>` si aún existe detenido. Este proyecto no usa un volumen Keycloak dedicado: su base opcional está dentro del volumen PostgreSQL compartido, por lo que **no se debe borrar ese volumen**. Si más adelante se desea retirar únicamente la base `keycloak`, hágalo mediante SQL tras backup, inspección y confirmación expresa; no es necesario para recuperar espacio operativo. Nunca use `docker compose down -v` en esta migración.

## 21. Volver opcionalmente a Keycloak

Defina `AUTH_MODE=keycloak` y `PUBLIC_AUTH_MODE=keycloak`, complete sus secretos, ejecute `node scripts/configure-domain.mjs` y después `scripts/deploy.sh`. El archivo `docker-compose.keycloak.yml` añade servicio, ruta `/auth` y dependencias; la autorización financiera sigue usando el mismo `Actor` normalizado.

## 22. Eliminación segura del entorno de pruebas

1. Cree y retire un último backup cifrado.
2. Desactive solo el endpoint configurado:

```bash
sudo tailscale serve --https=8446 off
```

3. Detenga el stack sin eliminar datos:

```bash
cd /srv/stacks/presupuesto-dev/app
scripts/compose.sh down
```

4. Revise los volúmenes con `docker volume ls | grep finanzas-hogar-dev`.
5. Elimine volúmenes o la ruta únicamente con autorización explícita y después de verificar el backup. `docker compose down -v` es destructivo y no forma parte del procedimiento normal.
