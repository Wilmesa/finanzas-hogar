# Bitácora técnica y de operación — OKLE

Este documento es la fuente de verdad operativa del proyecto. Registra qué se construyó, cómo se verificó, qué falló, qué queda pendiente y cómo trasladar el sistema a un servidor nuevo. Debe actualizarse con cada cambio de arquitectura, despliegue o incidente.

## Estado ejecutivo

- **Producto:** beta experimental funcional, lista para pruebas personales controladas.
- **Modo de prueba local:** PWA con almacenamiento persistente del navegador, sin requerir Firefly ni PostgreSQL.
- **Modo servidor privado:** API, PostgreSQL, Redis, Firefly, AI-CFO, web y gateway; autenticación local ligera. Keycloak y n8n son opcionales y no arrancan por defecto.
- **Datos reales:** no deben cargarse hasta completar la lista “Antes de producción”.
- **Zona horaria base:** `America/Bogota`.
- **Moneda base:** COP; USD y EUR admitidas sin mezclarse automáticamente.

## Registro cronológico

### 2026-07-27 — Interconexión contable, revisión y resiliencia PWA

#### Implementado

- Firefly continúa como único libro real; los gastos llevan tags de bolsillo y
  no se usan Piggy Banks.
- Transferencias virtuales `released` + `allocated` sin llamada a Firefly.
- `Needs Review`, reglas priorizadas y vista móvil con gestos.
- Ingesta normalizada, deduplicación exacta/difusa y detección de ingreso
  extraordinario.
- Datos privados sanitizados en Firefly y cifrados con AES-256-GCM.
- Ejecución en bloque de planes conservando versión y resultado.
- Simulaciones persistentes convertibles en bolsillos o pagos/deudas.
- Confirmar un pago registra el retiro Firefly y recalcula la deuda.
- Snapshots inmutables con tasas; USD/COP utiliza la TRM oficial.
- Captura offline local en IndexedDB con el mismo UUID en cada reintento.
- AI-CFO con separación explícita de REAL, RESERVED y PROJECTED.
- Reasignar un bolsillo desde la bandeja revierte el impacto anterior y aplica
  el nuevo sin crear otro movimiento Firefly. La bandeja privada descifra
  comercio/categoría solo para su propietario y conserva las correcciones
  sensibles cifradas.

#### Funciona

- Registro completamente manual sin proveedor bancario.
- Prisma y TypeScript estrictos.
- Pruebas de dominio, API, web y AI-CFO.
- Degradación del proveedor de IA sin bloquear funciones financieras.
- Verificación final: `CI=true pnpm verify` aprobó 24 pruebas de dominio, 2
  web, 40 API, builds web/API y formato; `pytest` aprobó 7 pruebas AI-CFO.
- Un intento de `pnpm verify` sin `CI=true` no inició las pruebas porque el
  wrapper local intentó consultar npm y purgar `node_modules` sin TTY. La
  repetición equivalente a CI se completó correctamente.

#### Parcial o pendiente

- Existe `IOpenFinanceProvider` y una ingesta normalizada, pero un adaptador
  Belvo/Ozone requiere credenciales, contrato y formato de firma elegidos.
- La detección de prima devuelve planes candidatos; falta un Web Push dedicado
  con acción de confirmación.
- TRM cubre USD/COP. EUR y cripto requieren fuentes adicionales.
- Background Sync automático funciona con autenticación local; OIDC mantiene
  la regla de no persistir tokens.
- Para escala comercial faltan firma/replay protection del proveedor elegido,
  DLQ BullMQ, rotación administrada de cifrado y E2E con infraestructura real.
- Docker no está instalado en esta estación: 10 pruebas operativas pasaron y 7
  validaciones Compose se omitieron. No se ejecutaron builds Docker locales.

#### Migración

La migración `202607270001_financial_interconnections` es aditiva. Debe
conservarse `PRIVATE_METADATA_ENCRYPTION_KEY`; consulte `docs/MIGRATION.md`.

### 2026-07-20 — Aislamiento completo del n8n integrado

- GitHub Actions reveló que un servicio bajo `profiles` sigue interpolando variables requeridas durante `docker compose config`; por eso el target normal exigía `N8N_ENCRYPTION_KEY` aunque n8n no estuviera activo.
- Se movieron servicio, volumen, variables y secreto API de n8n a `docker-compose.n8n.yml`.
- `scripts/compose.sh` solo añade ese archivo con `ENABLE_BUNDLED_N8N=true`; el valor normal es `false` y no requiere secretos n8n.
- El preflight valida los secretos únicamente al habilitarlo. `init-env` tampoco los genera ni añade en el modo normal.
- Se añadieron siete pruebas operativas: local/Keycloak sin secretos n8n, ausencia normal del servicio, fallo seguro sin secretos, configuración opcional válida, cero puertos n8n y publicación exclusiva del gateway privado.
- `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm verify` y las 2 pruebas pytest volvieron a pasar localmente. Las siete pruebas Docker se descubren correctamente pero se omiten aquí porque esta estación no tiene Docker; Actions ejecuta las siete y las combinaciones Compose literales.
- No se añadieron secretos reales, ficticios estáticos ni valores predeterminados para n8n. Las pruebas generan material efímero en cada proceso.

### 2026-07-20 — Autenticación local ligera para el despliegue privado

#### Causa y decisión

