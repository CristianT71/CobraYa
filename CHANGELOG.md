# Registro de cambios del contrato

Contrato "Contrato y arquitectura: subagente de Facturación y Pagos", versión **1.0.0**.
Según la sección 12.4, todo cambio al contrato queda aquí. Mientras el grupo no lo
acepte, cada uno sigue lo que dice el contrato vigente: los cambios de abajo están
**implementados y probados, pero pendientes de acuerdo** entre los cuatro y de
actualizar el documento del contrato (le toca a Alejandro).

## Pendiente de acuerdo del grupo

Todos son **compatibles** (campos o códigos nuevos, comportamiento que el contrato
no definía). Ninguno cambia el significado de un campo existente, así que subirían
la versión menor a **1.1.0**.

### Catálogo de errores (secciones 7.5 y 9.1)

| Código | `status` | HTTP directo | HTTP `/agent` | Cuándo |
|---|---|---|---|---|
| `INVOICE_NOT_FOUND` | `rejected` | 404 | 200 | La cuenta de cobro no existe |
| `RECEIPT_NOT_FOUND` | `rejected` | 404 | 200 | El comprobante no existe, o la cuenta aún no se pagó |
| `VALIDATION_ERROR` | `rejected` | 400 | 400 | El cuerpo no pasa la validación del DTO |
| `UNAUTHORIZED` | `rejected` | 401 | 401 | Falta o es inválida la `X-API-Key` |
| `NOT_FOUND` | `rejected` | 404 | 404 | Ruta inexistente |
| `IDEMPOTENCY_CONFLICT` | `rejected` | 409 | 409 | Misma `Idempotency-Key` con un cuerpo distinto |

Nota: `IDEMPOTENCY_CONFLICT` responde 409 también en `/agent/requests`, no 200 (la
sección 7.5 ya fija 409 para este caso; la 9.1 no lo listaba como código).

### Modelo de datos (sección 5)

- **`payments.idempotency_key`** `varchar(100)`, única, nula. Permite reconocer un pago
  repetido. El pago que nace junto con la cuenta (RN-05) queda con `NULL` y se identifica
  por `invoices.idempotency_key`. Migración `1792627200000-AddPaymentIdempotencyKey`.
- **`llm_call_logs.request_id`** es `NOT NULL` (la migración inicial ya lo definía así). Una
  llamada al modelo sin contexto de solicitud (por ejemplo, el dataset dorado) se guarda con
  el valor `sin-request-id`.

### Idempotencia (sección 7.6)

- **El pago es idempotente.** Mismo pago con la misma clave devuelve el resultado original;
  la misma clave con otra cuenta, método o monto responde 409. Una clave **nueva** sobre una
  cuenta ya `PAID` sigue respondiendo `INVOICE_NOT_PAYABLE` (RN-07).
- **"Mismo cuerpo" en `/agent/requests`** se compara sobre lo que el modelo **extrajo**, no
  sobre el texto: la misma clave con un texto distinto pero la misma extracción devuelve el
  resultado original; con otra extracción responde 409.
- `needs_clarification`, `rejected` y `error` no consumen la clave (nada se guarda).

### Contrato de extracción (sección 6.2)

- **`items[].unit_price` vacío (`""`)** significa "el texto no dice el precio". El tipo es
  texto y no admite `null`, así que el prompt 1.1.0 le indica al modelo usar cadena vacía en
  vez de inventar `"0.00"`. El código lo trata como dato faltante y responde
  `needs_clarification` con `missing_fields: ["items[N].unit_price"]`.
- **Prompt `1.1.0`** (antes `1.0.0`): reglas explícitas para tipo de documento ("cédula" →
  `CC`, número sin tipo → `null`), cantidad (por defecto 1), montos con palabras ("80 mil",
  "30k", "1,5 millones") y método de pago. **Sin medir todavía** contra el modelo real: falta
  la primera corrida de `npm run golden`.

### Interfaces compartidas (sección 2 del reparto)

- **`LlmExtractorPort.extract(text, context?)`** recibe un segundo argumento opcional
  `{ requestId }` para correlacionar la llamada con su fila en `llm_call_logs`. Las llamadas
  con un solo argumento siguen funcionando.
- **`InvoiceResultData`** (forma de `data` en una cuenta) ahora vive en `billing/dto` y
  `agent` la importa, para cumplir la regla de dependencias de la sección 2.2.

### Resiliencia (sección 9.2)

- **Circuito contra Fireworks caído:** tras 5 solicitudes seguidas sin respuesta (ya agotados
  los reintentos), se rechazan las llamadas durante 30 s con `LLM_UNAVAILABLE` (502) sin
  esperar el timeout; vencido el tiempo pasa una llamada de prueba.
- Un 401 o 400 del proveedor (clave inválida, petición mal formada) no cuenta como caída ni
  se reintenta.

## Cierres de huecos del contrato 1.0.0 (sin cambio de interfaz)

- `CreateInvoiceDto.customer` es obligatorio: sin él la petición fallaba con 500 en vez de 400.
- Los casos de uso `CreateInvoice`, `RegisterPayment` y `GetReceipt` guardan cuenta, ítems,
  pago y comprobante en **una sola transacción**; un fallo a mitad no deja nada (sección 5.7).
- Dos pagos simultáneos sobre la misma cuenta se serializan con `SELECT ... FOR UPDATE`.

## 1.0.0

Versión inicial del contrato.
