# Seguridad y operación

## Antes de usar datos reales

- Cambiar todas las credenciales incluidas como valores locales.
- Crear ambos usuarios locales mediante el script interactivo; Keycloak/MFA solo aplica al modo opcional.
- Mantener `DEV_AUTH_ENABLED=false` en cualquier servidor accesible por red.
- Si se habilita Keycloak, restringir sus redirect URI al dominio exacto.
- Almacenar PAT de Firefly y claves LLM cifradas; nunca enviarlas al navegador o n8n.
- En modo privado, no abrir 80/443 y publicar solo el gateway en loopback mediante Tailscale Serve. En modo público opcional, exponer únicamente 80/443 mediante Caddy.
- Crear copias cifradas y ejecutar una restauración de prueba.
- Revisar las políticas de retención del proveedor LLM elegido.

## Invariantes

- Un bolsillo privado solo puede ser consultado por su propietario.
- Un análisis del hogar no recibe transacciones privadas.
- Los mensajes push no contienen nombres de bolsillos privados.
- n8n solo llama endpoints de automatización mediante un token dedicado.
- Toda operación monetaria utiliza idempotencia.
- El LLM nunca escribe en Firefly ni ejecuta inversiones.
- Fuentes, ingresos esperados, planes y revisiones respetan `household/private`; un plan compartido no puede enlazar objetos privados.

Los snapshots de revisión se autorizan siempre a través del plan padre. Nunca se incorporan a un análisis compartido cuando el plan es privado.

## Autenticación local privada

- scrypt de Node (`N=65536`, `r=8`, `p=1`, salt aleatorio de 32 bytes) evita contraseñas reversibles y dependencias nativas adicionales.
- La cookie `finanzas_session` es `HttpOnly`, `Secure`, `SameSite=Strict` y `Path=/`. Strict es compatible porque PWA y API comparten origen y reduce envíos cross-site.
- El valor de cookie es aleatorio; Redis guarda la sesión con TTL (12 horas por defecto). Cerrar sesión la elimina y cambiar/restablecer contraseña incrementa su versión y revoca todas las sesiones del miembro.
- Las mutaciones requieren el token CSRF retornado por `/v1/auth/me`; permanece únicamente en memoria de la PWA. Contraseñas y cookie no se guardan en `localStorage` ni `sessionStorage`.
- Los intentos se limitan por hash de identificador e IP; los errores de usuario ausente, deshabilitado o contraseña incorrecta son deliberadamente genéricos.
- Tailscale cifra el transporte, limita quién alcanza el gateway y termina HTTPS. No corrige contraseñas débiles, equipos comprometidos, permisos Docker, backups sin cifrar ni un administrador con acceso directo a PostgreSQL.

## Modelo de amenaza resumido

| Riesgo                             | Control actual                                                     |
| ---------------------------------- | ------------------------------------------------------------------ |
| Enumeración de bolsillo privado    | Respuesta 404 y filtros por propietario                            |
| Duplicación por reintento          | Claves únicas y `external_id` Firefly                              |
| Fuga por IA                        | Snapshot por alcance, evidencia permitida y validador de salida    |
| Clave de IA expuesta               | Solo `.env`/secreto servidor; UI recibe un booleano de presencia   |
| Prompt injection en noticias/notas | Los textos se tratan como datos no confiables                      |
| Robo de PAT Firefly                | Tokens solo servidor; variables secretas                           |
| Recordatorios reveladores          | Web Push genérico, sin montos, comercios ni nombres de bolsillos   |
| Puertos internos expuestos         | Compose privado solo enlaza gateway a 127.0.0.1                    |
| Secretos conocidos                 | Interpolación obligatoria, init criptográfico y preflight          |
| Fuerza bruta de login local        | Límite Redis por identificador/IP y mensaje genérico               |
| CSRF con cookie local              | SameSite Strict y token CSRF para toda mutación                    |
| Escritura Firefly parcial          | Atribución previa `pending`, error sanitizado y reintento trazable |

Los servicios usan dos redes: `edge` para gateway/web/API y `backend` para datos y servicios internos. Keycloak se incorpora a ambas solo en su modo. PostgreSQL y Redis no publican puertos. Los logs Docker rotan a tres archivos de 10 MB.

Antes de una oferta SaaS se requieren pentest, RLS forzado, rotación automatizada de secretos, auditoría de accesos, análisis de dependencias, plan de incidentes y cumplimiento formal de la Ley 1581.
