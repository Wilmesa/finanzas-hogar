# Migración y portabilidad

La aplicación soporta rutas de instalación configurables y dos topologías explícitas:

- `private`: gateway HTTP enlazado a loopback, TLS externo mediante Tailscale Serve u otro proxy privado.
- `public`: Caddy termina TLS y publica 80/443 solamente cuando se solicita.

Para el servidor doméstico actual siga [DEPLOY_PRIVATE_TAILSCALE.md](DEPLOY_PRIVATE_TAILSCALE.md). Esta guía resume los invariantes comunes.

## Migración 202607280002: flujo de caja real y calendario

La migración `202607280002_real_cashflow_calendar_corrections` es aditiva. Crea
perfiles de cuenta, lotes trazables de financiación de bolsillos y
notificaciones; agrega cuenta de origen/destino, naturaleza personal/familiar,
responsable de pago, emoji y color.

Antes de aplicarla:

1. Detenga escrituras y cree un backup cifrado de PostgreSQL y Firefly.
2. Conserve una copia del `.env` únicamente en el servidor; no la suba a Git.
3. Genere Prisma Client en la imagen nueva y ejecute las migraciones de
   producción habituales.
4. Inicie API, worker y web; compruebe `/health`, Cuentas, Bolsillos y
   Calendario.

Los saldos de bolsillo que existían antes de esta versión se migran como
`legacy_unreconciled`: permanecen intactos, pero no se descuentan de una cuenta
arbitraria. El usuario debe liberarlos o conciliarlos con un motivo. Los pagos
existentes reciben como responsable a su creador. No se borran movimientos,
planes, bolsillos ni migraciones anteriores.

En caso de rollback, restaure conjuntamente la imagen y el backup completos
anteriores. No revierta parcialmente las tablas después de recibir operaciones
con la versión nueva.

## Migración 202607270001: interconexiones financieras

Antes de actualizar:

1. Cree un backup cifrado.
2. Ejecute `node scripts/init-env.mjs`. El script generará
   `secrets/private-metadata-keyring.json` sin mostrar sus llaves.
3. Conserve el llavero en todos los backups; perder una llave todavía usada
   impide abrir los metadatos cifrados con ella. El backup formato 3 lo incluye.
4. Ejecute las migraciones Prisma antes de iniciar la API.

La migración es aditiva. Incorpora revisión, reglas, importaciones
normalizadas, ejecuciones de planes, simulaciones, deudas, tasas y detalle de
snapshots. No elimina ni reescribe movimientos existentes.

La sincronización diaria de TRM es opcional:

```dotenv
TRM_SYNC_ENABLED=true
TRM_PRIMARY_URL=https://www.superfinanciera.gov.co/SuperfinancieraWebServiceTRM/TCRMServicesWebService/TCRMServicesWebService
TRM_FALLBACK_URL=https://www.datos.gov.co/resource/32sa-8pi3.json
```

OKLE consulta primero el Web Service SOAP oficial de la Superintendencia
Financiera y utiliza Datos Abiertos solamente si la fuente primaria falla. En
ambos casos persiste fuente, URL, fecha efectiva y fecha de consulta. Si la
sincronización está desactivada, ejecuta el mismo orden bajo demanda cuando un
snapshot requiere convertir USD a COP.

## Migración 202607280001: alta, invitaciones e integraciones

`202607280001_household_invites_integrations` es aditiva. Crea invitaciones de
pareja de un solo uso y preferencias de TRM/Open Finance por hogar. No elimina
usuarios, movimientos, bolsillos ni datos Firefly.

En una instalación vacía, la primera persona abre la PWA y crea el hogar. En
una instalación que ya tiene usuarios, el alta inicial permanece cerrada y el
login histórico sigue funcionando. No ejecute nuevamente el bootstrap salvo
recuperación administrativa deliberada.

## Preparar un destino

```bash
git clone https://github.com/Wilmesa/finanzas-hogar.git /ruta/elegida/app
cd /ruta/elegida/app
node scripts/init-env.mjs
chmod 600 .env
```

La ruta no forma parte de la configuración interna. Use un `COMPOSE_PROJECT_NAME` diferente por entorno para aislar redes, contenedores y volúmenes.

## Configurar el origen

Defina `APP_ORIGIN` como URL HTTPS completa sin ruta. Puede incluir puerto:

```dotenv
APP_ORIGIN=https://finanzas.example.internal:8446
```

En modo local no hay realm. En modo Keycloak genere su configuración runtime sin modificar archivos versionados:

```bash
AUTH_MODE=keycloak node scripts/configure-domain.mjs
git status --porcelain
```

El estado Git debe permanecer vacío.

## Desplegar

Privado:

```bash
DEPLOY_TARGET=private scripts/deploy.sh
```

Público tradicional, solo en un host con DNS, firewall y 80/443 aprobados:

```bash
DEPLOY_TARGET=public AUTH_MODE=keycloak PUBLIC_AUTH_MODE=keycloak scripts/deploy.sh
```

Los comandos usan `scripts/compose.sh`, que combina el archivo central con el override correcto. No ejecute `docker compose up` sin seleccionar la topología documentada.

