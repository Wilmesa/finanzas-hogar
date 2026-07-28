# Interconexiones financieras de OKLE

Estado documentado: 28 de julio de 2026.

## Estados de dinero

| Estado     | Fuente de verdad                                     | Puede modificar Firefly                       |
| ---------- | ---------------------------------------------------- | --------------------------------------------- |
| Real       | Firefly III                                          | Sí, únicamente mediante `TransactionsService` |
| Reservado  | `Pocket` + eventos inmutables `PocketEvent`          | No                                            |
| Planeado   | planes, revisiones, ingresos esperados y ejecuciones | No, salvo el ingreso o pago real confirmado   |
| Proyectado | `FinancialSimulation`                                | No                                            |

Los bolsillos no se sincronizan con Piggy Banks. Un gasto real se etiqueta en
Firefly con `okle-pocket:<uuid>` y se atribuye en PostgreSQL. Una transferencia
entre bolsillos solo crea un evento `released` y otro `allocated`.

## Flujo manual principal

```text
PWA → POST /v1/transactions + Idempotency-Key
    → valida hogar, pagador, bolsillo y cuenta
    → crea atribución pending
    → crea doble entrada en Firefly
    → registra PocketEvent spent/allocated
    → marca atribución synchronized
```

Los movimientos manuales nacen como `REVIEWED`. OKLE no depende de Open
Finance para operar.

## Flujo importado y Needs Review

```text
Proveedor normalizado o MockOpenFinanceAdapter firmado
→ POST /v1/ingestion/transactions
  o POST /v1/ingestion/mock-sandbox
→ coincidencia exacta o difusa
→ TransactionRule por prioridad
→ Firefly, si no existía el movimiento
→ Attribution PENDING o REVIEWED por regla
→ /review
```

La coincidencia difusa exige mismo monto y moneda, fecha dentro de ±3 días y
similitud de comercio de al menos 0,72. Solo intenta fusionar registros
importados o pendientes; no fusiona gastos manuales conciliados.

Cambiar el bolsillo durante la revisión revierte el impacto virtual anterior y
crea el impacto equivalente en el nuevo bolsillo dentro de una sola transacción
Prisma. Esta corrección no crea otra transacción en Firefly.

`IOpenFinanceProvider` es el contrato de adaptadores. La versión actual incluye
`MockOpenFinanceAdapter`, desactivado por defecto, con lotes
`pending → posted` firmados mediante HMAC-SHA256. `scripts/mock-open-finance.mjs`
genera ambas fases usando el mismo comercio, monto y fecha, pero permite que el
banco cambie el identificador externo. La ingesta actualiza el registro
importado y reutiliza la atribución/operación Firefly, por lo que un cambio de
estado no duplica el gasto. Belvo u Ozone se incorporan detrás del mismo
contrato cuando existan credenciales, contrato y esquema de firma del proveedor.

## Privacidad

- El navegador nunca recibe tokens de Firefly.
- Un movimiento privado se registra en Firefly como `Consumo Personal`.
- Comercio y categoría reales se cifran con AES-256-GCM.
- Un llavero versionado fuera de `.env` contiene llaves aleatorias de 32 bytes.
- Cada sobre `v2` declara su `keyId` y lo autentica mediante AAD de AES-GCM.
- La rotación recifra solo los registros privados del miembro autenticado y
  queda auditada; los sobres `v1` pueden migrarse con la llave heredada.
- El propietario recupera el detalle a través del proxy de OKLE.
- El cónyuge no puede consultar el registro privado por ID, analytics o
  bandeja de revisión.

La privacidad protege dentro de la aplicación. El administrador físico con
acceso a memoria, contenedores y secretos conserva capacidad técnica de acceso.

## Planes e ingresos extraordinarios

```text
ExpectedIncome received y conciliado
→ POST /v1/planning/plans/:id/execute
→ usa la versión vigente
→ calcula distribución determinística
→ crea eventos allocated
→ crea PlanExecution con resultado e idempotencia
```

La ingesta detecta como candidato extraordinario un depósito superior al 50 %
del salario habitual configurado y devuelve planes de prima compatibles. La
ejecución nunca es automática: requiere confirmación.

## Simulaciones accionables

`POST /v1/simulations` recalcula y persiste supuestos y resultado:

- Ahorro, CDT, inversión o inmueble pueden convertirse en bolsillo.
- Una simulación de deuda puede convertirse en `PaymentPlan` y `DebtAccount`.
- Un pago real registra Firefly, PocketEvent, PaymentOccurrence y recalcula la
  amortización.

Una conversión se ejecuta una sola vez. Archivar conserva el historial.

## PWA offline

La autenticación local permite captura offline:

1. La PWA genera un UUID.
2. Guarda comando, CSRF e UUID en IndexedDB.
3. Background Sync reenvía siempre el mismo `Idempotency-Key`.
4. La API devuelve la atribución existente en los reintentos.
5. Solo una llamada genera la transacción Firefly.

Las respuestas financieras nunca se guardan en Cache Storage. En OIDC no se
persiste el access token; por eso la cola automática se limita a autenticación
local.

## Patrimonio y TRM

Los snapshots son de solo inserción. Un segundo snapshot para la misma fecha,
hogar y moneda devuelve conflicto. Con componentes multimoneda:

1. Se resuelve cada tasa para la fecha.
2. USD/COP consulta primero `queryTCRM` en el Web Service SOAP oficial de la
   Superintendencia Financiera.
3. Solo ante caída o respuesta inválida utiliza el conjunto `32sa-8pi3` de
   Datos Abiertos como respaldo.
4. Se convierte determinísticamente.
5. Se guardan componentes, tasas, fuente, URL y fecha efectiva usadas.

No se suman criptomonedas ni otras divisas si no existe una tasa trazable.

## Degradación

- Sin LLM: contabilidad, pagos, planes, bolsillos y simulaciones continúan.
- Sin Open Finance: el usuario registra todo manualmente.
- Sin TRM: se rechaza una conversión sin tasa; nunca se inventa.
- Sin Firefly: la atribución queda fallida para reconciliación.
- Sin Web Push: las fechas siguen visibles en Pagos.

## Matriz implementada

| Origen                        | Destino                          | Estado                        |
| ----------------------------- | -------------------------------- | ----------------------------- |
| Movimiento manual             | Firefly / bolsillo               | Completa                      |
| Transferencia virtual         | eventos de bolsillo              | Completa                      |
| Importación normalizada       | reglas / revisión / Firefly      | Completa                      |
| Mock Open Finance firmado     | pending→posted / idempotencia    | Completa para sandbox local   |
| Adaptador Belvo/Ozone firmado | ingesta normalizada              | Pendiente de credenciales     |
| Plan                          | bolsillos / ejecución versionada | Completa                      |
| Proyección                    | bolsillo                         | Completa                      |
| Proyección de deuda           | pago / deuda                     | Completa                      |
| Pago confirmado               | Firefly / bolsillo / deuda       | Completa                      |
| Activos multimoneda           | snapshot con TRM                 | Completa para USD/COP         |
| Otras divisas/cripto          | snapshot                         | Requiere proveedor de tasa    |
| PWA local offline             | API idempotente                  | Completa                      |
| Open Finance                  | aviso Web Push de prima          | Parcial: candidato disponible |
