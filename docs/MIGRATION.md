# Migración al servidor personal

Esta guía traslada la beta local al servidor sin mezclar datos demostrativos con movimientos Firefly reales.

## 1. Preparar el servidor

Use Ubuntu Server o Debian estable, SSH por clave y firewall. Instale Docker Engine desde su repositorio oficial y el plugin Compose. Abra solo 80/443 públicamente; limite SSH por IP cuando sea posible.

```bash
sudo mkdir -p /opt/nuestro-dinero
sudo chown "$USER":"$USER" /opt/nuestro-dinero
git clone <URL-DEL-REPOSITORIO> /opt/nuestro-dinero
cd /opt/nuestro-dinero
node scripts/init-env.mjs
```

Edite `.env` y configure dominio, nombres, correos y proveedores. Los secretos ya serán aleatorios.

## 2. Dominio y Keycloak

Apunte el registro DNS A/AAAA al servidor. Después:

```bash
node scripts/configure-domain.mjs
node scripts/preflight.mjs
```

Tras el primer arranque, ingrese a la consola Keycloak, cree dos usuarios, active acciones obligatorias `VERIFY_EMAIL` y `CONFIGURE_TOTP`, y copie el ID interno de cada usuario.

En cada usuario configure:

```text
household_id = valor de HOUSEHOLD_ID
household_role = owner | member
```

Copie sus IDs a `MEMBER_A_ID` y `MEMBER_B_ID`, vuelva a ejecutar el seed y obligue a ambos a cerrar/iniciar sesión para obtener tokens nuevos.

## 3. Firefly

Abra Firefly solo temporalmente mediante un túnel SSH o puerto local; no lo publique en Caddy. Cree:

- Usuario/contexto del hogar: cuentas visibles, gastos compartidos y asignaciones personales redactadas.
- Usuario/contexto privado A.
- Usuario/contexto privado B.

Genere PAT para los tres y guárdelos en `.env`. Nunca los pegue en la PWA, n8n o el proveedor LLM.

Cree al menos una cuenta de activo en cada contexto. La PWA consulta estas cuentas y obliga a escoger una cuenta o tarjeta compatible con el alcance del bolsillo antes de registrar un movimiento.

## 4. Desplegar

```bash
scripts/deploy.sh
docker compose run --rm api pnpm --filter @finanzas/api prisma:seed
docker compose logs --tail=100 api web firefly keycloak
```

Compruebe `https://DOMINIO`, el login y los certificados TLS.

## 5. Trasladar configuración local

Desde la PWA local use **Más → Exportar y respaldar**. En el servidor use **Más → Importar datos**. Se crean bolsillos, saldos reservados, fuentes, ingresos esperados y planes conservando sus revisiones en orden. Los movimientos locales no se copian a Firefly porque no representan contabilidad bancaria conciliada.

Registre o importe los movimientos reales desde Firefly. Así se evita crear balances falsos.

## 6. n8n

Acceda mediante túnel o proxy administrativo restringido, importe `infra/n8n/daily-reminder.workflow.json`, ejecute manualmente y revise que solo reciba miembros elegibles. Active el workflow después de configurar Web Push o Telegram.

## 7. Aceptación

- Crear bolsillo compartido y verlo desde ambos usuarios.
- Crear bolsillo privado y confirmar que el otro usuario recibe 404 y no lo ve en analytics.
- Registrar gasto compartido con una cantidad pequeña y verificar doble entrada en Firefly.
- Financiar un bolsillo privado desde el hogar y verificar descripción genérica en el libro común.
- Repetir un request con la misma idempotency key y verificar que no se duplica.
- Generar un insight de hogar y confirmar ausencia de datos privados.
- Ejecutar recordatorio y check-in diario.

## 8. Backup, restauración y actualizaciones

```bash
scripts/backup.sh
RESTORE_CONFIRM=SI_RESTAURAR scripts/restore.sh /ruta/al/backup
```

Antes de actualizar imágenes:

1. Crear y sacar del servidor un backup.
2. Revisar notas de Firefly, Keycloak, n8n y PostgreSQL.
3. Probar en un clon o subdominio temporal.
4. Ejecutar `docker compose pull && docker compose up -d`.
5. Ejecutar las pruebas de aceptación.

No use etiquetas `latest`. Al estabilizar la beta, reemplace las etiquetas mayores por digests SHA-256 probados.

## 9. Actualizar desde el repositorio

No edite archivos versionados directamente en el servidor. Los secretos viven en `.env`, que Git ignora. Para aplicar una versión nueva:

```bash
cd /opt/nuestro-dinero
scripts/update-server.sh
```

El script cancela si encuentra cambios locales, crea un backup, ejecuta `git pull --ff-only`, repite el preflight y reconstruye los contenedores. Después revise los logs y repita los casos de aceptación. Si falla, conserve el backup y siga el procedimiento de rollback de la bitácora.

Para fijar una versión conocida en vez de seguir `main`, cree una etiqueta en el repositorio y ejecute en el servidor `git checkout <etiqueta>` antes de desplegar.
