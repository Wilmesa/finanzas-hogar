# Guía de uso de OKLE

## Primer ingreso

1. Inicie sesión con el usuario local entregado por el owner.
2. Abra **Configuración → Revisar configuración**.
3. Confirme los nombres en **Hogar y perfiles**.
4. Cree al menos una cuenta compartida en **Cuentas**. La cuenta se crea en Firefly y su saldo siempre procede de ese libro.
5. Cree un bolsillo. El alcance predeterminado es **Compartido**; seleccione **Solo yo** para propósitos privados.
6. Registre una fuente de ingreso y, si aplica, deje por escrito el acuerdo de distribución.

## Registrar un gasto

Use **+ Registrar**, seleccione bolsillo, cuenta compatible, descripción, categoría y pagador real. OKLE crea primero una operación pendiente, la envía al libro Firefly correcto y muestra su estado de sincronización. No repita el envío durante un estado de carga.

Si no hay cuentas, use el enlace **Crear cuenta**. Si el libro privado no está configurado, las cuentas compartidas continúan disponibles.

## Bolsillos

- **Meta por fecha:** indique cantidad y fecha; OKLE calcula el aporte periódico.
- **Meta por aporte:** indique cantidad y capacidad; OKLE calcula cuándo se alcanza.
- **Límite periódico:** define disponibilidad de vida diaria semanal, mensual o anual.
- **Compartido:** ambos miembros lo ven y pueden usarlo.
- **Solo yo:** únicamente el propietario ve finalidad y movimientos.

Los aportes a bolsillos son reservas virtuales y no crean transferencias bancarias. Pausar conserva el saldo; archivar lo oculta sin borrar el historial.

## Copiloto

Copiloto muestra proveedor, modelo y estado. Al generar, usa solo datos autorizados del alcance seleccionado. Cada análisis conserva período, fecha y evidencias. Si faltan movimientos, responde que los datos son insuficientes; nunca muestra un insight de demostración en modo servidor.

## Tema, PWA y recordatorios

En **Configuración** elija claro, oscuro o sistema. Instale OKLE desde el navegador y active Web Push. Cada miembro puede definir varias horas diarias; las notificaciones son genéricas y un check-in detiene los recordatorios restantes del día.

## Asesor OKLE

La vista **Más → Asesor IA** separa conversación y análisis. Antes de preguntar, elija **Compartido** o **Solo yo**: el servidor construye un contexto mínimo del alcance elegido y nunca mezcla bolsillos privados con la conversación del hogar. El historial queda trazado por alcance. Las respuestas son educativas y no reemplazan asesoría profesional.

El propietario puede usar OpenAI, Gemini o cualquier endpoint compatible con OpenAI Chat Completions (NVIDIA NIM, Groq, OpenRouter, Together, LiteLLM y equivalentes) mediante las variables documentadas en `.env.example`; las claves permanecen en el servidor.

## Privacidad y respaldo

Un administrador físico del servidor puede acceder a las bases y backups. Mantenga el host y las copias cifrados. Exporte JSON para portabilidad del producto y use los scripts de backup para una restauración completa de PostgreSQL, Redis y Firefly.