- La imagen API no incluía `class-validator`/`class-transformer` aunque `ValidationPipe` los requiere en runtime. Se añadieron como dependencias de producción sin retirar `transform=true`.
- Keycloak imponía un servicio desproporcionado para dos usuarios en una red privada. Se conservó como override explícito y se estableció `AUTH_MODE=local` para el target privado.

#### Implementado

- `LocalUser` uno a uno con `Member` y migración Prisma aditiva, sin modificar datos financieros.
- Hash scrypt (`N=65536`, `r=8`, `p=1`) con salt aleatorio; sesiones opacas y rate limit en el Redis existente.
- Cookie `HttpOnly`, `Secure`, `SameSite=Strict`; token CSRF en memoria, renovación, logout y revocación global por versión de contraseña.
- Login PWA por correo/usuario, consulta `/me`, cierre y cambio de contraseña. No se almacenan credenciales locales en Web Storage.
- Bootstrap idempotente y oculto para dos usuarios mediante `scripts/bootstrap-local-users.sh`.
- Compose local sin Keycloak/n8n; `docker-compose.keycloak.yml` conserva OIDC/PKCE opcional.
- Backup/restore incluyen la tabla local porque ya respaldan PostgreSQL; actualizar imágenes no elimina usuarios.

#### Verificado en esta estación

- Instalación bloqueada, `pnpm db:generate` y `pnpm verify`: correctos; TypeScript/Svelte sin errores, 12 pruebas de dominio y 15 pruebas API aprobadas, builds de PWA/API correctos y formato limpio.
- `python3 -m pytest services/ai-cfo/tests -q`: 2 pruebas aprobadas.
- Pruebas locales de hash, credenciales correctas/incorrectas, usuario ausente/deshabilitado, expiración, rate limit, cambio, revocación, cookie y aislamiento: correctas.
- Las pruebas Compose y el smoke real quedaron preparados para CI, pero se omiten localmente porque Docker no está instalado. No se afirma ahorro de memoria: no pudo medirse de forma comparable.

#### Pendiente de cierre

- Confirmar Compose, builds y smoke Docker mediante GitHub Actions.
- Confirmar visualmente login/cambio de contraseña en la PWA instalada.
- No se ha desplegado ni modificado el servidor personal.

### 2026-07-20 — Prisma Client reproducible en instalaciones limpias

#### Causa raíz

- `pnpm verify` ejecutaba TypeScript antes de `prisma generate`. La estación local conservaba Prisma Client generado en `node_modules`, mientras GitHub Actions comenzaba con la exportación genérica de `@prisma/client`, sin `Decimal`, `InputJsonValue`, errores conocidos ni tipos de modelos.

#### Solución

- CI ejecuta explícitamente `pnpm db:generate` inmediatamente después de `pnpm install --frozen-lockfile`.
- `@finanzas/api` declara `precheck` y `prebuild`, por lo que tanto una comprobación directa como cualquier build local o Docker generan el cliente antes de `tsc`.
- El Dockerfile usa el contrato `prebuild` del paquete y no mantiene una segunda secuencia de generación exclusiva del contenedor.
- La repetición entre el paso explícito de CI y los hooks es intencional: `prisma generate` es determinístico e idempotente; el primero hace visible el prerrequisito del pipeline y los segundos protegen comandos directos fuera de CI.

#### Invariantes

- No se relajó `strict`/`noImplicitAny`, no se añadieron `any`, `@ts-ignore` o archivos generados a Git.
- El cliente se sigue generando dentro de `node_modules`; ejecutar generación y pruebas debe conservar el árbol Git limpio.

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
- Añadido el primer adaptador externo de recordatorios con mensajes genéricos; fue sustituido posteriormente por Web Push nativo.
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

### 2026-07-20 — Preparación DevSecOps para Tailscale privado

#### Diagnóstico

- Compose fijaba `name: finanzas-pareja`, abría 80/443 por defecto e iniciaba el n8n incluido siempre.
- Existían valores de respaldo inseguros para PostgreSQL, Keycloak, Firefly, AI-CFO y n8n.
- `configure-domain.mjs` modificaba un realm versionado y dejaba Git sucio.
- `APP_DOMAIN` no representaba correctamente un origen HTTPS con puerto.
- Backup y restore asumían nombres de volúmenes rígidos y no conservaban metadata de commit/imágenes.

#### Implementado

- Separados `docker-compose.yml`, `docker-compose.private.yml`, `docker-compose.public.yml` y el override administrativo temporal de Firefly.
- Eliminado el nombre Compose rígido; `COMPOSE_PROJECT_NAME` aísla dev y producción.
- Target privado limitado a un gateway en `127.0.0.1:${APP_LOCAL_PORT}`; ningún otro servicio publica puertos.
- Separadas redes `edge` y `backend`; PostgreSQL/Redis permanecen sin exposición.
- n8n incluido se aisló posteriormente en `docker-compose.n8n.yml`; el workflow y la integración externa se conservan.
- Añadidos healthchecks funcionales para gateway, web, API, AI-CFO, PostgreSQL, Redis, Firefly, Keycloak y n8n opcional.
- Añadida rotación de logs Docker a tres archivos de 10 MB. No se impusieron capacidades/read-only a imágenes de terceros sin prueba integrada.
- Sustituidos secretos fallback por interpolación obligatoria y generación criptográfica idempotente.
- Introducido `APP_ORIGIN` con validación de HTTPS, puerto opcional y prohibición de rutas/credenciales.
- Convertido el realm Keycloak en plantilla; el runtime ignorado se genera con permisos 0600 y se sincroniza mediante `kcadm`.
- Adaptados deploy/update para target explícito, migraciones, esperas de health, backup previo, commit de rollback y `git pull --ff-only`.
- Backup formato 2 incluye PostgreSQL, Firefly upload, Redis, volúmenes opcionales presentes, runtime, `.env` protegido, imágenes y metadata. Restore exige confirmación y compatibilidad.
- Creada `docs/DEPLOY_PRIVATE_TAILSCALE.md` con bootstrap, Tailscale Serve, aceptación, n8n externo, actualización, rollback y eliminación segura.

