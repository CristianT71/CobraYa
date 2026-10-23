# Subagente de Facturación y Pagos

Negocio de facturación del ecosistema de taller vehicular (junto al concesionario, el taller y la tienda de repuestos). Cada negocio usa Facturación y Pagos con su propia key: le pide, en una frase en español o con datos estructurados, cuentas de cobro, pagos y comprobantes. Un LLM (gpt-oss-120b en Fireworks AI) solo extrae los datos de la frase; el código calcula, valida y guarda.

Somos **facturación, no contabilidad**: no hacemos libros, balances ni reportes tributarios. Los negocios nos hablan con el formato A2A del concesionario: [`docs/CONTRATO-A2A.md`](docs/CONTRATO-A2A.md).

Proyecto educativo: no incluye facturación electrónica, DIAN ni pasarelas de pago reales. El detalle técnico está en el documento "Contrato y arquitectura" y el reparto de trabajo en "Reparto de trabajo del equipo".

## Requisitos

- Node.js 24 LTS y npm
- Docker con Docker Compose (para PostgreSQL local)

## Puesta en marcha

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env        # en PowerShell: Copy-Item .env.example .env
#    Completa SERVICE_API_KEY, FIREWORKS_API_KEY y PARTNER_KEY_PEPPER en .env
#    (PARTNER_KEY_PEPPER: openssl rand -hex 32; en PowerShell: -join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) }))

# 3. PostgreSQL local
docker compose up -d

# 4. Esquema de base de datos y clientes de prueba
npm run migration:run
npm run seed

# 5. Página web (se compila una vez; el servicio la sirve en /)
npm install --prefix frontend
npm run build --prefix frontend

# 6. Servicio en modo desarrollo
npm run start:dev
```

Si falta una variable obligatoria o tiene un formato inválido, el servicio no arranca y el mensaje indica cuál.

Con el servicio arriba:

- Página web: `http://localhost:3000/` (portada, guía y consola para negocios, verificación de comprobantes y panel del operador)
- Estado: `GET http://localhost:3000/health` (no exige API key)
- Swagger: `http://localhost:3000/docs` (documento OpenAPI en `/docs/json`)

## Ejemplo de solicitud

```bash
curl -X POST http://localhost:3000/agent/requests \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <SERVICE_API_KEY>" \
  -H "Idempotency-Key: demo-0001" \
  -d '{"request_id":"sup-20261021-0001","text":"Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000 y un filtro de 25.000, pagó en efectivo"}'
```

Toda respuesta trae `status` (`completed`, `needs_clarification`, `rejected` o `error`), `message`, `data`, `missing_fields` y `request_id`. En `rejected` y `error`, `data.error_code` trae el código del catálogo (sección 9.1).

## Negocios y página web

Cada negocio (concesionario, taller, repuestos...) se registra con su propia key. El **operador** (quien tiene `SERVICE_API_KEY`) lo hace en el panel de la página (`/#/panel`) o por la API:

```bash
curl -X POST http://localhost:3000/admin/partners   -H "X-API-Key: <SERVICE_API_KEY>" -H "Content-Type: application/json"   -d '{"slug":"concesionario","name":"AutoMax Concesionario"}'
# La respuesta trae api_key (fac_...): se muestra UNA vez; en la base solo queda su hash.
```

El negocio llama con su key: `POST /a2a/tasks` (la tarjeta pública está en `/.well-known/agent.json`). Cada negocio **solo ve y toca lo suyo**: sus clientes, sus cuentas y sus comprobantes. El operador puede cambiar sus permisos y límites, rotar su key, desactivarlo y revisar sus intercambios. Todo el contrato para los otros equipos, con ejemplos reales, está en [`docs/CONTRATO-A2A.md`](docs/CONTRATO-A2A.md).

| Ruta | Quién | Para qué |
|---|---|---|
| `/a2a/tasks`, `/.well-known/agent.json` | Un negocio (su key `fac_…`), la tarjeta es pública | Pedir cobros, pagos y comprobantes |
| `/admin/partners/*` | El operador (`SERVICE_API_KEY`) | Registrar negocios, permisos, límites, rotar keys, intercambios |
| `/public/info`, `/public/receipts/verify` | Público, con límites por IP | Portada y verificación de comprobantes (número + documento) |
| `/agent/requests`, `/billing/*` | El operador (`SERVICE_API_KEY`) | Camino con IA y camino directo, ámbito de la plataforma |

La página está en `frontend/` (React + Vite). Para desarrollarla con recarga automática: `npm run dev --prefix frontend` (reenvía la API al puerto 3000).

## Pruebas

```bash
npm test                 # unitarias (test/unit): dominio, orquestador, adaptador, reglas de dependencia
npm run test:integration # casos de uso, restricciones del esquema y clientes contra PostgreSQL
npm run test:e2e         # HTTP completas: /agent, /billing, /a2a, /admin y /public con el extractor simulado
npm test --prefix frontend   # la página web (Vitest + Testing Library)
npm run lint
```

Las de integración y las e2e de la aplicación completa necesitan un PostgreSQL de prueba con las migraciones aplicadas; si `E2E_DATABASE_URL` no está definida, esas suites se omiten. El `docker-compose.yml` trae una base para esto (`db_test`, puerto 5433, sin persistencia):

