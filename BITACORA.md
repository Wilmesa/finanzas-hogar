# Bitácora técnica y de operación — Nuestro Dinero

Este documento es la fuente de verdad operativa del proyecto. Registra qué se construyó, cómo se verificó, qué falló, qué queda pendiente y cómo trasladar el sistema a un servidor nuevo. Debe actualizarse con cada cambio de arquitectura, despliegue o incidente.

## Estado ejecutivo

- **Producto:** beta experimental funcional, lista para pruebas personales controladas.
- **Modo de prueba local:** PWA con almacenamiento persistente del navegador, sin requerir Firefly ni PostgreSQL.
- **Modo servidor:** API, PostgreSQL, Firefly, Keycloak, AI-CFO y n8n mediante Docker Compose.
- **Datos reales:** no deben cargarse hasta completar la lista “Antes de producción”.
- **Zona horaria base:** `America/Bogota`.
- **Moneda base:** COP; USD y EUR admitidas sin mezclarse automáticamente.

## Registro cronológico

### 2026-07-19 — Arquitectura y vertical slice inicial

#### Realizado

- Creado monorepo pnpm con SvelteKit, NestJS/Fastify y paquete de dominio TypeScript.
- Modelado PostgreSQL/Prisma para hogares, miembros, bolsillos, eventos, atribuciones, check-ins e insights.
- Implementadas metas por fecha y por aporte, distribución de ingresos, gasto diario seguro, CDT, inversión y deuda.
- Implementado aislamiento lógico `household/private` y redacción “Asignación personal — Miembro”.
- Implementado adaptador Firefly con un token compartido y uno privado por miembro.
- Creado AI-CFO FastAPI con Responses API, JSON Schema, proveedor deshabilitado determinístico y validador de evidencias.
- Creado workflow n8n para recordatorio diario.
- Creado Docker Compose con Caddy, PostgreSQL, Redis, Firefly, Keycloak, n8n y AI-CFO.
- Añadidas documentación de arquitectura y seguridad.

#### Verificado

- `pnpm check`: TypeScript y Svelte sin errores ni advertencias.
- `pnpm test`: cinco pruebas de dominio aprobadas.
- `python3 -m pytest services/ai-cfo/tests -q`: dos pruebas aprobadas.
- `pnpm build`: web, API y dominio compilan.
- JSON de Keycloak/n8n y YAML de Compose válidos sintácticamente.

#### No verificado o bloqueado

- Docker no está instalado en la estación de trabajo actual; no se han levantado los contenedores juntos.
- El sandbox impidió abrir el puerto local 5173, por lo que no se completó una inspección visual automatizada en navegador.
- No se probaron credenciales Firefly reales ni un proveedor LLM real.

### 2026-07-19 — Conversión a beta de producción

#### Objetivo de esta iteración

- Hacer que la PWA funcione por sí misma para pruebas locales persistentes.
- Conectar los mismos casos de uso con la API en modo servidor.
- Completar simuladores y flujos críticos visibles.
- Añadir scripts de preflight, backup, restauración y migración.
- Documentar la migración completa al servidor personal.

#### Realizado

- Añadido modo local persistente: creación de bolsillos, aportes, registro de gastos, búsqueda, filtros, exportación, importación y restauración de demo.
- Añadido modo servidor con OIDC Authorization Code + PKCE, renovación de sesión y cliente autenticado de API.
- Conectadas las vistas Hoy, Bolsillos, Movimientos, Futuro y Más al almacén local o a la API según el entorno.
- Añadido catálogo de cuentas Firefly por alcance y selector obligatorio de cuenta/tarjeta al registrar; los gastos reales ahora actualizan también el evento y saldo virtual del bolsillo.
- Implementados simuladores interactivos de meta, CDT, deuda, inversión e inmueble; la calculadora inmobiliaria también existe en la API y el paquete de dominio.
- Corregido el mapeo estable entre IDs Keycloak, miembros del producto y tokens Firefly privados.
- Añadidos audience/attribute mappers y PKCE al realm Keycloak.
- Implementada ingesta persistente y deduplicada de noticias BanRep y Alpha Vantage opcional.
- Añadidos recordatorios reales por Telegram desde la API; mensajes genéricos sin contenido privado.
- Corregida la fecha de elegibilidad de recordatorios para `America/Bogota`.
- Añadidos `init-env`, `configure-domain`, `preflight`, `deploy`, `backup` y `restore`.
- Añadida guía detallada `docs/MIGRATION.md` y puertos locales protegidos para Firefly/n8n mediante túnel SSH.
- Eliminadas contraseñas de base de datos codificadas; todos los servicios usan secretos de entorno.
- Fijadas imágenes actuales revisadas: Firefly 6.6.3, Keycloak 26.6.3 y rama estable n8n 2.29.11.

