# Ventas (grupo de Zaidy): qué esperamos de ustedes y qué reciben de nosotros

Somos el único servicio que **cobra, reparte y lleva la contabilidad**. Esta hoja resume en una página lo que necesitamos de cada grupo y lo que ustedes reciben de nosotros. Todo sale del Instructivo 5 y del contrato 1.0; si algo del kit dice otra cosa, **manda el kit**. El diagrama completo está en [diagrama-secuencia-ventas.md](diagrama-secuencia-ventas.md).

## Para todos

- **Credenciales:** cada cliente tiene su `client_id` y secreto; pedimos token en `POST /oauth/token` y lo usamos con sus alcances. Los secretos nos los pasan por un canal privado, no por el chat.
- **`traza_id`** en cada llamada, para reconstruir la historia de la orden en la bitácora.
- **`clave_idempotencia`** en lo que crea algo. Misma clave y mismos datos: misma respuesta. Misma clave y otros datos: `IDEMPOTENCIA_CONFLICTO`.
- **Errores** con los códigos del contrato (`{ error: { codigo, mensaje, reintentable } }`), nunca texto libre.
- **Dinero en pesos enteros.** Nada de decimales.

## Taller (Falla)

**Esperamos que ustedes:**
1. Llamen `crear_venta` con las líneas (cada una ligada a su reserva), el pagador o pagadores, la `clave_idempotencia`, la `traza_id` y la `url_notificacion`.
2. Tomen **precio e IVA de la reserva**, no de la oferta. Si no coinciden, respondemos `PRECIO_NO_COINCIDE`.
3. Dejen su dirección en nuestra lista de destinos permitidos (por ejemplo `http://taller:4101`). Si no, rechazamos la venta.
4. Publiquen `POST /eventos` y **verifiquen la firma HMAC** de lo que les enviamos.
5. Si un pago se rechaza, llamen `generar_cobro` para obtener un cobro nuevo.

**Ustedes reciben de nosotros:**
- La venta creada con el **enlace de pago** para el cliente.
- `consultar_venta`, `consultar_liquidacion` y `anular_venta`.
- El evento firmado **`venta.liquidada`** cuando el dinero queda repartido: ahí la orden pasa a reparación.
- Un evento firmado si hay **compensación** (reserva vencida y reembolso): ahí deben cotizar de nuevo.

## Tienda (José) y Concesionario (Emerson)

Las dos publican las mismas herramientas de proveedor.

**Esperamos que ustedes:**
1. `consultar_reserva`: devuelvan el **precio congelado, la cantidad, el vencimiento y la orden** a la que pertenece. Con eso verificamos cada línea antes de cobrar.
2. `confirmar_reserva`: la acepten **solo de Ventas** (alcance `proveedor.confirmar`), de forma idempotente, y programen el despacho.
3. `liberar_reserva`: devuelvan las unidades al inventario. Ventas puede liberar incluso una reserva ya confirmada.
4. Respondan con un **error claro cuando la reserva venció**, para que podamos compensar.
5. Publiquen las rutas de laboratorio `/sandbox/vencer/:reserva_id` y `/sandbox/reabastecer` (solo con `SANDBOX=1`).
6. **Concesionario:** es el único que entrega repuestos en **garantía**, con precio 0, reserva y número de autorización.

**Ustedes reciben de nosotros:**
- Llamadas con token y alcance de Ventas, siempre con `traza_id`.
- `confirmar_reserva` solo después de que el pago esté **aprobado y verificado**, nunca antes.
- `liberar_reserva` de las demás reservas si la venta se compensa.

## Qué NO hacemos

- No cobramos antes de verificar las reservas contra ustedes.
- No dispersamos dinero si algo no cuadra: la venta queda `en_revision` hasta que una persona la revise.
- Ningún agente de IA nuestro crea, cambia ni anula ventas: lo decide el código.

## Por confirmar entre los cuatro (se resuelve con el kit)

- Nombre exacto del evento de compensación y los campos de cada evento.
- Código exacto del error cuando una reserva venció.
- Forma exacta de la `url_notificacion` y de los pagadores (cliente y concesionario en garantía).

Contacto técnico de Ventas: Zaidy.