#### Verificación realizada hasta este punto

- YAML de los cuatro archivos Compose válido sintácticamente.
- Scripts Node y shell válidos sintácticamente.
- Cuatro pruebas nuevas de APP_ORIGIN, realm y secretos aprobadas.
- TypeScript/Svelte: cero errores y advertencias.
- `init-env` ejecutado dos veces sin sustituir secretos válidos.
- `configure-domain` ejecutado dos veces con hash idéntico y sin cambiar `git status`.
- Runtime y `.env` generados con permisos 0600.
- Preflight bootstrap sin Docker aprobado y PAT pendientes reportados como advertencias.

#### Pendiente antes de fusionar

- Suite completa, build PWA/API/AI, validaciones finales y revisión estática de puertos.
- `docker compose config` y build de imágenes no pueden ejecutarse localmente porque esta estación no tiene Docker; se configuraron como controles obligatorios de CI.
- Prueba E2E integrada seguirá siendo obligatoria en Ubuntu antes de usar datos reales.

### 2026-07-20 — Recordatorios configurables Web Push

#### Implementado

- Eliminado el canal de mensajería externo, sus secretos, endpoints y ramas de workflow.
- Añadidas preferencias individuales con zona horaria y múltiples horas `HH:mm`; cada miembro administra sus horarios desde **Más**.
- Añadido registro por dispositivo mediante Push API/VAPID. Las claves se generan de forma criptográfica e idempotente con `init-env` y nunca se imprimen.
- Añadido planificador interno cada 30 segundos y endpoint opcional para n8n cada minuto. La restricción única miembro/fecha/hora evita envíos duplicados.
- Añadida trazabilidad `ReminderDelivery` con estados `processing`, `sent` o `failed`, sin guardar contenido financiero.
- Los check-ins diarios detienen los recordatorios restantes; las suscripciones expiradas se eliminan al recibir HTTP 404/410 del proveedor Push.
- El service worker muestra un texto genérico y abre la captura rápida al tocar la notificación.

#### Verificado

- Prisma Client generado con las nuevas tablas y relaciones.
- `pnpm check`: cero errores y cero advertencias.
- `pnpm test`: 12 pruebas de dominio, 2 pruebas de recordatorios y 5 pruebas operativas aprobadas.
- `.env` recibió un par VAPID válido sin mostrar valores y conserva permisos 0600.
- Inspección responsive en navegador a 390 × 844: tarjeta de recordatorios contenida en 360 px, documento sin desbordamiento horizontal y consola sin errores ni advertencias. En modo local se muestra correctamente como función disponible al conectar el servidor.

#### Pendiente

- Aplicar la migración en PostgreSQL real durante el primer despliegue.
- Probar entrega de extremo a extremo en Android y en iOS con la PWA instalada desde el origen HTTPS Tailscale.
- Confirmar el comportamiento del sistema operativo con ahorro de batería y permisos revocados; Push no garantiza una hora exacta al segundo.

## Cómo funciona el programa

### 1. PWA

La PWA es la única interfaz que usan los miembros. En modo de datos local guarda un conjunto de prueba en el navegador. En modo servidor llama a `/api/v1` y usa cookie local segura o Keycloak según `PUBLIC_AUTH_MODE`. Nunca debe recibir PAT de Firefly, claves de IA o acceso a PostgreSQL.

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

### 7. Recordatorios Web Push y n8n

La API compara cada minuto aproximado con los horarios individuales, evita duplicados mediante una clave por miembro/fecha/hora y entrega un Web Push genérico a cada dispositivo registrado. n8n es un disparador redundante opcional: no decide horarios, no lee Firefly y no contiene credenciales financieras.

## Antes de producción

- [x] Instalar Docker Engine/Compose y ejecutar el stack en una VM local limpia.
- [x] Ejecutar el preflight sin errores de configuración.
- [ ] Sustituir todos los secretos de ejemplo.
- [ ] Configurar dominio, DNS y TLS.
- [ ] Ejecutar `scripts/bootstrap-local-users.sh` y probar ambos usuarios locales.
- [ ] Crear contextos/tokens Firefly compartido y privados.
- [ ] Ejecutar migraciones y seed inicial.
- [ ] Probar alta, gasto, aporte, privacidad y conciliación con Firefly real.
- [ ] Instalar la PWA en ambos móviles, conceder permiso y probar cada suscripción Web Push.
- [ ] Si se desea redundancia, importar y probar el workflow opcional de n8n.
- [ ] Probar backup y restauración en otra máquina.
- [ ] Revisar retención de datos del proveedor LLM.
- [x] Completar pruebas visuales básicas móvil/escritorio y prueba offline de la PWA.

## Migración completa al servidor

El procedimiento vigente y probado por diseño está en `docs/DEPLOY_PRIVATE_TAILSCALE.md`; `docs/MIGRATION.md` explica el traslado genérico entre máquinas. Ambos usan una ruta configurable, `APP_ORIGIN`, los overrides por target y `scripts/compose.sh`. No se deben seguir instrucciones antiguas que publiquen directamente servicios internos o invoquen Compose sin seleccionar target.