```bash
docker compose up -d db_test
DATABASE_URL=postgres://facturacion:facturacion@localhost:5433/facturacion_test npm run migration:run
export E2E_DATABASE_URL=postgres://facturacion:facturacion@localhost:5433/facturacion_test
npm run test:integration && npm run test:e2e
# PowerShell: $env:E2E_DATABASE_URL="postgres://..."; npm run test:e2e
```

Para nuevas e2e usa `createTestApp()`, `resetDatabase()` y `api()` de `test/e2e/support/test-app.ts`.

Ninguna de estas pruebas llama al LLM real. El dataset dorado (`test/golden/`) se ejecuta aparte contra el modelo, con `FIREWORKS_API_KEY` en `.env`:

```bash
npm run golden                        # corre los 50 casos y compara con la corrida anterior
npm run golden -- --only g-001,g-013  # solo esos casos
```

Mide la precisión de intención (meta 95 %) y de cliente y montos (meta 90 %) y guarda cada corrida en `test/golden/results/` para comparar versiones del prompt (`PROMPT_VERSION`).

## Estructura

```
src/
  agent/        Camino con IA: POST /agent/requests, orquestador, puerto y adaptador del LLM
  a2a/          Canal de negocios: tarjeta pública, POST /a2a/tasks, keys, límites y bitácora
  partners/     Registro de negocios: keys (solo su hash), permisos y límites
  admin/        Administración de negocios (solo el operador)
  public/       Endpoints públicos de la página: información y verificación de comprobantes
  billing/      Dominio (cálculos y reglas), casos de uso, entidades y camino directo /billing/*
  customers/    Búsqueda de clientes por documento
  database/     data-source, migraciones y datos semilla
  health/       GET /health
  common/
    config/         Variables de entorno tipadas y su validación
    guards/         ServiceApiKeyGuard (X-API-Key)
    interceptors/   request_id en encabezado, cuerpo y logs
    filters/        Traducción de errores al envoltorio de respuesta
    errors/         Catálogo de errores de la sección 9.1
    logging/        Logger JSON que enmascara cédulas y oculta claves
    swagger/        Decoradores comunes para documentar endpoints
    utils/          Enmascarado de cédulas
  app.setup.ts  Pipe, guard, interceptor, filtro y Swagger globales (lo usan main.ts y las e2e)
  frontend.setup.ts  Sirve la página compilada con política de seguridad estricta
frontend/       Página web (React + Vite + TypeScript), con sus propias pruebas
test/
  unit/  integration/  e2e/  golden/
docs/           CONTRATO-A2A.md: contrato para los otros negocios
```

## Guía para los módulos

- **Rutas públicas:** todas exigen `X-API-Key`. Solo `/health` usa `@Public()`; no agregues otras sin acordarlo.
- **Errores de dominio:** basta con lanzar un error con `code` del catálogo (`src/common/errors/error-catalog.ts`), por ejemplo `{ code: 'CUSTOMER_NOT_FOUND', message: '...' }`. El filtro global lo traduce: `422` en `/billing/*`, `200` con `status: "rejected"` o `"needs_clarification"` en `/agent/*`. `missingFields` llena `missing_fields`, y `httpStatus` fuerza un código (por ejemplo `504` para un timeout del modelo).
- **Idempotencia:** ante la misma `Idempotency-Key` con otro cuerpo, lanza `ConflictException`; el filtro responde `409` con `IDEMPOTENCY_CONFLICT`.
- **request_id:** usa `resolveRequestId(req)` de `common/interceptors/request-id.interceptor.ts` para obtener el mismo valor que viaja en la respuesta y en los logs.
- **Logs:** usa `new Logger(MiClase.name)`; el logger global ya enmascara cédulas y oculta claves. Aun así, enmascara con `maskDocument()` lo que vaya a `llm_call_logs` y a las respuestas.
- **Configuración:** lee con `ConfigService`, por ejemplo `config.getOrThrow<string>('billing.taxRate')`. Las claves están en `src/common/config/configuration.ts`.
- **Migraciones:** `synchronize` está apagado; todo cambio de columna es una migración nueva en `src/database/migrations/` (`npm run migration:run` / `migration:revert`) y se revisa con quien mantiene los datos. No edites una migración ya ejecutada.
- **Dependencias entre módulos:** `agent` puede usar `billing` y `customers`; nunca al revés. `billing/domain` no importa NestJS, TypeORM ni el LLM, y solo `agent/llm/fireworks-extractor.adapter.ts` conoce al proveedor. `test/unit/architecture.spec.ts` lo comprueba sobre los imports reales.
- **Modelo caído:** el adaptador reintenta con espera creciente y, tras 5 solicitudes seguidas sin respuesta, corta las llamadas 30 s (`agent/llm/circuit-breaker.ts`) y responde `LLM_UNAVAILABLE` de inmediato.
- **Swagger:** documenta cada endpoint con `@ApiTags`, `@ApiOperation`, `@ApiStandardErrors()` y, en los POST que crean o pagan, `@ApiIdempotencyKey()`.

## Trabajo en equipo

Una rama por persona (`DevAlejo`, `DevCristian`, `DevJheison`, `DevZaidy`); nada entra a `main` sin pull request revisado. Las interfaces compartidas y el contrato solo cambian por acuerdo del grupo (sección 12.4).
