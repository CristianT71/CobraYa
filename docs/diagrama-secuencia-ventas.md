# Diagrama de secuencia: Ventas y contabilidad frente a los demás servicios

Servicio del grupo de Zaidy dentro de MotorRed (Instructivo N.° 5). Ventas es el **orquestador comercial**: arma la venta, cobra, confirma a los proveedores, liquida, dispersa el dinero y lleva los asientos. Es el único que mueve dinero.

Contrastado con el kit `ecosistema-motor` (contrato 1.0): `contrato/REGLAS.md`, `docs/contrato.md`, `simuladores/ventas.mjs` y `simuladores/pasarela.mjs`. Los nombres de herramientas, alcances, estados, eventos y códigos de error son los del kit.

## Quién habla con quién

| Origen | Destino | Cómo | Alcance / protección |
|---|---|---|---|
| Taller | Ventas | MCP `crear_venta`, `consultar_venta`, `generar_cobro`, `anular_venta`, `consultar_liquidacion` | Cliente `taller`, alcance `ventas.crear` |
| App del cliente | Ventas | MCP `consultar_venta`, `generar_cobro`, `consultar_liquidacion` | Cliente `app`, alcance `ventas.consultar` |
| Ventas | Tienda y Concesionario | MCP `consultar_reserva`, `confirmar_reserva`, `liberar_reserva` | Cliente `ventas`, alcance `proveedor.confirmar` |
| Ventas | Pasarela | `POST /api/cobros` y `POST /api/cobros/:id/reembolso` | Llave de API (`Authorization: Bearer`) |
| Pasarela | Ventas | Webhook `POST /webhooks/pasarela` (`cobro.aprobado`, `cobro.rechazado`, `cobro.reembolsado`) | Firma `X-Pasarela-Firma`, máximo 5 min, idempotente por `evento_id` |
| Ventas | Taller | `POST /eventos`: `venta.pagada`, `venta.liquidada`, `venta.pago_rechazado`, `venta.reembolsada` | Firma `X-Firma`; solo a `NOTIFICACIONES_PERMITIDAS` |
| Auditor | Todos | `GET /bitacora?traza_id=` | Alcance `auditoria` |

Estados de una venta: `pendiente_pago`, `pago_rechazado`, `pagada`, `liquidada`, `reembolsada`, `anulada` y `en_revision`.

## 1. Camino feliz: de la venta a la liquidación

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant T as Taller (Falla)
    participant V as VENTAS (Zaidy)
    participant P as Tienda / Concesionario
    participant G as Pasarela simulada

    Note over T,P: Antes: el taller ya diagnosticó, cotizó y reservó repuestos<br/>con precio congelado y vencimiento. El cliente aprobó la opción.

    T->>V: MCP crear_venta (orden_id, pagador, lineas, clave_idempotencia, traza_id, url_notificacion)
    Note right of V: Valida el token y el alcance ventas.crear.<br/>Misma clave y mismos datos devuelve la misma venta.<br/>Misma clave con otros datos: IDEMPOTENCIA_CONFLICTO.<br/>url_notificacion fuera de la lista permitida: DATOS_INVALIDOS.

    loop Por cada reserva de la venta
        V->>P: MCP consultar_reserva (traza_id, reserva_id)
        P-->>V: estado, items con precio, IVA y cantidad reales
        Note right of V: La reserva debe estar activa (si no, RESERVA_VENCIDA),<br/>ser de la misma traza y no pertenecer a otra venta (ESTADO_INVALIDO).<br/>SKU, precio, IVA y cantidad deben coincidir: PRECIO_NO_COINCIDE.
    end

    Note right of V: Agente de Riesgo propone nivel y motivos.<br/>Si el riesgo es alto, la venta queda en revisión humana antes de cobrar.<br/>El código calcula IVA por línea, retención y total_a_pagar en pesos enteros.

    alt total a pagar mayor que cero
        V->>G: POST /api/cobros (monto entero, referencia = venta_id, url_webhook)
        G-->>V: cobro_id y url_checkout
        V-->>T: venta en pendiente_pago con url_pago
        T-->>C: enlace de pago
        C->>G: paga (Pagar aprobar)
        G-->>V: webhook cobro.aprobado (firmado, puede llegar dos veces)
        Note right of V: Verifica la firma y que tenga menos de 5 min.<br/>Guarda el evento_id solo cuando termina bien: un duplicado se ignora.<br/>El monto del cobro debe ser igual a total_a_pagar.
    else total a pagar igual a cero (garantía completa)
        Note right of V: No hay nada que cobrar:<br/>se confirma y se liquida de una vez.
    end

    V-->>T: evento venta.pagada

    loop Por cada reserva
        V->>P: MCP confirmar_reserva (traza_id, reserva_id, venta_id)
        P-->>V: reserva confirmada con la guía de despacho
    end

    rect rgb(238, 242, 255)
    Note over V: Liquidación en una sola transacción de PostgreSQL<br/>1. Retención en la fuente si el pagador es retenedor (parámetros con vigencia)<br/>2. Comisión de la plataforma 3% más su IVA, por beneficiario<br/>3. Neto de cada beneficiario y dispersión transferida<br/>4. Asientos en partida doble: débitos igual a créditos
    end

    V-->>T: evento venta.liquidada (neto por beneficiario)
    Note over T: La orden pasa a en_reparacion.
    T-->>C: el taller puede empezar