## Pendientes conocidos

Esta lista debe reducirse antes de declarar versión estable:

- Prueba E2E de Web Push en Android y en una PWA instalada en iOS contra el origen Tailscale real.
- Worker BullMQ y dead-letter queue.
- RLS forzado con rol PostgreSQL de runtime separado.
- Observabilidad Prometheus/Grafana/Loki conectada al código.
- Suite E2E con Firefly real; Keycloak solo necesita regresión si se habilita el modo opcional.
- Verificación en red real de BanRep/Alpha Vantage y alertas de fallo del proveedor.
- Outbox/saga para compensar escrituras parciales entre el libro compartido y uno privado.
- Conciliación de ingresos esperados contra depósitos Firefly y aplicación idempotente de las asignaciones acordadas.
- Alertas n8n previas a ingresos sin plan y reunión financiera periódica.
- Pruebas unitarias de API/PWA y suite permanente de regresión visual móvil/escritorio.
- Instaladores móviles Capacitor y firma de tiendas.
- Adaptador firmado del proveedor Open Finance real; el sandbox local ya cubre
  `pending → posted`, cambio de identificador e idempotencia.

## 2026-07-28 — TRM primaria, sandbox Open Finance, llavero y Docker real

### 1. TRM sin punto único de falla

- `ExchangeRatesService` consulta primero `queryTCRM` en el Web Service SOAP de
  la Superintendencia Financiera. Datos Abiertos Colombia (`32sa-8pi3`) quedó
  exclusivamente como fallback.
- La respuesta se valida por `success`, valor positivo y vigencia. La tasa se
  persiste con fuente, URL, fecha efectiva y fecha de consulta.
- Prueba real desde el contenedor API el 28 de julio: `USD/COP = 3205.8`,
  fuente `Superintendencia Financiera de Colombia / Web Service TRM`.
- Dos pruebas unitarias cubren fuente primaria y caída primaria con fallback.

### 2. Open Finance reproducible sin banco real

- Se formalizó `IOpenFinanceProvider` y se implementó
  `MockOpenFinanceAdapter`, desactivado por defecto y autenticado con
  HMAC-SHA256.
- `scripts/mock-open-finance.mjs` puede emitir un lote pendiente, publicado o
  ambas fases. El banco simulado cambia el identificador externo al publicar.
- La ingesta fusiona el cambio `pending → posted`, actualiza el registro
  importado y reutiliza la atribución/transacción Firefly. La prueba de servicio
  confirma una sola llamada a Firefly.
- No se ejecutó una inyección bancaria completa contra el Firefly efímero
  porque no existen PAT de libros configurados en esta estación. No se inventó
  un token ni se debilitó la autenticación. La integración con Belvo/Ozone
  continúa dependiendo de credenciales, consentimiento y firma del proveedor.

### 3. Ciclo de vida criptográfico

- Se reemplazó la dependencia de una sola llave en `.env` por un llavero
  versionado `secrets/private-metadata-keyring.json`, permisos `0600`, ignorado
  por Git y montado en la API como secreto de solo lectura.
- Los sobres nuevos son `v2.keyId.iv.tag.ciphertext`; `keyId` también forma
  parte del AAD de AES-256-GCM. Se conservó lectura `v1` solo para migración.
- `POST /v1/security/private-metadata/rotate` recifra únicamente los registros
  privados del miembro autenticado, exige idempotencia y deja auditoría.
- Backup formato 3 incluye el llavero; restauración admite formatos 2 y 3. El
  preflight valida JSON, llave activa, 32 bytes Base64 y permisos.
- Límite declarado: es un KMS local simulado para uso doméstico. El robo
  aislado de `.env` ya no entrega la llave, pero `root`, el socket Docker o el
  proceso API comprometido todavía pueden leer el secreto. SaaS requiere
  KMS/HSM/Vault externo.

### 4. Orquestación Docker observada

- Se instalaron Colima `0.10.3`, Docker CLI `29.6.2` y Docker Compose `5.3.1`.
  `scripts/compose.sh` admite tanto el plugin como el binario standalone.
- El primer build no se ocultó: falló con errores de E/S cuando el disco del
  host llegó a aproximadamente 116 MiB libres. Se eliminó únicamente la VM
  temporal corrupta y caché de Colima; no contenía datos de OKLE. Después de
  liberar espacio se creó una VM limpia de 4 CPU, 8 GiB RAM y disco de 20 GiB.
- Las imágenes `api`, `web` y `ai-cfo` se construyeron desde el estado final.
  PostgreSQL, Redis, Firefly III `6.6.3`, AI-CFO, API, PWA y gateway quedaron
  `healthy`.
- Las nueve migraciones Prisma se aplicaron en una base vacía, incluida
  `202607270001_financial_interconnections`, sin eliminar migraciones.
- El smoke test verificó API→PostgreSQL, API→Redis, API→Firefly,
  API→AI-CFO, Firefly→API para la ruta de webhooks y gateway→API/PWA.
- El primer smoke falló porque Node resolvía Prisma desde `/app`; se corrigió
  para ejecutar desde `/app/apps/api` y se repitió con éxito.
