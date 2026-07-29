# Manual de usuario de OKLE

## Bienvenida y concepto básico

OKLE ayuda a una pareja a registrar lo que realmente ocurrió, reservar dinero
por propósito y recordar lo que acordó para el futuro.

Hay tres conceptos que no deben mezclarse:

- **Saldo real:** dinero registrado en las cuentas de Firefly III.
- **Dinero reservado:** parte del saldo que marcaste para uno o varios
  bolsillos. Es una organización virtual de OKLE; no mueve dinero en el banco.
- **Planes y simulaciones:** decisiones o escenarios futuros. No se convierten
  en dinero real hasta que el ingreso llega o registras el movimiento.

## Paso 1: primeros pasos

### Crear el primer acceso

1. Abre OKLE. Si la instalación está vacía, verás **Crea el hogar en un solo
   paso**.
2. Escribe nombre del hogar, tu nombre, correo, usuario y una contraseña de al
   menos 12 caracteres.
3. Pulsa **Crear hogar y entrar**.

Esa primera persona queda como **Propietario**. No necesita ejecutar scripts ni
pedir a un técnico que cree su usuario.

### Unir a tu pareja

1. La persona propietaria abre su avatar o **Más → Hogar y perfiles** y pulsa
   **Crear y copiar invitación**.
2. Envía el enlace a su pareja. La pareja lo abre, define nombre, correo,
   usuario y contraseña, y pulsa **Crear cuenta y unirme**.

El enlace vence en 24 horas y solo funciona una vez. El hogar admite dos
miembros. Cada persona inicia sesión después con su propio correo o usuario.

### Preparar la contabilidad

Abre **Más → Revisar configuración**. La lista indica qué falta. Para registrar
dinero real necesitas al menos una cuenta en **Más → Cuentas y tarjetas** y el
libro Firefly correspondiente conectado por el administrador del servidor. Si
la pantalla dice **Token pendiente de configurar**, todavía no hay conexión
contable para ese alcance.

## Paso 2: entendiendo la pantalla principal

Inicio presenta el dinero sin mezclar cuentas bancarias y reservas:

- **Saldo bancario:** dinero real registrado en cada cuenta de Firefly.
- **En bolsillos:** parte de esa cuenta que OKLE reservó virtualmente para
  propósitos concretos.
- **Disponible:** saldo bancario menos las reservas trazables de esa misma
  cuenta.
- **Total visible en bolsillos — [persona]:** suma los bolsillos en moneda base
  que puedes consultar de esa persona. Tu total incluye tus bolsillos privados;
  el de tu pareja solo incluye los compartidos.

OKLE no suma COP, USD y EUR como si fueran la misma moneda. Si Firefly no está
configurado o no responde, el saldo real aparece como **—**; la aplicación no
lo reemplaza por un cero ficticio.

Si existe un bolsillo activo con **límite periódico**, el panel muestra el
porcentaje gastado durante el mes y divide su reserva restante entre los días
que quedan. Si no existe, dice **Sin configurar**.

Los movimientos recientes aparecen justo después de los totales. Pulsa
**Personalizar** para ocultar o volver a mostrar cuentas, totales, movimientos,
presupuesto diario, Asesor y próximo ingreso. Cada persona conserva su propia
selección.

## Paso 3: el día a día

### Registrar un gasto rápido

1. Pulsa **Registrar** en Inicio, o abre **Movimientos → Registrar**.
2. Escribe cantidad y comercio o descripción.
3. Elige una cuenta principal compartida, categoría y quién pagó.
4. Pulsa **Guardar gasto** o **Guardar movimiento**.

El movimiento real va al libro compartido de Firefly. Los bolsillos no se
descuentan automáticamente al registrar el gasto: primero se libera la reserva
desde el bolsillo y luego se registra el retiro real desde la cuenta. Esto
evita presentar una organización virtual como si fuera un movimiento bancario.
En **Movimientos** puedes buscar, filtrar y corregir comercio o categoría sin
reescribir el asiento contable original. El análisis del periodo muestra barras
comparables por categoría y persona y se adapta a una sola columna en móvil.

### Si no hay internet

Con autenticación local, la PWA guarda el envío pendiente en este dispositivo
y lo muestra como **Pendiente de sincronización**. Cuando vuelve la conexión,
intenta enviarlo con la misma clave para no duplicarlo. No repitas el gasto:
abre **Movimientos** al recuperar internet y confirma su estado.

Las pantallas ya visitadas pueden abrirse sin conexión, pero OKLE no guarda en
caché respuestas financieras ni de autenticación.

### Movimientos automáticos

Los movimientos importados aparecen en **Más → Bandeja de revisión**. Allí
puedes elegir categoría y bolsillo, aprobarlos o enviarlos a tu pareja para
revisión. Las reglas que crees se aplican solo a importaciones futuras.

La versión actual incluye un sandbox firmado para pruebas, pero **no tiene un
proveedor bancario real conectado**. El registro manual sigue siendo el modo
normal.

## Paso 4: planificando el futuro

### Bolsillos

En **Bolsillos → Nuevo bolsillo**:

1. Pon el nombre y, si quieres, observaciones.
2. Indica cuánto necesitas y la moneda.
3. Elige **Tengo una fecha límite**, **Tengo un aporte máximo** o **Es un límite
   periódico**.