## Trasladar datos

- **Servidor completo:** use `scripts/backup.sh`; contiene dumps PostgreSQL, volúmenes necesarios, metadata de Git/imágenes y `env.secrets`.
- **Modo local de la PWA:** exporte JSON desde **Más** e impórtelo en el servidor. Los movimientos demo no se convierten en movimientos bancarios.
- **Secretos:** el backup formato 3 contiene `.env` y el llavero privado para
  recuperación completa, pero nunca se versionan. Cifre la copia externa.
- **Firefly:** base y upload deben pertenecer al mismo backup.
- **Entornos:** no restaure accidentalmente dev sobre prod; el script compara proyecto y commit.

## Actualizar

```bash
git status --porcelain
DEPLOY_TARGET=private scripts/update-server.sh
```

La actualización crea backup antes del pull, conserva target y `AUTH_MODE`, aplica migraciones y registra rollback en `runtime/deploy/last-update.env`. Los hashes locales están en PostgreSQL y sobreviven a reconstrucciones de imagen.

### Migración histórica 202607210002

La migración `202607210002_finnest_profiles` conserva el nombre técnico histórico anterior a OKLE y es aditiva: incorpora avatar/color, fecha de onboarding y estado de sincronización. Hace nullable el identificador Firefly únicamente para poder guardar operaciones `pending` antes de la llamada externa y amplía el índice único para contextos privados por miembro. No borra hogares, miembros, cuentas, bolsillos, movimientos ni volúmenes.

La migración `202607220003_pocket_observations` añade únicamente el campo opcional `notes` a los bolsillos. El tipo técnico histórico se conserva internamente para compatibilidad, pero OKLE ya no obliga al usuario a clasificar un bolsillo como ahorro, gasto, deuda u otra categoría.

### Migración OKLE 202607220001

La migración `202607220001_okle_crud_chat` añade categorías configurables, auditoría genérica y conversación trazable del asesor. Es aditiva y no modifica movimientos ni saldos existentes. Antes de actualizar, ejecute el backup documentado; después aplique `pnpm --filter @finanzas/api prisma:migrate:deploy` o el flujo de despliegue habitual.

Antes de actualizar:

```bash
scripts/backup.sh
git status --porcelain
DEPLOY_TARGET=private scripts/update-server.sh
```

### Migración funcional 202607220002

`202607220002_payments_investments_assets` es aditiva y crea pagos/vencimientos, posiciones de inversión, inmuebles y cortes históricos de patrimonio. También amplía los destinos de un plan para aceptar exactamente un bolsillo o un pago y registra la cantidad ejecutada de forma parcial. No elimina migraciones ni movimientos Firefly.

Después de desplegarla, valide en este orden:

1. Crear y editar un pago compartido; comprobar que aparece su vencimiento.
2. Marcar un pago como realizado indicando valor real y bolsillo, sin confundirlo con el movimiento Firefly aún no conciliado.
3. Marcar un ingreso esperado como recibido y ejecutar una asignación parcial; comprobar que solo lo ejecutado aumenta la reserva virtual.
4. Registrar un CDT y un inmueble con fuente/fecha de valoración y guardar un corte patrimonial.
5. Abrir Asesor OKLE y confirmar que el contexto declara anonimización y no contiene nombres ni cuentas.

Si la PWA instalada conserva el nombre FinNest, elimine una sola vez el acceso antiguo y reinstale OKLE. El nuevo manifiesto usa `id=/okle`, iconos derivados de `okle-master.png` y limpia cachés históricas; los sistemas móviles no renombran siempre una instalación ya existente.

Después valide login de ambos miembros, nombres reales, libros Firefly, cuenta compartida, bolsillo periódico, gasto, Asesor OKLE y Web Push. No ejecute `docker compose down -v`, no cambie `COMPOSE_PROJECT_NAME` y no renombre volúmenes.

### Rollback

El rollback de código usa el commit registrado en `runtime/deploy/last-update.env`. Como la migración es compatible hacia atrás y solo añade columnas/relaja una columna, se recomienda volver primero a la imagen anterior y conservar las columnas. Restaurar PostgreSQL solo es necesario si una prueba controlada demuestra corrupción; en ese caso use el backup previo en un entorno aislado y siga el procedimiento de restauración completo.

## Restaurar

La restauración es destructiva y exige confirmación:

```bash
RESTORE_CONFIRM=SI_RESTAURAR scripts/restore.sh /ruta/al/backup
```

Use primero un entorno aislado. No habilite escrituras hasta verificar balances Firefly, privacidad, autenticación y checksums.

## Compatibilidad

Firefly sigue siendo el libro contable y PostgreSQL la fuente de bolsillos/planes y usuarios locales. La migración no cambia privacidad ni cálculos. La sesión Redis puede expirar durante una restauración; basta iniciar sesión de nuevo. Keycloak permanece en su override. n8n está aislado en `docker-compose.n8n.yml`: mantenga `ENABLE_BUNDLED_N8N=false` al migrar salvo que desee restaurar explícitamente ese servicio y sus secretos.