- Solo el gateway publica `127.0.0.1:3100`; los demás servicios no publican
  puertos. Los logs no muestran errores. Se corrigieron formato y cabeceras
  redundantes de Caddy; las advertencias restantes corresponden a HTTP interno
  sin TLS porque Tailscale termina HTTPS deliberadamente.

### 5. Verificación final

- `CI=true pnpm install --frozen-lockfile`: correcto.
- `CI=true pnpm db:generate`: Prisma Client `6.19.3` generado.
- Primera ejecución de `pnpm verify`: todo salvo formato aprobó; Prettier
  identificó 12 archivos nuevos. Se formatearon y se repitió la suite completa.
- `CI=true pnpm verify`: correcto. Svelte 0 errores/0 advertencias; TypeScript
  correcto; dominio 24/24, web 2/2, API 48/48 y operaciones 18/18; builds
  web/API y Prettier correctos.
- `python3 -m pytest services/ai-cfo/tests -q`: 7/7.
- Compose privado, público y n8n opcional validaron con `config --quiet`. Los
  secretos n8n de la prueba fueron efímeros; sin secretos, su prueba confirma
  que el override opcional falla como debe.
- Búsqueda de patrones de PAT, claves LLM, llaves privadas y tokens: sin
  coincidencias. `.env` y el llavero permanecen ignorados y con permisos
  `0600`; no se añadieron secretos ni datos personales.

## 2026-07-21 — Estabilización funcional y rediseño previo a OKLE

### Diagnóstico confirmado

- El 500 al crear bolsillos provenía de `CreatePocketSchema.parse`: el `ZodError` escapaba de NestJS sin traducirse a HTTP 400. El formulario periódico enviaba una política válida, pero cualquier valor vacío/no numérico terminaba como error interno genérico.
- Los nombres ficticios provenían de `finance-store.ts`, `demo.ts`, `Nav.svelte` y los selectores de pagador. En modo servidor la hidratación sustituía colecciones, pero no la configuración `memberName`, por lo que el usuario autenticado seguía viendo una identidad demo.
- `GET /v1/accounts` usaba `Promise.all`; la ausencia de un PAT privado rechazaba también las cuentas compartidas. Solo existía lectura y no había interfaz de administración.
- La portada contenía un insight estático sin consulta a AI-CFO. La generación existente no persistía su respuesta ni mostraba proveedor, período o evidencia.
- La transacción se creaba primero en Firefly y solo después en PostgreSQL; una caída intermedia podía dejar un movimiento real sin atribución local.

### Implementado y funcionando en pruebas automatizadas

- Branding visible de la etapa anterior, manifiesto, service worker e iconos PWA reproducibles 192/512/maskable.
- Tema claro, oscuro y sistema con tokens CSS propios; se retiró el plugin Tailwind del build para evitar dos sistemas visuales simultáneos.
- Navegación principal Hoy/Futuro/Patrimonio/Copiloto/Movimientos y accesos secundarios a Bolsillos, Cuentas y Configuración.
- Perfiles y hogar reales: lectura de miembros, edición del nombre propio/color, edición del hogar solo por owner y cambio de contraseña local.
- Onboarding diagnosticable basado en datos existentes; no guarda PAT ni claves en el cliente.
- Cuentas Firefly: listar, crear, editar, archivar y probar por alcance. La respuesta usa `allSettled`, de modo que un libro ausente no bloquea el otro.
- Bolsillos: validación amigable 400, creación de las ocho finalidades con las tres políticas, aporte, pausa/reanudación, archivo, privacidad y versión optimista.
- Pagador construido desde los miembros reales. Un gasto privado solo puede atribuirse al actor; uno compartido admite miembros reales del hogar.
- Estado de sincronización `pending/synchronized/failed`, error sanitizado y clave idempotente. Las asignaciones comunes privadas dejan un movimiento compartido redactado y detalle privado.
- Copiloto real: proveedores `openai`, `gemini`, `openai_compatible`, `deterministic` y `disabled`; el genérico conecta NVIDIA NIM, Groq, OpenRouter, Together o gateways sin cambiar la app. Incluye diagnóstico sin revelar claves, persistencia de salida, alcance, período, prioridad, confianza, evidencia y fecha.
- Portada sin insight fijo. Si no existe análisis, muestra un estado vacío; si faltan datos, AI-CFO devuelve `insufficient_data`.
- Pantalla Patrimonio derivada de cuentas Firefly y proyectos del Pocket Engine, sin sumar monedas diferentes.
- Script `scripts/firefly-admin.sh start|stop|status`, limitado a loopback y sin eliminación de volúmenes.
- Migración Prisma `202607210002_finnest_profiles`, aditiva y no destructiva.

### Verificación realizada durante la implementación

- Instalación reproducible: `CI=true pnpm install --frozen-lockfile` correcta.
- Prisma Client generado correctamente con los nuevos modelos y campos.
- `pnpm check`: TypeScript y Svelte con 0 errores y 0 advertencias.
- `pnpm test`: 21 pruebas de dominio y 22 pruebas API aprobadas en la primera ronda; se añadieron después pruebas de perfiles y activos PWA para la verificación final.
- No se usaron claves reales, datos del servidor ni operaciones contra el hogar existente.

### Pendiente de la verificación final de esta rama

- Ejecutar `pnpm verify`, pytest, generación reproducible de iconos, validaciones Compose y builds Docker.
- Ejecutar el smoke integrado; si Docker no está disponible en esta estación, CI debe hacerlo en Ubuntu y se debe conservar el resultado como pendiente, no ocultarlo.
- Inspección visual y screenshots en 390, 430 y escritorio.
- Publicar la rama, crear PR y esperar todos los checks sin fusionar ni desplegar.

