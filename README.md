# FinNest

Aplicación self-hosted de finanzas personales y de pareja. Firefly III conserva el libro contable; el Pocket Engine añade propósitos, metas, privacidad y proyecciones sin inventar movimientos bancarios.

## Estado de esta entrega

El repositorio contiene una **beta experimental funcional y desplegable** de FinNest. `PUBLIC_DATA_MODE=local` permite una demostración sin infraestructura y `server` usa identidades, PostgreSQL y Firefly reales. La autenticación integrada admite `AUTH_MODE=local` (predeterminado privado) o `keycloak` (opcional/público):

- PWA responsive e instalable en SvelteKit con Hoy, Futuro, Patrimonio, Copiloto y Movimientos; Cuentas, Bolsillos, Hogar y Configuración son secciones secundarias.
- Service worker con caché de interfaz y navegación visitada; API financiera y autenticación siempre quedan fuera de caché.
- API NestJS/Fastify con identidad normalizada, sesiones locales opacas en Redis u OIDC/PKCE opcional.
- PostgreSQL/Prisma con hogares, miembros, bolsillos, eventos, reglas, atribuciones, check-ins e insights.
- Bolsillos compartidos por defecto y privados para su propietario.
- Metas por fecha o por capacidad de aporte.
- Distribución priorizada de ingresos.
- Proyecciones determinísticas de ahorro, CDT, inversión, deuda e inmuebles.
- Plan financiero trazable: salarios, primas, alquileres u otras fuentes, calendario de ingresos y acuerdos versionados hacia bolsillos.
- Adaptador Firefly por libro compartido o privado, administración de cuentas desde FinNest y estados independientes por libro.
- Servicio AI-CFO FastAPI con proveedores OpenAI, Gemini o determinístico de pruebas, salida estructurada y validación de evidencia.
- Perfiles reales, pagadores del hogar, onboarding diagnosticable y temas claro/oscuro/sistema.
- Noticias persistentes de BanRep y Alpha Vantage opcional, normalizadas y deduplicadas.
- Web Push nativo con horarios múltiples configurables por miembro y registro idempotente de entregas; n8n es un disparador opcional.
- Docker Compose por target: privado Tailscale, público opcional y n8n integrado bajo perfil explícito.
- Scripts de preflight, configuración runtime, despliegue, actualización, backup y restauración.

En modo de datos local, bolsillos, movimientos, asignaciones y ajustes se guardan en `localStorage`. En modo servidor, la PWA llama a la API; con autenticación local usa una cookie `HttpOnly` y con Keycloak usa OIDC/PKCE. El navegador nunca recibe tokens de Firefly.

## Probar ahora sin Docker

Requisitos: Node 22+ y pnpm 11+.

```bash
pnpm install
pnpm dev:local
```

Abra `http://127.0.0.1:5173`. No hace falta crear `.env`, instalar PostgreSQL ni configurar Firefly. Use **Más → Exportar y respaldar** antes de borrar los datos del navegador.

Para probar la instalación PWA en el computador use **Más → Instalar app** cuando el navegador lo ofrezca. En iPhone/iPad use **Compartir → Añadir a pantalla de inicio**. El modo instalable requiere HTTPS en el servidor (localhost es la excepción de desarrollo). Después de visitar una pantalla al menos una vez, la interfaz puede volver a abrirla sin conexión; las respuestas de `/api` y `/auth` nunca se cachean.

Para desarrollo integrado aislado puede usar `DEV_AUTH_ENABLED=true` únicamente en localhost; nunca lo active en los targets `private` o `public`:

```bash
cp .env.example .env
pnpm db:generate
pnpm --filter @finanzas/domain build
pnpm dev
```

La API queda en `http://localhost:3000` y acepta los encabezados de desarrollo:

```text
x-household-id: household-demo
x-member-id: member-a
x-member-name: Persona local
```

## Despliegue privado recomendado

El target privado publica una única entrada en `127.0.0.1:${APP_LOCAL_PORT}`. Tailscale Serve termina TLS y conserva PWA/API bajo el mismo origen. En `AUTH_MODE=local`, PostgreSQL, Redis, Firefly, API, web y AI-CFO son internos; Keycloak y n8n no se crean ni inician.

```bash
node scripts/init-env.mjs
# editar .env
node scripts/preflight.mjs
DEPLOY_TARGET=private scripts/deploy.sh
scripts/bootstrap-local-users.sh
```

La instalación inicial sin PAT usa explícitamente `--bootstrap`. Consulte la guía completa antes de ejecutarla:

- [Despliegue privado con Tailscale](docs/DEPLOY_PRIVATE_TAILSCALE.md)
- [Migración general](docs/MIGRATION.md)

### Instalar y actualizar desde Git

En el servidor, clone el repositorio y conserve `.env` únicamente allí:

```bash
git clone https://github.com/Wilmesa/finanzas-hogar.git /ruta/configurable/app
cd /ruta/configurable/app
node scripts/init-env.mjs
# editar .env, generar runtime y ejecutar preflight
DEPLOY_TARGET=private scripts/deploy.sh
```

Las actualizaciones se aplican manualmente con `DEPLOY_TARGET=private scripts/update-server.sh`. El script exige Git limpio, crea un backup consistente, registra el commit anterior, usa avance lineal, valida, migra y espera healthchecks. No hay actualizaciones automáticas.

Un despliegue público tradicional con Keycloak requiere selección explícita:

```bash
DEPLOY_TARGET=public AUTH_MODE=keycloak PUBLIC_AUTH_MODE=keycloak scripts/deploy.sh
```

