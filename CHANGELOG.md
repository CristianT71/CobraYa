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

### Varios negocios usan el servicio (A2A)

El contrato 1.0.0 describe un servicio detrás de **un** supervisor con **una** key. Ahora
varios negocios (concesionario, taller, repuestos...) lo usan, cada uno con su key. Detalle
para ellos en [`docs/CONTRATO-A2A.md`](docs/CONTRATO-A2A.md).

- **Rutas nuevas** (sección 7.2): `GET /.well-known/agent.json` (tarjeta pública),
  `POST /a2a/tasks` (key del negocio), `GET|POST|PATCH /admin/partners…` (solo el operador),
  `GET /public/info` y `POST /public/receipts/verify` (públicas, con límites), y la página web en `/`.
  Las rutas públicas (`@Public`) ya no son solo `/health`; cada una tiene su propia protección.
- **Habilidades** (`/a2a/tasks`): `registrar_cliente`, `crear_cuenta`, `registrar_pago`,
  `consultar_cuenta`, `consultar_comprobante` y `lenguaje_natural`, con el formato `{from, message}`
  del concesionario o `{skill, params}`. El operador puede limitar las habilidades de cada negocio.
- **Aislamiento por negocio** (sección 5.7): cada negocio solo ve y toca sus clientes, sus
  cuentas y sus comprobantes; lo ajeno responde igual que lo inexistente. La unicidad del
  documento del cliente pasa a ser **por negocio** (índice `uq_customers_scope_document`).
- **Modelo de datos** (sección 5): tablas `partners` y `partner_exchanges`; columna `partner_id`
  (nula = la plataforma, el ámbito de `SERVICE_API_KEY`) en `customers` e `invoices`. Migración
  `1792713600000-AddPartnersAndTenancy`.
- **Keys** (sección 10.1): `fac_…`, una por negocio, mostrada una sola vez; en la base solo queda su HMAC con
  `PARTNER_KEY_PEPPER`. Se aceptan en `Authorization: Bearer` o `X-API-Key`. Una key falsa, ausente o de un
  negocio desactivado reciben exactamente la misma respuesta. Diez intentos inválidos bloquean la IP 15 minutos.
- **Límites por negocio** (sección 9.2): 30 solicitudes por minuto y 500 por día por defecto
  (configurables), cuerpo de hasta 16 KB; `429` con `Retry-After`.
- **Idempotencia entre negocios** (sección 7.6): la clave es de cada negocio (se antepone su identificador),
  así que dos negocios no chocan ni pueden leer la cuenta del otro con la misma clave.
- **Variables de entorno** (sección 10.4): `PARTNER_KEY_PEPPER` (**obligatoria**, mínimo 32 caracteres) y
  `A2A_PUBLIC_BASE_URL` (opcional; la URL que anuncia la tarjeta).
- **Alcance** (sección 12.6): *"Alta y edición de clientes"* ya no está fuera de alcance del todo: los negocios
  **registran** clientes (habilidad `registrar_cliente`), con datos estructurados. La edición sigue fuera de alcance, y
  RN-01 sigue vigente para el lenguaje natural (nunca se crean clientes con datos que extrajo el modelo).
  *"Interfaz gráfica"* tampoco: hay una página web (portada, guía y consola para negocios, verificación de
  comprobantes y panel del operador).
- **Verificación pública de comprobantes**: exige el número **y** el documento del cliente; un número inexistente y un
  documento equivocado responden igual; 10 consultas por minuto por IP y bloqueo tras 10 fallos.
- **`answer`**: las respuestas de `/a2a/*` incluyen un texto listo para mostrar, siempre (también en errores).
  `/agent/*` y `/billing/*` no cambian.
- **Alcance por escrito**: somos facturación, no contabilidad (libros, balances, reportes tributarios).

### Catálogo de errores (secciones 7.5 y 9.1)

| Código | `status` | HTTP directo | HTTP `/agent` | Cuándo |
|---|---|---|---|---|
| `INVOICE_NOT_FOUND` | `rejected` | 404 | 200 | La cuenta de cobro no existe |
| `RECEIPT_NOT_FOUND` | `rejected` | 404 | 200 | El comprobante no existe, o la cuenta aún no se pagó |
| `VALIDATION_ERROR` | `rejected` | 400 | 400 | El cuerpo no pasa la validación del DTO |
| `UNAUTHORIZED` | `rejected` | 401 | 401 | Falta o es inválida la `X-API-Key` |
| `NOT_FOUND` | `rejected` | 404 | 404 | Ruta inexistente |
| `IDEMPOTENCY_CONFLICT` | `rejected` | 409 | 409 | Misma `Idempotency-Key` con un cuerpo distinto |
| `SKILL_NOT_ALLOWED` | `rejected` | 403 | 403 | El negocio no tiene permiso para esa habilidad |
| `RATE_LIMITED` | `rejected` | 429 | 429 | Límite por minuto o bloqueo por intentos con key inválida (con `Retry-After`) |
| `QUOTA_EXCEEDED` | `rejected` | 429 | 429 | Cuota diaria del negocio agotada |
| `PARTNER_EXISTS` | `rejected` | 409 | 409 | Ya existe un negocio con ese identificador (administración) |
| `PARTNER_NOT_FOUND` | `rejected` | 404 | 404 | El negocio no existe (administración) |

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
- **Prompt `1.2.0`** (antes `1.0.0`): reglas explícitas para tipo de documento ("cédula" →
  `CC`, número sin tipo → `null`), cantidad (por defecto 1), montos con palabras ("80 mil",
  "30k", "1,5 millones"), método de pago, y dos aclaraciones que el modelo confundía: cobrar
  ítems y decir que "ya pagó" sigue siendo `create_invoice` (el pago nace con la cuenta, RN-05),
  y el valor de un ítem va siempre en `unit_price`, nunca en `payment.amount`.
  Medido con `npm run golden` contra gpt-oss-120b en Fireworks:

  | Prompt | Casos | Intención (meta 95 %) | Cliente y montos (meta 90 %) |
  |---|---|---|---|
  | 1.0.0 | 42 | 92,9 % | 68,6 % |
  | 1.1.0 | 42 | 90,5 % | 94,3 % |
  | 1.2.0 | 42 | 100 % | 100 % |
  | 1.2.0 | 8 casos nuevos, no vistos al ajustar | 100 % | 100 % |
  | 1.2.0 | 50 (dos corridas seguidas) | 100 % | 100 % |

  El dataset es nuestro y el prompt se ajustó mirando sus fallos; por eso se midieron los 8
  casos nuevos antes de incorporarlos. La muestra es pequeña: conviene seguir ampliando el
  dataset con frases reales del taller.
- **Descripción de ítems en mayúscula inicial** ("cambio de aceite" → "Cambio de aceite"),
  como en el ejemplo de la sección 7.4. Lo hace el código, no el prompt.

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