### Migración y rollback

La actualización del servidor se realizará únicamente después de revisión manual y merge. El procedimiento es `scripts/backup.sh`, árbol Git limpio y `DEPLOY_TARGET=private scripts/update-server.sh`. No usar `docker compose down -v`, no renombrar volúmenes ni cambiar `COMPOSE_PROJECT_NAME`. El rollback de código usa `runtime/deploy/last-update.env`; las columnas nuevas son compatibles hacia atrás y no requieren borrarse para volver temporalmente a la imagen anterior.

## 2026-07-21 — Blueprint de estabilización y marca definitiva OKLE

### Implementado

- Marca definitiva **OKLE** en interfaz, PWA, notificaciones, Keycloak, AI-CFO, documentación y metadatos. El isotipo es una O corporativa azul marino con acento ámbar.
- Migración transparente de preferencias y demostración local desde las claves históricas `finnest:*`; no se elimina información previa. El service worker elimina únicamente cachés estáticas obsoletas.
- Sistema visual azul marino/ámbar, tipografía única Inter/sistema, cifras tabulares, iconos SVG, navegación mobile-first de cinco destinos y navegación secundaria de escritorio.
- CRUD real de fuentes e ingresos esperados, edición de movimientos, edición y archivo seguro de bolsillos con decisión explícita para el saldo, y CRUD de categorías configurables.
- Registro genérico `AuditLog` para cambios sensibles y `ChatMessage` para conversación trazable. La migración aditiva es `202607220001_okle_crud_chat`.
- Asesor OKLE conversacional con historial separado `household/private`, contexto agregado mínimo y persistencia. Funciona con `openai`, `gemini`, `deterministic` o `openai_compatible`; este último admite NVIDIA NIM, Groq, OpenRouter, Together, LiteLLM y gateways equivalentes.
- Pantalla de movimientos con filtros por texto, pagador, categoría y fecha, edición y señal visual de recurrencia; configuración de categorías desde Más.
- Se retiraron las dependencias Tailwind residuales: OKLE mantiene un único sistema de tokens CSS.

### Comprobado hasta esta revisión

- Instalación reproducible con lockfile actualizado.
- Prisma Client generado con `Category`, `AuditLog`, `ChatMessage` y tipos de dominio existentes.
- `pnpm check`: 0 errores TypeScript, 0 errores Svelte y 0 advertencias.
- No se añadieron `any`, `@ts-ignore`, secretos, tokens ni datos domésticos reales.

### Verificación final de esta revisión

- `pnpm verify`: correcto. Incluye TypeScript/Svelte (0 errores, 0 advertencias), 21 pruebas de dominio, 24 pruebas API, build de producción web/API y Prettier.
- `python3 -m pytest services/ai-cfo/tests -q`: 7 pruebas aprobadas, incluida conversación determinística y selección de proveedor compatible.
- Iconos PWA 192/512/maskable regenerados de forma reproducible con la marca OKLE.
- QA real en navegador a 390 × 844: portada, Asesor OKLE y Movimientos sin desbordamiento horizontal (`scrollWidth = innerWidth = 390`); navegación inferior mide 65 px y la secundaria de escritorio queda oculta.
- La inspección visual detectó un botón Editar que creaba una fila implícita en móvil. Se corrigió con columna explícita e icono accesible y se volvió a comprobar en un origen limpio.
- Docker no está instalado en esta estación (`docker: command not found`): las siete pruebas operativas Compose quedaron `SKIP` por esa condición. No se afirma que se ejecutaron; CI Ubuntu debe validarlas.

### Pendientes y límites conocidos

- La persistencia especializada de deudas y tarjetas (fechas de corte, pago y estado mensual) continúa como evolución funcional; las proyecciones determinísticas y cuentas Firefly existentes siguen disponibles.
- La búsqueda web en vivo debe activarse por proveedor con políticas y fuentes aprobadas; el chat actual no inventa citas y solo muestra enlaces cuando el servicio devuelve referencias verificables.
- Falta ejecutar validaciones Compose y builds Docker en CI o en una estación con Docker.
- Ninguna migración se aplicó al servidor personal; se aplicará después de revisión, backup y merge siguiendo `docs/DEPLOY_PRIVATE_TAILSCALE.md`.

## 2026-07-22 — Logo definitivo, Pagos, ejecución de planes y patrimonio

### Implementado