El n8n incluido vive en `docker-compose.n8n.yml` y no forma parte del modelo normal. Solo se añade con `ENABLE_BUNDLED_N8N=true`, que también hace obligatorios sus dos secretos. El entorno privado habitual mantiene `false`.

```bash
# Normal: sin n8n, sin variables ni descarga de su imagen
ENABLE_BUNDLED_N8N=false scripts/compose.sh config

# Opcional: requiere N8N_AUTOMATION_TOKEN y N8N_ENCRYPTION_KEY en el entorno seguro
ENABLE_BUNDLED_N8N=true scripts/compose.sh up -d n8n
```

El stack fija Firefly `6.6.3`; Keycloak `26.6.3` y n8n `2.29.11` solo se usan de forma explícita. Antes de cualquier actualización se debe crear un backup y repetir las pruebas de aceptación.

## Comandos de calidad

```bash
pnpm check
pnpm test
pnpm build
pnpm format
python3 -m pytest services/ai-cfo/tests -q
```

## Contratos principales

- `POST /v1/pockets`: crea un bolsillo; `visibility` es `household` si se omite.
- `GET /v1/pockets`: devuelve compartidos más privados propios.
- `GET /v1/pockets/:id/projection`: calcula el progreso según su política.
- `POST /v1/pockets/:id/allocate`: registra un evento virtual idempotente.
- `GET/POST/PATCH/DELETE /v1/accounts`: administra cuentas Firefly por alcance sin exponer PAT al cliente.
- `GET/PATCH /v1/household` y `PATCH /v1/profile`: hogar, miembros e identidad visible.
- `GET /v1/onboarding/status`: diagnóstico seguro de la configuración inicial.
- `GET/POST/PATCH /v1/planning/*`: fuentes, ingresos esperados, planes, asignaciones e historia de decisiones.
- `POST /v1/transactions`: registra en el libro Firefly correcto y guarda su atribución.
- `POST /v1/projections/*`: ahorro, CDT, deuda, inversión e inmuebles sin modificar Firefly.
- `GET/POST /v1/insights`: consulta o genera un snapshot permitido, valida y persiste el análisis.
- `GET /v1/ai-cfo/status`: proveedor, modelo y disponibilidad, nunca la API key.
- `GET/PUT /v1/reminders/preferences`: consulta y configura horarios individuales.
- `GET /v1/push/public-key` y `POST/DELETE /v1/push/subscriptions`: registra cada dispositivo PWA.
- `POST /v1/automation/reminders/process`: disparador opcional autenticado para n8n.
- `POST /v1/auth/login`, `GET /v1/auth/me`, `POST /v1/auth/logout` y `POST /v1/auth/change-password`: sesión local segura.

Los comandos monetarios exigen `Idempotency-Key`.

## Configurar AI-CFO

La IA está desactivada por defecto. Seleccione un único proveedor en el `.env` del servidor:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-terra
```

o:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
```

Para NVIDIA NIM, Groq, OpenRouter, Together, LiteLLM u otro endpoint compatible con Chat Completions:

```dotenv
AI_PROVIDER=openai_compatible
AI_COMPATIBLE_PROVIDER_NAME=Mi proveedor
AI_COMPATIBLE_BASE_URL=https://api.proveedor.example/v1
AI_COMPATIBLE_API_KEY=...
AI_COMPATIBLE_MODEL=modelo-elegido
AI_COMPATIBLE_STRUCTURED_MODE=json_schema
```

Cambie el modo a `json_object` o `prompt` si el proveedor no implementa JSON Schema estricto; Pydantic y el verificador de evidencia siguen siendo obligatorios. Para una API propietaria use un gateway compatible como LiteLLM o añada un adaptador que implemente `InsightProvider`. HTTP se bloquea por defecto y solo puede habilitarse deliberadamente para un gateway local controlado.

Use `deterministic` únicamente para pruebas. La PWA recibe proveedor, modelo y estado, pero nunca la clave. Todos los proveedores pasan por Pydantic y el verificador de evidencia.

## Límites conocidos de la beta

- El stack Docker no pudo ejecutarse en esta estación porque Docker no está instalado; debe pasar preflight y pruebas E2E en el servidor antes de usar datos reales.
- La estructura privada/pública se valida en CI mediante `docker compose config` y build de las imágenes propias, pero los contenedores integrados deben superar healthchecks en Ubuntu antes de datos reales.
- La inspección visual automatizada y el comportamiento offline se registran en `BITACORA.md`; el stack completo aún debe probarse en una máquina con Docker.
- Web Push requiere instalar la PWA, conceder permiso en cada dispositivo y completar una prueba real de entrega en el servidor. En iOS se necesita una PWA añadida a la pantalla de inicio.
- La ingesta BanRep/Alpha Vantage está implementada, pero debe verificarse con red real y ajustar el parser si BanRep modifica su feed.
- La operación privada financiada desde el libro común deja atribuciones `pending/failed/synchronized` y un asiento redactado; aún se recomienda un worker outbox dedicado antes de escala comercial.
- Falta imponer RLS con un rol PostgreSQL de runtime separado y ampliar la prueba E2E de cuentas contra un Firefly efímero con PAT automatizado.
- Redis/BullMQ, OpenTelemetry y los dashboards de observabilidad están previstos, pero no se activan todavía en código.

Consulte [la bitácora](BITACORA.md), [el módulo de planificación](docs/PLANNING.md), [la migración](docs/MIGRATION.md), [la arquitectura](docs/ARCHITECTURE.md) y [la seguridad](docs/SECURITY.md) antes de cargar información financiera real.