```

Los eventos de una misma venta salen **en orden**: `venta.pagada` siempre antes que `venta.liquidada`.

## 2. Fallos y compensaciones

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant T as Taller (Falla)
    participant V as VENTAS (Zaidy)
    participant P as Tienda / Concesionario
    participant G as Pasarela simulada

    rect rgb(254, 242, 242)
    Note over C,G: A. Pago rechazado (escenario E3)
    C->>G: intenta pagar y es rechazado
    G-->>V: webhook cobro.rechazado
    Note right of V: La venta pasa a pago_rechazado.
    V-->>T: evento venta.pago_rechazado
    T->>V: MCP generar_cobro
    Note right of V: Vuelve a verificar que las reservas sigan activas.
    V->>G: POST /api/cobros (cobro nuevo)
    G-->>V: nuevo cobro_id y url_checkout
    V-->>T: venta en pendiente_pago con enlace nuevo
    C->>G: paga con éxito
    G-->>V: webhook cobro.aprobado
    Note over V: La venta se completa y se liquida una sola vez.
    end

    rect rgb(255, 247, 237)
    Note over C,G: B. Una reserva venció antes del pago: saga con compensación (escenario E4)
    G-->>V: webhook cobro.aprobado
    V-->>T: evento venta.pagada
    V->>P: MCP confirmar_reserva
    P-->>V: error RESERVA_VENCIDA
    Note right of V: Ventas no puede des-cobrar.<br/>Compensa en orden y lo deja en la bitácora (saga_compensacion).
    V->>P: MCP liberar_reserva (solo las reservas de esta venta)
    P-->>V: unidades devueltas al inventario
    V->>G: POST /api/cobros/:id/reembolso
    G-->>V: cobro reembolsado
    V-->>T: evento venta.reembolsada
    Note over T: La orden queda en requiere_nueva_cotizacion y el taller cotiza de nuevo.
    Note right of V: Si el reembolso falla, la venta queda en_revision.
    end

    rect rgb(245, 243, 255)
    Note over C,G: C. Algo no cuadra: la baranda detiene el dinero
    G-->>V: webhook con un monto distinto a total_a_pagar
    Note right of V: La saga no improvisa.<br/>La venta queda en_revision y no dispersa nada.<br/>Lo mismo si la liquidación no cuadra.<br/>Una persona revisa la bitácora con el traza_id.
    end

    rect rgb(240, 253, 244)
    Note over C,G: D. Ataques que Ventas rechaza (escenario E6)
    T->>V: crear_venta con un precio alterado
    V-->>T: PRECIO_NO_COINCIDE
    T->>V: crear_venta con una reserva que ya es de otra venta
    V-->>T: ESTADO_INVALIDO
    G-->>V: webhook con firma falsa o de hace más de 5 min
    Note right of V: Se rechaza con 401 y no cambia ningún estado.
    T->>V: consultar_venta con la traza_id de otra orden
    V-->>T: NO_ENCONTRADO
    T->>V: crear_venta con url_notificacion externa
    V-->>T: DATOS_INVALIDOS
    end
```

## 3. Dónde entran los agentes de IA de Ventas

```mermaid
sequenceDiagram
    autonumber
    participant V as Orquestador comercial (código)
    participant R as Agente de Riesgo
    participant K as Agente de Cobro
    participant L as Agente de Conciliación
    participant A as Agente Contable
    actor H as Persona (revisión)

    Note over V,A: El agente propone, el código dispone.<br/>Ningún agente crea, cambia ni anula ventas o dispersiones.

    V->>R: venta (montos inusuales, cliente nuevo, rechazos previos)
    R-->>V: nivel de riesgo y motivos (JSON validado, plan B si falla)
    alt riesgo alto o el modelo no responde
        V->>H: venta en revisión humana antes de cobrar
        H-->>V: aprueba o rechaza
    end

    V->>K: venta con enlace de pago
    K-->>V: mensaje para el cliente y recordatorios (sin escribir cifras propias)

    V->>L: ventas, cobros y eventos del día
    L-->>V: diferencias encontradas
    Note over V,L: Una diferencia deja la venta en_revision.

    V->>A: liquidación de una venta
    A-->>V: explicación y cierre del día
    Note over A: Lee la liquidación que calculó el código, no calcula dinero.
```

El simulador de referencia del kit **no trae** el agente de Riesgo ni los demás: son parte del trabajo del grupo (Trabajos 4 y 5 del instructivo).

## Imágenes

Por si tu visor no dibuja Mermaid: [camino feliz](diagramas/ventas-1-camino-feliz.png), [fallos y compensaciones](diagramas/ventas-2-fallos-y-compensaciones.png) y [agentes](diagramas/ventas-3-agentes.png).