- Se integró el logo familiar suministrado como maestro `apps/web/static/icons/okle-master.png`; el generador Node lo convierte de forma reproducible a 192/512/maskable sin depender de utilidades del sistema.
- El manifiesto cambió a `id=/okle`; la revisión actual usa `start_url=/?source=okle-pwa-v3`. El service worker conserva la limpieza de cachés históricas. Una instalación móvil anterior puede requerir desinstalar y reinstalar una vez porque Android/iOS conservan el nombre instalado.
- Disponible real de portada = saldos de cuentas del alcance menos reservas activas en bolsillos de la misma moneda. Los ingresos futuros siguen excluidos hasta recibirse.
- Planes: editar destinos y datos crea otra revisión; archivar conserva auditoría; un ingreso recibido permite ejecutar cada destino total o parcialmente con `Idempotency-Key`. Solo la parte ejecutada se vuelve reserva virtual.
- Nuevo dominio Pagos: tipo, monto total/aproximado, frecuencia, fecha, enlace, referencia, privacidad, ocurrencias, urgencia visual y confirmación del valor real/origen. Los pagos próximos activan distintivo PWA y notificación genérica, sin revelar el nombre de pagos privados.
- Patrimonio: posiciones CDT/CAT, acciones, fondos o dólares en app; tasa, vencimiento, bruto, costos, neto, ticker, unidades, precio/fecha/fuente. También inmuebles con sector, valoración, supuesto de apreciación y una serie histórica de cortes netos.
- Asesor: Enter envía, Shift+Enter crea línea, se puede limpiar la conversación propia y el contexto agrega gastos por categorías y miembros anónimos. Nunca incluye nombres, números de cuenta, notas libres ni datos privados de la pareja.
- Noticias: intento de ingesta oficial BanRep, cobertura agregada de respaldo nacional/regional/mundial, Alpha Vantage opcional y RSS HTTPS configurables. La pantalla muestra estado por fuente y errores en vez de fingir contenido.
- Contraste oscuro corregido en portada, tarjeta del Asesor, instalación PWA y botón flotante; este último queda por encima de la navegación móvil. Formularios y filtros usan altura coherente.

### Funciona y fue comprobado

- `CI=true pnpm install --frozen-lockfile`: correcto.
- `pnpm db:generate`: Prisma Client generado con `PaymentPlan`, `PaymentOccurrence`, `InvestmentPosition`, `PropertyAsset`, `NetWorthSnapshot`, `Prisma.Decimal`, tipos JSON y errores oficiales.
- `pnpm verify`: correcto; TypeScript/Svelte 0 errores y 0 advertencias, 21 pruebas de dominio, 27 pruebas API (incluidas validación/privacidad de Pagos), 9 pruebas operativas aprobadas, builds web/API y formato.
- `python3 -m pytest services/ai-cfo/tests -q`: 7 aprobadas.
- QA móvil real a 390 × 844: navegación, botón Registrar y tarjeta de disponible visibles; se corrigieron el contraste detectado y la incoherencia del saldo demo.
- La búsqueda de secretos no encontró claves, `.env`, tokens ni datos personales nuevos.

### No probado o pendiente

- Docker no está instalado en esta estación: 7 pruebas Compose permanecen `SKIP`; los builds Docker y healthchecks deben ejecutarse en GitHub Actions/servidor antes de datos reales.
- No se aplicó la nueva migración a ninguna base ni se desplegó al servidor.
- Marcar un pago guarda trazabilidad de planificación; el gasto bancario debe registrarse/conciliarse aparte con Firefly. Automatizar ese enlace será la siguiente extensión del adaptador.
- Las cotizaciones se ingresan con fuente y fecha. No hay órdenes automáticas ni recomendación de compra/venta; el Asesor se mantiene educativo.
- La entrega Web Push debe verificarse en las PWA reales de ambos móviles.

## 2026-07-22 — Correcciones operativas de tema, chat, planes, pagos y noticias

## Implementado

- Selector claro/oscuro persistente en la esquina superior derecha de todas las pantallas autenticadas, con luna y sol según la acción disponible.
- Revisión de contraste oscuro en tarjetas, formularios, botones, mensajes, accesos de configuración, PWA y recordatorios.
- “Pagos” queda visible en móvil desde el primer bloque de “Más”; el distintivo de vencimientos también aparece sobre esa pestaña.
- El borrado de la conversación compartida elimina todo lo que esa vista muestra; el chat privado continúa limitado al miembro actual. La interfaz confirma cuántos mensajes se eliminaron y muestra errores.
- Los ingresos cancelados salen de “Lo que viene” y quedan en un historial desplegable. Editar, cancelar, desactivar y archivar muestran resultado o error en lugar de fallar silenciosamente.
- Corregida la edición de planes que contienen destinos de tipo pago; antes el formulario filtraba por error esas asignaciones.
- Los pagos semanales, quincenales, mensuales, trimestrales y anuales generan el siguiente vencimiento al confirmar el pago. Editar la próxima fecha mueve la ocurrencia planeada y los campos opcionales pueden limpiarse.
- Acciones rápidas para copiar referencia, abrir el enlace de pago, informar el valor real y seleccionar el bolsillo de origen.
- Noticias muestra hasta nueve publicaciones, estado por proveedor y accesos directos a BanRep, DANE y cobertura económica. Se agregaron respaldos nacionales, regionales y mundiales sin clave y `NEWS_REGION_QUERY` para personalizar la región.

## Hallazgos verificados

- El endpoint antiguo del DANE documentado como RSS responde actualmente HTTP 404.
- BanRep puede devolver una página HTML anti-bot en lugar de RSS; ahora se registra como error de fuente si no contiene artículos válidos.
- La causa de que “Pagos” no apareciera en teléfono era visual: existía únicamente en la navegación secundaria que se oculta por debajo de 960 px.
- La instalación móvil previa puede conservar el nombre instalado aunque el manifest ya indique OKLE; se incrementó la versión del `start_url` y se mantiene la instrucción de reinstalación única.

## Pruebas añadidas

- Borrado de conversación compartida y privada.
- Edición y cancelación de ingresos futuros no ejecutados.
- Creación del siguiente vencimiento mensual, incluido fin de mes.
- Continuidad de noticias nacionales, regionales y mundiales cuando una fuente oficial bloquea la ingesta.

## Verificación de esta corrección