#### Verificado

- `pnpm check`: 0 errores y 0 advertencias Svelte/TypeScript.
- `pnpm test`: 7 pruebas determinísticas de dominio aprobadas, incluida la proyección desde fin de mes.
- `pnpm build`: web, API y dominio compilados para producción.
- `python3 -m pytest services/ai-cfo/tests -q`: 2 pruebas aprobadas.
- JSON de Keycloak/n8n y YAML de Compose válidos sintácticamente.
- Scripts shell y módulos Node válidos sintácticamente.

#### Fallos y decisiones

- La primera ejecución de pnpm no interactiva pidió confirmar la recreación de `node_modules`; se repitió con `CI=true` y completó correctamente. No es un fallo del producto.
- Docker sigue ausente en esta estación. El preflight local lo reporta como requisito incumplido; no se declara validación E2E del stack.
- El puerto local continúa bloqueado por el sandbox, así que la prueba visual interactiva debe ejecutarla el usuario con `pnpm dev:local` en su terminal o realizarse en el servidor.
- No se usaron datos financieros ni credenciales reales durante las pruebas.

### 2026-07-20 — Módulo de planificación y memoria financiera

#### Realizado

- Separado el dominio en `IncomeSource`, `ExpectedIncome`, `FinancialPlan`, `PlanFundingAllocation`, `PlanRevision` y `PlanAuditEvent`.
- Añadida migración Prisma `202607200001_financial_planning` con relaciones, índices y estados de ciclo de vida.
- Implementado cálculo determinístico de cantidades fijas, porcentajes y remanente; detecta sobreasignación y remanentes duplicados.
- Añadida clasificación automática `today / this_week / this_month / next_90_days / future` sin tratar ingresos previstos como saldo real.
- Implementada generación acotada de ocurrencias semanales, quincenales, mensuales, trimestrales, semestrales y anuales, con deduplicación y fechas de fin de mes correctas.
- Implementada API para crear fuentes, programar ingresos, crear/revisar planes y consultar todas las versiones anteriores.
- Integrados los ingresos futuros permitidos en el snapshot AI-CFO como expectativas no disponibles, con evidencia y sin notas libres.
- Aplicada privacidad por alcance y moneda: un plan compartido no puede enlazar fuentes o bolsillos privados; los privados solo son visibles al propietario.
- Añadida pantalla **Plan** con calendario de liquidez, creación guiada, asignaciones a varios bolsillos, previsualización, historial y nuevas notas de revisión.
- Actualizada la pantalla **Hoy** para mostrar el siguiente ingreso planeado y enlazar su acuerdo.
- El respaldo local sube a esquema 2 y conserva compatibilidad de lectura con esquema 1; la importación al servidor incluye fuentes, eventos, planes y revisiones en orden.
- Documentados principios de gasto consciente, alineación con valores, incertidumbre, horizonte y riesgo en `docs/PLANNING.md`.

#### Decisiones

- La recurrencia describe la fuente; cada pago real o previsto se conserva como una ocurrencia independiente para recordar el mes, cantidad y motivo exactos.
- Confirmado y recibido son estados distintos. Esta entrega no mueve dinero al marcar una expectativa ni ejecuta automáticamente las asignaciones.
- Toda revisión incrementa la versión y guarda snapshot, autor, fecha y explicación; el historial anterior no se sobrescribe.
- La asignación desde un ingreso compartido hacia una finalidad privada queda bloqueada hasta implementar asiento redactado más outbox/saga.

#### Verificación

- `pnpm verify`: check, 12 pruebas de dominio, build y formato aprobados.
- `svelte-check`: 0 errores y 0 advertencias, incluida la nueva ruta `/planning`.
- `python3 -m pytest services/ai-cfo/tests -q`: 2 pruebas aprobadas después de ampliar el prompt.
- `prisma validate`: esquema válido con `DATABASE_URL` sintáctica de prueba; no se conectó a una base real.
- JSON de Keycloak/n8n, YAML de Compose y scripts operativos continúan válidos.

#### Fallos encontrados y corregidos

- La primera prueba del nuevo reparto esperaba decimales en COP, aunque el formateador del dominio redondea COP a cero decimales. Se corrigió la expectativa; no se modificó la regla monetaria.
- La primera ejecución de `prisma validate` falló porque no existía `DATABASE_URL` en este entorno. Se repitió con una URL sintáctica de prueba y el esquema fue validado.
- El ejemplo inicial intentaba enviar una prima COP a un bolsillo USD. Se cambió a un bolsillo COP y se añadió validación estricta para impedir mezcla de moneda y alcance tanto local como servidor.