4. Déjalo compartido —es el valor predeterminado— o activa **Solo yo**.
5. Pulsa **Calcular y crear**.

**Aportar** reserva dinero dentro de OKLE; no crea una transferencia bancaria.
También puedes mover la reserva entre bolsillos compatibles, pausar, editar o
archivar.

Usa la búsqueda para encontrar un bolsillo por nombre. En **Compartidos**
puedes filtrar los tuyos o los de tu pareja; **Solo yo** contiene únicamente
tus bolsillos privados.

Cada bolsillo pertenece a quien lo creó:

- ambos miembros pueden consultar un bolsillo compartido;
- únicamente la persona creadora puede editarlo, aportar, liberar, mover,
  vincular una cuenta, archivar o eliminar;
- **Vincular cuenta** permite asignarlo a cualquiera de las cuentas de su
  creador y conciliar reservas antiguas que todavía no tenían origen;
- si un bolsillo se creó por error, su creador puede usar **Eliminar error**,
  escribir el motivo y confirmar `ELIMINAR`. La operación elimina también el
  saldo virtual solo cuando no existen gastos, pagos, inversiones o planes
  reales relacionados. No crea ingresos ni movimientos bancarios ficticios.

### Pagos

En **Pagos → Nuevo pago** registra servicios, cuotas, arriendo, impuestos,
seguros, suscripciones u otros compromisos. Puedes guardar valor aproximado,
frecuencia, próxima fecha, enlace, referencia, notas y privacidad.

Los vencimientos próximos aparecen en la pantalla Pagos y en el distintivo de
la PWA. Al pulsar **Marcar pagado**, confirma el valor real, la cuenta Firefly y,
si aplica, el bolsillo de origen. OKLE crea un único retiro real y descuenta la
reserva elegida sin inventar transferencias.

### Ingresos y acuerdos

En **Más → Plan financiero**:

1. Crea una fuente: salario, prima, alquiler u otra.
2. Registra cuándo esperas el ingreso, cuánto, por qué llega y su probabilidad.
3. Crea un acuerdo y distribúyelo con cantidades fijas, porcentajes o remanente
   hacia bolsillos o pagos.
4. Cuando el dinero llegue, marca el ingreso recibido y ejecuta todo el plan o
   solo una parte.

Editar o revisar un acuerdo crea una nueva versión; el historial conserva qué
decidieron y por qué. Cancelar un ingreso lo retira de lo pendiente sin borrar
su trazabilidad.

### Simuladores, patrimonio y Asesor

**Más → Simuladores** calcula escenarios de meta, CDT, deuda, inversión y
vivienda sin modificar Firefly. Puedes guardar un escenario y convertirlo en
bolsillo o pago cuando corresponda.

**Más → Patrimonio** registra inversiones, CDT/CAT, fondos, acciones e
inmuebles, sus fuentes de precio y cortes históricos. Las cifras son
declaradas o calculadas; no ejecutan compras.

El **Asesor OKLE** separa el alcance Compartido de Solo yo, muestra evidencia y
no escribe en Firefly ni garantiza rentabilidades. Las noticias conservan
fuente, fecha y enlace original.

## Paso 5: configuración y privacidad

### Recordatorios

Instala OKLE como PWA. Luego abre **Más → Recordatorios en este dispositivo**:

1. Activa los avisos.
2. Agrega tantos horarios como necesites.
3. Pulsa **Guardar avisos** y permite las notificaciones.

Cada miembro configura sus propios dispositivos. En iPhone o iPad debes añadir
primero la PWA a la pantalla de inicio. El texto de la pantalla bloqueada es
genérico y no muestra cantidades, comercios ni nombres privados.

La campana abre un panel contenido dentro de la pantalla. Puedes desplazarte
dentro del panel y cerrarlo con el botón **Cerrar** sin perder la posición.

### TRM y automatización bancaria

En **Más → TRM y automatización bancaria**, la persona propietaria puede:

- activar la actualización diaria USD/COP;
- pulsar **Actualizar ahora**;
- consultar fuente y fecha de la última TRM;
- dejar Finanzas Abiertas en **Registro manual** o seleccionar el sandbox si el
  administrador lo habilitó.

La fuente primaria de TRM es la Superintendencia Financiera y Datos Abiertos es
el respaldo. Un banco real requiere todavía proveedor, consentimiento y
credenciales propias.

### Qué ve tu pareja

- **Compartido:** ambos ven el nombre, propósito, progreso y movimientos.
- **Solo yo:** únicamente quien lo creó ve el detalle.
- Si dinero común termina en un propósito privado, el hogar puede ver una
  **Asignación personal** genérica para poder conciliar el monto, pero no el
  nombre, comercio, finalidad ni progreso privados.

El administrador físico del servidor y de los backups conserva acceso técnico
a los datos. Protege el servidor, cifra las copias y usa **Más → Exportar y
respaldar** para obtener una copia portable.

La luna o el sol de la esquina superior derecha cambia el tema en cualquier
pantalla. En **Más → Apariencia** cada persona puede elegir un conjunto de
colores o definir su color principal y de acento. El color y emoji de cada
bolsillo también se editan de forma independiente por su creador.