- `CI=true pnpm install --frozen-lockfile`, `pnpm db:generate` y `pnpm verify`: correctos.
- TypeScript y Svelte: 0 errores y 0 advertencias; 21 pruebas de dominio y 33 pruebas API aprobadas.
- Builds de producción web/API y formato: correctos. AI-CFO: 7 pruebas pytest aprobadas.
- Nueve pruebas operativas aprobadas; siete validaciones Compose se omitieron porque Docker no está instalado en esta estación.
- QA móvil a 390 × 844: cambio claro/oscuro, menú Más, acceso a Pagos, formulario, enlace/referencia, editor de planes y recurrencia mensual verificados sin desbordamiento horizontal ni errores de consola.
- El diálogo nativo de confirmación impidió completar por automatización visual el clic final de cancelar una proyección; la operación quedó cubierta por prueba unitaria de servicio y comprobación estática de la interfaz. No se oculta esta limitación.

## 2026-07-22 — Navegación de pagos, bolsillos libres y correcciones móviles

### Implementado

- La cuarta posición de la navegación principal ahora abre Pagos; Patrimonio permanece disponible en Más y se eliminó el enlace duplicado de Pagos en la navegación secundaria de escritorio.
- Los bolsillos ya no preguntan ni muestran un tipo. El nombre lo decide el usuario y se añadió un campo opcional de observaciones de hasta 1.000 caracteres. Internamente se conserva `purpose=custom` para no romper compatibilidad ni datos históricos.
- Migración aditiva `202607220003_pocket_observations`: agrega `Pocket.notes` sin borrar ni transformar bolsillos existentes.
- El cliente HTTP ya no envía `Content-Type: application/json` cuando una solicitud no tiene cuerpo. Esto corrige la desactivación de fuentes de ingreso y otras operaciones `DELETE` vacías.
- El editor de destinos de un acuerdo usa tarjetas simétricas de dos columnas en escritorio y una columna en móvil, con resumen y acción de eliminación propios.
- Se reforzaron `width`, `min-width` y el cambio a una sola columna de la pantalla Más para impedir que su contenido se comprima en una fracción del ancho móvil.

### Pendiente de esta revisión

- Aplicar la nueva migración únicamente durante el siguiente despliegue controlado, después del backup.

### Verificación de esta revisión

- Se añadió una prueba del cliente HTTP que reproduce exactamente el `DELETE` sin cuerpo y confirma que ya no incluye `Content-Type`; una segunda prueba conserva JSON para comandos que sí llevan cuerpo.
- QA móvil en navegador a 390 × 844: Más, contenido principal y documento miden 390 px, sin desbordamiento horizontal. La navegación inferior muestra Inicio, Movimientos, Bolsillos, Pagos y Más.
- Se creó correctamente un bolsillo local con nombre y observación libre, sin selector de tipo.
- Se creó un ingreso esperado y después un acuerdo con dos destinos; el acuerdo se guardó y apareció en la memoria financiera con su primera versión.

## 2026-07-28 — Alta de pareja, saldos coherentes e integraciones configurables

### Hallazgos

- La instalación local solo mostraba login. Crear usuarios y unir a la pareja
  requería el script técnico de bootstrap.
- Cuando Firefly no tenía PAT, Inicio mostraba cero como si fuera un saldo
  bancario confirmado.
- El gasto de Inicio no filtraba el alcance compartido/privado y el presupuesto
  dependía del identificador demo `daily`, inexistente en bolsillos reales.
- TRM y Open Finance tenían configuración de servidor, pero no controles
  accesibles desde la PWA.

### Implementado

- Alta transaccional del primer hogar desde la PWA. La primera cuenta queda como
  owner; correo, usuario y contraseña se validan y la contraseña usa el mismo
  scrypt seguro del login.
- Invitación de pareja aleatoria, válida 24 horas, de un solo uso y limitada a
  dos miembros. Solo se guarda el hash del token. Crear otra invalida la
  anterior.
- Inicio separa saldo real Firefly y reservas Pocket Engine por alcance, moneda
  y disponibilidad de la conexión. Sin Firefly muestra `—`, no un cero
  ficticio.
- Gasto del mes filtrado por alcance/moneda y presupuesto basado en un bolsillo
  periódico real. Si no existe, la interfaz muestra `Sin configurar`.
- Panel **Más → TRM y automatización bancaria**. El owner puede activar la
  sincronización diaria y actualizar ahora. La SFC sigue siendo fuente primaria
  y Datos Abiertos el fallback.
- Open Finance muestra honestamente registro manual o sandbox firmado. Un
  proveedor bancario real continúa pendiente y no se simula como conectado.
- Migración aditiva
  `202607280001_household_invites_integrations` y manual de usuario actualizado.

### Verificación

- `CI=true pnpm db:generate && CI=true pnpm verify`: correcto. Svelte/TypeScript
  sin errores ni advertencias; 57 pruebas API, 24 de dominio, 2 web y 18
  operativas aprobadas; builds y formato correctos.
- `python3 -m pytest services/ai-cfo/tests -q`: 7 aprobadas.
- Docker: imágenes API/PWA reconstruidas, migración aplicada y siete servicios
  saludables.
- QA real en `http://127.0.0.1:3100`: alta inicial, creación/copia de invitación,
  unión de la pareja, rechazo al segundo uso, login del owner, dos miembros
  visibles, TRM actualizada desde SFC y guardado de sincronización diaria.
- El hogar y las cuentas ficticias creadas para QA se eliminaron al terminar;
  la instalación volvió a quedar vacía para el alta real.
