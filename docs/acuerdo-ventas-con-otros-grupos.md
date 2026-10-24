# Ventas (grupo de Zaidy): qué esperamos de ustedes y qué reciben de nosotros

Somos el único servicio que **cobra, reparte y lleva la contabilidad**. Esta hoja resume en una página lo que necesitamos de cada grupo y lo que ustedes reciben de nosotros. Todo sale del contrato 1.0 del kit (`contrato/REGLAS.md` y `docs/contrato.md`); si algo no coincide, **manda el kit**. El diagrama completo está en [diagrama-secuencia-ventas.md](diagrama-secuencia-ventas.md).

## Para todos

- **Credenciales:** cada cliente tiene su `client_id` y secreto; pedimos token en `POST /oauth/token` (`client_credentials`, 3600 s) y lo usamos con sus alcances. Los secretos nos los pasan por un canal privado, no por el chat.
- **`traza_id`** en cada llamada, para reconstruir la historia de la orden con `GET /bitacora`.
- **`clave_idempotencia`** en lo que crea algo. Misma clave y mismos datos: misma respuesta. Misma clave y otros datos: `IDEMPOTENCIA_CONFLICTO`.
- **Errores** del contrato: `{ error: { codigo, mensaje, reintentable } }` con `isError: true`.
- **Dinero en pesos enteros.** El IVA se calcula por línea y se redondea al peso.

## Taller (Falla)

**Esperamos que ustedes:**
1. Llamen `crear_venta` con `orden_id`, `pagador` (`tipo`, `documento`, `nombre`, `retenedor`, `autorizacion`), `lineas`, `clave_idempotencia`, `traza_id` y `url_notificacion`.
2. Manden en cada línea de repuesto el `reserva_id`, el SKU en `referencia`, y el **precio e IVA tal como quedaron en la reserva**. Si no coinciden: `PRECIO_NO_COINCIDE`.
3. Facturen **solo servicios** (sin reserva) con beneficiario `taller`. Los repuestos los factura su proveedor.
4. Dejen su dirección en `NOTIFICACIONES_PERMITIDAS` (por ejemplo `http://taller:4101`); si no, rechazamos la venta.
5. Publiquen `POST /eventos` y **verifiquen la firma `X-Firma`**.
6. Si un pago se rechaza, llamen `generar_cobro` para obtener un cobro nuevo.
7. Con garantía: la venta del concesionario lleva `pagador.tipo = concesionario`, `pagador.autorizacion = GAR-…` y los repuestos con concepto `garantia` y precio 0.

**Ustedes reciben de nosotros:**
- La venta en `pendiente_pago` con `url_pago` para el cliente.
- `consultar_venta`, `consultar_liquidacion`, `generar_cobro` y `anular_venta` (solo si no está pagada).
- Eventos firmados, **en este orden por venta**: `venta.pagada` y luego `venta.liquidada`; o `venta.pago_rechazado`; o `venta.reembolsada` (compensación: deben cotizar de nuevo).

## Tienda (José) y Concesionario (Emerson)

Las dos publican las mismas herramientas de proveedor.

**Esperamos que ustedes:**
1. `consultar_reserva` (alcance `proveedor.confirmar`): devuelvan `estado`, los `items` con `sku`, `cantidad`, `precio_unitario` e `iva_porcentaje`, y la `venta_id` si ya está confirmada. Con una `traza_id` distinta a la de la reserva: `NO_ENCONTRADO`.
2. `confirmar_reserva`: la acepten **solo de Ventas**, de forma idempotente (repetida con la misma venta no cambia nada), y devuelvan la guía de despacho. Reserva vencida: `RESERVA_VENCIDA`; otro estado: `ESTADO_INVALIDO`.
3. `liberar_reserva`: devuelvan las unidades al inventario. Una reserva confirmada **solo la libera Ventas**.
4. Publiquen `POST /sandbox/vencer/:reserva_id` y `POST /sandbox/reabastecer` (solo con `SANDBOX=1` y `X-Sandbox-Llave`).
5. **Concesionario:** es el único que entrega repuestos en **garantía**, con precio 0 y número de autorización `GAR-…`.

**Ustedes reciben de nosotros:**
- Llamadas con el token del cliente `ventas`, siempre con `traza_id`.
- `confirmar_reserva` solo después de que el pago esté **aprobado y verificado**, nunca antes.
- `liberar_reserva` de las reservas de la venta si hay que compensar.

## Qué NO hacemos

- No cobramos antes de verificar cada línea contra la reserva real.
- No dispersamos dinero si algo no cuadra: la venta queda `en_revision` hasta que una persona la revise.
- Ningún agente de IA nuestro crea, cambia ni anula ventas: lo decide el código.

## Pendiente entre los cuatro

- Que los secretos de los clientes (`taller` → ventas, `ventas` → proveedores, `auditor`) se intercambien por un canal privado.
- Acordar las direcciones reales de cada servicio para la integración (no `localhost`).

Contacto técnico de Ventas: Zaidy.