### 2026-07-20 — PWA instalable y entrega preparada para Git

#### Realizado

- Añadido manifiesto PWA completo con identidad, alcance, modo standalone, tres iconos PNG (192, 512 y maskable), accesos rápidos y metadatos para iOS.
- Añadido generador reproducible de iconos sin dependencias externas (`pnpm pwa:icons`).
- Implementado service worker versionado con precaché de recursos, navegación offline y eliminación de cachés antiguas.
- Excluidas explícitamente de caché todas las rutas `/api/*` y `/auth/*`; los datos financieros del modo servidor no se persisten en Cache Storage.
- Añadida tarjeta de estado en **Más** con conectividad, instalación y confirmación de modo offline preparado.
- Corregido el acceso rápido **Registrar movimiento** para abrir directamente el formulario mediante `/transactions?action=new`.
- Añadido workflow de CI para Node/TypeScript/Svelte, PWA reproducible y AI-CFO en Python.
- Añadido `scripts/update-server.sh`: exige árbol Git limpio, crea backup, usa `git pull --ff-only`, repite preflight y reconstruye el stack.
- Actualizadas las instrucciones de instalación, actualización y migración desde repositorio.

#### Verificado

- `pnpm verify`: check de TypeScript/Svelte, 12 pruebas de dominio, build completo y formato aprobados.
- `python3 -m pytest services/ai-cfo/tests -q`: 2 pruebas aprobadas.
- El build contiene `apps/web/build/client/service-worker.js`, manifiesto y los tres iconos declarados.
- El manifiesto y service worker responden HTTP 200 con tipos MIME correctos desde la compilación de producción.
- Inspección automatizada en navegador a 390 × 844: ancho de documento y viewport iguales (390 px), sin desbordamiento horizontal.
- Service worker confirmado por la interfaz con estado **Modo offline preparado**.
- Acceso rápido confirmado: la URL `transactions?action=new` abre el formulario.
- Flujo funcional confirmado: se creó un gasto local de prueba por COP 12.345, apareció en el historial y persistió después de recargar.
- Prueba offline confirmada: se detuvo completamente el servidor y la vista Movimientos volvió a abrir desde caché conservando el dato local.

#### Límites de esta entrega

- La PWA local quedó verificada, pero el stack integrado Firefly/Keycloak/PostgreSQL/n8n continúa sin prueba E2E porque Docker no está instalado en esta estación.
- La instalación mediante el prompt nativo depende del navegador; en iOS se usa **Compartir → Añadir a pantalla de inicio**.
- El repositorio todavía requiere configurar un remoto y credenciales Git para publicarlo.

## Cómo funciona el programa

### 1. PWA

La PWA es la única interfaz que usan los miembros. En modo local guarda un conjunto de prueba en el navegador. En modo servidor llama a `/api/v1` y autentica contra Keycloak. Nunca debe recibir PAT de Firefly, claves de IA o acceso a PostgreSQL.

### 2. API/BFF

La API valida identidad, hogar, propietario y visibilidad. Selecciona el libro Firefly correcto, guarda la atribución del producto en PostgreSQL y construye snapshots mínimos para la IA. n8n solo puede llamar endpoints restringidos de automatización.

### 3. Firefly III

Firefly registra los movimientos reales de doble entrada. Se usa un contexto compartido del hogar y un contexto privado por miembro. Los bolsillos y escenarios no son cuentas físicas: viven en el Pocket Engine.

### 4. Pocket Engine

PostgreSQL conserva políticas, eventos virtuales, asignaciones, metas y privacidad. Un aporte virtual no se convierte en transferencia bancaria salvo que el usuario confirme un movimiento real.

### 5. AI-CFO

Los cálculos son determinísticos. El LLM solo redacta explicaciones usando un JSON ya calculado. La salida se rechaza si inventa evidencia, cambia fuentes de noticias o viola el esquema.

### 6. Planning Engine

PostgreSQL conserva fuentes, ocurrencias fechadas, destinos y revisiones. Un ingreso esperado se muestra en el calendario, pero no aumenta la disponibilidad. Firefly solo se enlaza cuando exista una transacción recibida y conciliada.

### 7. n8n

n8n activa horarios y solicita a la API quién debe recibir un recordatorio. No decide privacidad, no lee Firefly y no contiene credenciales financieras.

