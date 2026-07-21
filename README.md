# Nuestro Dinero

Aplicación self-hosted de finanzas personales y de pareja. Firefly III conserva el libro contable; el Pocket Engine añade propósitos, metas, privacidad y proyecciones sin inventar movimientos bancarios.

## Estado de esta entrega

El repositorio contiene una **beta funcional y desplegable** de la Fase 1. Tiene dos modos: `local`, para probar la experiencia completa sin infraestructura, y `server`, para utilizar Keycloak, PostgreSQL y Firefly:

- PWA responsive e instalable en SvelteKit con las vistas Hoy, Bolsillos, Movimientos, Futuro y Más.
- Service worker con caché de interfaz y navegación visitada; API financiera y autenticación siempre quedan fuera de caché.
- API NestJS/Fastify con autenticación OIDC o identidad de desarrollo.
- PostgreSQL/Prisma con hogares, miembros, bolsillos, eventos, reglas, atribuciones, check-ins e insights.
- Bolsillos compartidos por defecto y privados para su propietario.
- Metas por fecha o por capacidad de aporte.
- Distribución priorizada de ingresos.
- Proyecciones determinísticas de ahorro, CDT, inversión, deuda e inmuebles.
- Plan financiero trazable: salarios, primas, alquileres u otras fuentes, calendario de ingresos y acuerdos versionados hacia bolsillos.
- Adaptador Firefly por libro compartido o privado.
- Servicio AI-CFO FastAPI con proveedor OpenAI opcional, JSON Schema y validación de evidencia.
- Noticias persistentes de BanRep y Alpha Vantage opcional, normalizadas y deduplicadas.
- Web Push nativo con horarios múltiples configurables por miembro y registro idempotente de entregas; n8n es un disparador opcional.
- Docker Compose por target: privado Tailscale, público opcional y n8n integrado bajo perfil explícito.
- Scripts de preflight, configuración runtime, despliegue, actualización, backup y restauración.

En modo local, bolsillos, movimientos, asignaciones y ajustes se guardan en `localStorage` y pueden exportarse/importarse como JSON. En modo servidor, la PWA usa OIDC con PKCE y llama a la API; el navegador nunca recibe tokens de Firefly.

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
x-member-name: Ana
```

## Despliegue privado recomendado

El target privado publica una única entrada en `127.0.0.1:${APP_LOCAL_PORT}`. Tailscale Serve termina TLS y conserva PWA, API y Keycloak bajo el mismo origen. PostgreSQL, Redis, web, API, AI-CFO y Keycloak no publican puertos; n8n no se inicia.

```bash
node scripts/init-env.mjs
# editar .env
node scripts/configure-domain.mjs
node scripts/preflight.mjs
DEPLOY_TARGET=private scripts/deploy.sh
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

Un despliegue público tradicional requiere selección explícita:

```bash
DEPLOY_TARGET=public scripts/deploy.sh
```

El n8n incluido solo existe para instalaciones independientes y requiere el perfil `bundled-n8n`; el entorno privado previsto usa el n8n externo del servidor.

El stack fija Firefly `6.6.3`, Keycloak `26.6.3` y n8n `2.29.11`. Antes de cualquier actualización se debe crear un backup y repetir las pruebas de aceptación.

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
- `GET /v1/accounts`: devuelve las cuentas Firefly compartidas y las privadas propias con su alcance.
- `GET/POST/PATCH /v1/planning/*`: fuentes, ingresos esperados, planes, asignaciones e historia de decisiones.
- `POST /v1/transactions`: registra en el libro Firefly correcto y guarda su atribución.
- `POST /v1/projections/*`: ahorro, CDT, deuda, inversión e inmuebles sin modificar Firefly.
- `POST /v1/insights/generate`: construye un snapshot permitido y lo envía al AI-CFO.
- `GET/PUT /v1/reminders/preferences`: consulta y configura horarios individuales.
- `GET /v1/push/public-key` y `POST/DELETE /v1/push/subscriptions`: registra cada dispositivo PWA.
- `POST /v1/automation/reminders/process`: disparador opcional autenticado para n8n.

Los comandos monetarios exigen `Idempotency-Key`.

## Límites conocidos de la beta

- El stack Docker no pudo ejecutarse en esta estación porque Docker no está instalado; debe pasar preflight y pruebas E2E en el servidor antes de usar datos reales.
- La estructura privada/pública se valida en CI mediante `docker compose config` y build de las imágenes propias, pero los contenedores integrados deben superar healthchecks en Ubuntu antes de datos reales.
- La inspección visual automatizada y el comportamiento offline se registran en `BITACORA.md`; el stack completo aún debe probarse en una máquina con Docker.
- Web Push requiere instalar la PWA, conceder permiso en cada dispositivo y completar una prueba real de entrega en el servidor. En iOS se necesita una PWA añadida a la pantalla de inicio.
- La ingesta BanRep/Alpha Vantage está implementada, pero debe verificarse con red real y ajustar el parser si BanRep modifica su feed.
- La operación privada financiada desde el libro común requiere un outbox/saga para compensar una caída entre ambas escrituras Firefly.
- Falta imponer RLS con un rol PostgreSQL de runtime separado y añadir pruebas E2E con Keycloak/Firefly reales.
- Redis/BullMQ, OpenTelemetry y los dashboards de observabilidad están previstos, pero no se activan todavía en código.

Consulte [la bitácora](BITACORA.md), [el módulo de planificación](docs/PLANNING.md), [la migración](docs/MIGRATION.md), [la arquitectura](docs/ARCHITECTURE.md) y [la seguridad](docs/SECURITY.md) antes de cargar información financiera real.
