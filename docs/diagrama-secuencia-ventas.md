# Diagrama de secuencia: Ventas y contabilidad frente a los demás servicios

Servicio del grupo de Zaidy dentro de MotorRed (Instructivo N.° 5). Ventas es el **orquestador comercial**: arma la venta, cobra, confirma a los proveedores, liquida, dispersa el dinero y lleva los asientos. Es el único que mueve dinero.

Todo sale del Instructivo 5 (Figuras 1 y 2, Conceptos 2, 4 y 5). Los nombres de herramientas, alcances y eventos son los del contrato 1.0; el detalle exacto de campos y códigos de error está en el kit (`docs/contrato.md` y `contrato/REGLAS.md`) y hay que contrastarlo cuando lo tengamos.

## Quién habla con quién

| Origen | Destino | Cómo | Alcance / protección |
|---|---|---|---|
| Taller | Ventas | MCP `crear_venta`, `anular_venta`, `consultar_venta`, `generar_cobro`, `consultar_liquidacion` | Token OAuth con alcance `ventas.crear` (y los de consulta) |
| Ventas | Tienda y Concesionario | MCP `consultar_reserva`, `confirmar_reserva`, `liberar_reserva` | `proveedor.confirmar` solo lo tiene Ventas |
| Ventas | Pasarela | API: crear cobro y reembolso | Pasarela simulada |
| Pasarela | Ventas | Webhook `POST /webhooks/pasarela` (`cobro.aprobado`) | HMAC-SHA256 con marca de tiempo (máx. 5 min) y `evento_id` |
| Ventas | Taller | Evento firmado `venta.liquidada` | HMAC; solo a `NOTIFICACIONES_PERMITIDAS` |
| Auditor | Todos | `GET /bitacora` | Cliente `auditor`, con `traza_id` |

## 1. Camino feliz: de la venta a la liquidación

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant T as Taller (Falla)
    participant V as VENTAS (Zaidy)
    participant P as Tienda / Concesionario
    participant G as Pasarela simulada

    Note over T,P: Antes: el taller ya diagnosticó, cotizó y reservó repuestos<br/>con precio congelado y vencimiento (30 min). El cliente aprobó la opción.

    T->>V: MCP crear_venta (líneas, pagador, clave_idempotencia, traza_id, url_notificacion)
    Note right of V: Valida el token y el alcance ventas.crear.<br/>Misma clave y mismos datos devuelve la misma venta.<br/>Misma clave con otros datos: IDEMPOTENCIA_CONFLICTO.

    loop Por cada línea de la venta
        V->>P: MCP consultar_reserva
        P-->>V: precio, cantidad y vencimiento reales
        Note right of V: Si no coincide con lo que dijo el taller:<br/>PRECIO_NO_COINCIDE. Si la reserva es de otra venta, la rechaza.
    end

    Note right of V: Agente de Riesgo propone nivel y motivos.<br/>Si el riesgo es alto, la venta queda para revisión humana antes de cobrar.<br/>El código calcula el IVA por línea (pesos enteros) y el total.

    V->>G: API crear cobro (monto, referencia de la venta)
    G-->>V: id del cobro y enlace de pago
    V-->>T: venta creada con el enlace de pago
    T-->>C: enlace de pago

    C->>G: paga (aprueba en la pasarela)
    G-->>V: webhook cobro.aprobado (firmado, puede llegar dos veces)
    Note right of V: Verifica HMAC y que la marca de tiempo tenga menos de 5 min.<br/>Guarda el evento_id: un evento repetido se ignora.<br/>Comprueba que el monto del cobro cuadre con la venta.

    loop Por cada proveedor de la venta
        V->>P: MCP confirmar_reserva (alcance proveedor.confirmar)
        P-->>V: venta en firme y despacho programado
    end

    rect rgb(238, 242, 255)
    Note over V: Liquidación en una sola transacción de PostgreSQL<br/>1. IVA por línea y retención en la fuente si aplica<br/>2. Comisión de la plataforma 3% más su IVA<br/>3. Neto de cada beneficiario y dispersión<br/>4. Asientos en partida doble (débitos igual a créditos)
    end

    V-->>T: evento firmado venta.liquidada
    Note over T: La orden pasa a en reparación.
    T-->>C: el taller puede empezar
```

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
    C->>G: intenta pagar
    G-->>V: webhook de cobro rechazado
    V-->>T: la venta sigue abierta, hace falta un nuevo cobro
    T->>V: MCP generar_cobro
    V->>G: API crear nuevo cobro
    G-->>V: nuevo enlace de pago
    V-->>T: enlace nuevo
    C->>G: paga con éxito
    G-->>V: webhook cobro.aprobado
    Note over V: La venta se completa y se liquida una sola vez.
    end

    rect rgb(255, 247, 237)
    Note over C,G: B. La reserva venció antes del pago: saga con compensación (escenario E4)
    G-->>V: webhook cobro.aprobado
    V->>P: MCP confirmar_reserva
    P-->>V: error: la reserva venció
    Note right of V: Ventas no puede des-cobrar.<br/>Ejecuta la compensación en orden.
    V->>P: MCP liberar_reserva (las demás reservas de la venta)
    P-->>V: unidades devueltas al inventario
    V->>G: API pedir reembolso
    G-->>V: reembolso aprobado
    V-->>T: evento firmado: venta compensada
    Note over T: El taller cotiza de nuevo.
    end

    rect rgb(245, 243, 255)
    Note over C,G: C. Algo no cuadra: la baranda detiene el dinero
    G-->>V: webhook con un monto distinto al de la venta
    Note right of V: La saga no improvisa.<br/>La venta queda en_revision y no dispersa nada.<br/>Una persona revisa la bitácora con el traza_id.
    end

    rect rgb(240, 253, 244)
    Note over C,G: D. Ataques que Ventas rechaza (escenario E6)
    T->>V: crear_venta con un precio alterado
    V-->>T: PRECIO_NO_COINCIDE
    G-->>V: webhook con firma falsa o de hace más de 5 min
    Note right of V: Se rechaza: no cambia ningún estado.
    T->>V: consultar_venta con la traza_id de otra orden
    V-->>T: NO_ENCONTRADO
    T->>V: crear_venta con url_notificacion externa
    V-->>T: rechazada: destino fuera de NOTIFICACIONES_PERMITIDAS
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

    V->>R: venta (montos, cliente nuevo, rechazos previos)
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

## Imágenes

Por si tu visor no dibuja Mermaid: [camino feliz](diagramas/ventas-1-camino-feliz.png), [fallos y compensaciones](diagramas/ventas-2-fallos-y-compensaciones.png) y [agentes](diagramas/ventas-3-agentes.png).
