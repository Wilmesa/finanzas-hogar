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
- Workflow n8n de recordatorio diario por Telegram; Web Push queda preparado como siguiente adaptador.
- Docker Compose con Caddy, Firefly, Keycloak, PostgreSQL, Redis y n8n.
- Scripts de preflight, configuración de dominio, despliegue, backup y restauración.

En modo local, bolsillos, movimientos, asignaciones y ajustes se guardan en `localStorage` y pueden exportarse/importarse como JSON. En modo servidor, la PWA usa OIDC con PKCE y llama a la API; el navegador nunca recibe tokens de Firefly.

## Probar ahora sin Docker

Requisitos: Node 22+ y pnpm 11+.

```bash
pnpm install
pnpm dev:local
```

Abra `http://127.0.0.1:5173`. No hace falta crear `.env`, instalar PostgreSQL ni configurar Firefly. Use **Más → Exportar y respaldar** antes de borrar los datos del navegador.

Para probar la instalación PWA en el computador use **Más → Instalar app** cuando el navegador lo ofrezca. En iPhone/iPad use **Compartir → Añadir a pantalla de inicio**. El modo instalable requiere HTTPS en el servidor (localhost es la excepción de desarrollo). Después de visitar una pantalla al menos una vez, la interfaz puede volver a abrirla sin conexión; las respuestas de `/api` y `/auth` nunca se cachean.

Para desarrollo integrado con API, PostgreSQL local y `DEV_AUTH_ENABLED=true`:

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

## Ejecutar el stack self-hosted

1. Generar `.env` con secretos aleatorios.
2. Configurar dominio y redirect URI de Keycloak.
3. Completar los tokens Firefly y ejecutar el preflight.
4. Desplegar:

```bash
node scripts/init-env.mjs
# editar .env
node scripts/configure-domain.mjs
node scripts/preflight.mjs
scripts/deploy.sh
docker compose run --rm api pnpm --filter @finanzas/api prisma:seed
```

5. Crear en Firefly un contexto compartido y uno privado por miembro; guardar sus PAT únicamente en el `.env` del servidor.
6. Importar `infra/n8n/daily-reminder.workflow.json` y activarlo después de comprobar la zona horaria.

No exponga directamente Firefly, PostgreSQL, Redis, n8n ni el servicio AI-CFO a Internet. Solo Caddy debe aceptar tráfico público.

### Instalar y actualizar desde Git

En el servidor, clone el repositorio y conserve `.env` únicamente allí:

```bash
git clone <URL-DEL-REPOSITORIO> /opt/nuestro-dinero
cd /opt/nuestro-dinero
node scripts/init-env.mjs
# editar .env y configurar dominio/tokens
scripts/deploy.sh
```

Las siguientes actualizaciones se aplican con `scripts/update-server.sh`. El script se niega a continuar si encuentra cambios locales, crea un backup, exige avance lineal de Git, repite el preflight y reconstruye los contenedores.

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
- `GET /v1/automation/reminders/eligible`: endpoint exclusivo de n8n.

Los comandos monetarios exigen `Idempotency-Key`.

## Límites conocidos de la beta

- El stack Docker no pudo ejecutarse en esta estación porque Docker no está instalado; debe pasar preflight y pruebas E2E en el servidor antes de usar datos reales.
- La inspección visual automatizada y el comportamiento offline se registran en `BITACORA.md`; el stack completo aún debe probarse en una máquina con Docker.
- Web Push necesita suscripciones VAPID; Telegram ya está integrado cuando se configuran bot y chat IDs.
- La ingesta BanRep/Alpha Vantage está implementada, pero debe verificarse con red real y ajustar el parser si BanRep modifica su feed.
- La operación privada financiada desde el libro común requiere un outbox/saga para compensar una caída entre ambas escrituras Firefly.
- Falta imponer RLS con un rol PostgreSQL de runtime separado y añadir pruebas E2E con Keycloak/Firefly reales.
- Redis/BullMQ, OpenTelemetry y los dashboards de observabilidad están previstos, pero no se activan todavía en código.

Consulte [la bitácora](BITACORA.md), [el módulo de planificación](docs/PLANNING.md), [la migración](docs/MIGRATION.md), [la arquitectura](docs/ARCHITECTURE.md) y [la seguridad](docs/SECURITY.md) antes de cargar información financiera real.