## Antes de producción

- [ ] Instalar Docker Engine y Compose en la máquina de prueba o servidor.
- [ ] Ejecutar el preflight sin errores.
- [ ] Sustituir todos los secretos de ejemplo.
- [ ] Configurar dominio, DNS y TLS.
- [ ] Crear los dos usuarios reales en Keycloak y activar MFA.
- [ ] Configurar atributos `household_id` y `household_role` en Keycloak.
- [ ] Crear contextos/tokens Firefly compartido y privados.
- [ ] Ejecutar migraciones y seed inicial.
- [ ] Probar alta, gasto, aporte, privacidad y conciliación con Firefly real.
- [ ] Importar y probar el workflow de n8n.
- [ ] Probar backup y restauración en otra máquina.
- [ ] Revisar retención de datos del proveedor LLM.
- [x] Completar pruebas visuales básicas móvil/escritorio y prueba offline de la PWA.

## Migración completa al servidor

### Requisitos del servidor

- Linux x86_64 o arm64 actualizado.
- Docker Engine con plugin Compose.
- 4 CPU, 8 GB de RAM y 40 GB SSD como base recomendada.
- Dominio o subdominio con registros DNS hacia el servidor.
- Puertos públicos 80 y 443; SSH restringido por clave.
- Directorio persistente, por ejemplo `/opt/nuestro-dinero`.

### Procedimiento

1. Crear un backup verificable del entorno origen si ya contiene datos.
2. Clonar o copiar el repositorio en `/opt/nuestro-dinero`.
3. Copiar `.env.example` a `.env` y reemplazar todas las claves.
4. Ejecutar `node scripts/preflight.mjs`.
5. Cambiar `APP_DOMAIN` y los redirect URI exactos de Keycloak.
6. Ejecutar `docker compose pull` y `docker compose build`.
7. Ejecutar `docker compose up -d postgres redis keycloak firefly`.
8. Esperar health checks; después ejecutar `docker compose up -d api ai-cfo web caddy n8n`.
9. Ejecutar `docker compose run --rm api pnpm --filter @finanzas/api prisma:seed` una sola vez.
10. Crear los usuarios y MFA en Keycloak.
11. Crear o importar los libros Firefly y guardar sus PAT en `.env`.
12. Importar `infra/n8n/daily-reminder.workflow.json`, probarlo manualmente y activarlo.
13. Ejecutar pruebas de aceptación con cantidades pequeñas y datos ficticios.
14. Ejecutar `scripts/backup.sh`, copiar el archivo fuera del servidor y probar `scripts/restore.sh` en una instalación aislada.

### Trasladar datos existentes

- **PostgreSQL:** restaurar el dump generado por `scripts/backup.sh` antes de levantar API, Keycloak y n8n.
- **Firefly:** restaurar su base PostgreSQL y el volumen `firefly_upload` como una unidad consistente.
- **PWA local:** exportar JSON desde la aplicación y luego importarlo al modo servidor; no copiar manualmente LocalStorage.
- **Secretos:** recrearlos en el servidor; nunca incluir `.env` dentro del backup compartido.
- **Dominio:** actualizar DNS después de validar el nuevo servidor mediante un host local o subdominio temporal.

### Rollback

1. No eliminar el servidor anterior durante la ventana de validación.
2. Detener escrituras en ambos entornos.
3. Si el nuevo despliegue falla, volver a apuntar DNS al servidor anterior.
4. Restaurar únicamente desde un backup cuya suma SHA-256 haya sido verificada.
5. Registrar causa, alcance, timestamps y acciones en esta bitácora.

## Pendientes conocidos

Esta lista debe reducirse antes de declarar versión estable:

- Web Push real con suscripciones VAPID.
- Worker BullMQ y dead-letter queue.
- RLS forzado con rol PostgreSQL de runtime separado.
- Observabilidad Prometheus/Grafana/Loki conectada al código.
- Suite E2E con Firefly y Keycloak reales.
- Verificación en red real de BanRep/Alpha Vantage y alertas de fallo del proveedor.
- Outbox/saga para compensar escrituras parciales entre el libro compartido y uno privado.
- Conciliación de ingresos esperados contra depósitos Firefly y aplicación idempotente de las asignaciones acordadas.
- Alertas n8n previas a ingresos sin plan y reunión financiera periódica.
- Pruebas unitarias de API/PWA y suite permanente de regresión visual móvil/escritorio.
- Instaladores móviles Capacitor y firma de tiendas.
- Open Banking y lectura de notificaciones, reservados para Fase 2.
