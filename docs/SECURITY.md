# Seguridad y operación

## Antes de usar datos reales

- Cambiar todas las credenciales incluidas como valores locales.
- Configurar MFA en Keycloak para ambos miembros.
- Mantener `DEV_AUTH_ENABLED=false` en cualquier servidor accesible por red.
- Restringir los redirect URI de Keycloak al dominio exacto.
- Almacenar PAT de Firefly y claves LLM cifradas; nunca enviarlas al navegador o n8n.
- Habilitar firewall y exponer únicamente 80/443 mediante Caddy.
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

## Modelo de amenaza resumido

| Riesgo                             | Control actual                                                  |
| ---------------------------------- | --------------------------------------------------------------- |
| Enumeración de bolsillo privado    | Respuesta 404 y filtros por propietario                         |
| Duplicación por reintento          | Claves únicas y `external_id` Firefly                           |
| Fuga por IA                        | Snapshot por alcance, evidencia permitida y validador de salida |
| Prompt injection en noticias/notas | Los textos se tratan como datos no confiables                   |
| Robo de PAT Firefly                | Tokens solo servidor; variables secretas                        |
| Recordatorios reveladores          | Mensaje genérico y canal solicitado por API                     |

Antes de una oferta SaaS se requieren pentest, RLS forzado, rotación automatizada de secretos, auditoría de accesos, análisis de dependencias, plan de incidentes y cumplimiento formal de la Ley 1581.
