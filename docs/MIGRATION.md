# Migración y portabilidad

La aplicación soporta rutas de instalación configurables y dos topologías explícitas:

- `private`: gateway HTTP enlazado a loopback, TLS externo mediante Tailscale Serve u otro proxy privado.
- `public`: Caddy termina TLS y publica 80/443 solamente cuando se solicita.

Para el servidor doméstico actual siga [DEPLOY_PRIVATE_TAILSCALE.md](DEPLOY_PRIVATE_TAILSCALE.md). Esta guía resume los invariantes comunes.

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
- **Secretos:** el backup los contiene para recuperación completa, pero nunca se versionan. Cifre la copia externa.
- **Firefly:** base y upload deben pertenecer al mismo backup.
- **Entornos:** no restaure accidentalmente dev sobre prod; el script compara proyecto y commit.

## Actualizar

```bash
git status --porcelain
DEPLOY_TARGET=private scripts/update-server.sh
```

La actualización crea backup antes del pull, conserva target y `AUTH_MODE`, aplica migraciones y registra rollback en `runtime/deploy/last-update.env`. Los hashes locales están en PostgreSQL y sobreviven a reconstrucciones de imagen.

## Restaurar

La restauración es destructiva y exige confirmación:

```bash
RESTORE_CONFIRM=SI_RESTAURAR scripts/restore.sh /ruta/al/backup
```

Use primero un entorno aislado. No habilite escrituras hasta verificar balances Firefly, privacidad, autenticación y checksums.

## Compatibilidad

Firefly sigue siendo el libro contable y PostgreSQL la fuente de bolsillos/planes y usuarios locales. La migración no cambia privacidad ni cálculos. La sesión Redis puede expirar durante una restauración; basta iniciar sesión de nuevo. Keycloak y n8n permanecen opcionales.
