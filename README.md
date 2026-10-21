# Subagente de Facturación y Pagos

Servicio NestJS del ecosistema multi-agente de taller vehicular. Convierte solicitudes de cobro en lenguaje natural en comprobantes de pago internos: un LLM (gpt-oss-120b en Fireworks AI) solo extrae los datos; el código calcula, valida y guarda.

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
#    Completa SERVICE_API_KEY y FIREWORKS_API_KEY en .env

# 3. PostgreSQL local
docker compose up -d

# 4. Esquema de base de datos y clientes de prueba
npm run migration:run
npm run seed

# 5. Servicio en modo desarrollo
npm run start:dev
```

Si falta una variable obligatoria o tiene un formato inválido, el servicio no arranca y el mensaje indica cuál.

Con el servicio arriba:

- Estado: `GET http://localhost:3000/health` (no exige API key)
- Swagger: `http://localhost:3000/docs` (documento OpenAPI en `/docs/json`)

Los pasos 3 y 4 dependen de `docker-compose.yml`, las migraciones y los datos semilla (parte de datos y persistencia). Hasta que lleguen a `main`, el servicio arranca solo si hay un PostgreSQL accesible en `DATABASE_URL`.

## Ejemplo de solicitud

```bash
curl -X POST http://localhost:3000/agent/requests \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <SERVICE_API_KEY>" \
  -H "Idempotency-Key: demo-0001" \
  -d '{"request_id":"sup-20261021-0001","text":"Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000 y un filtro de 25.000, pagó en efectivo"}'
```

Toda respuesta trae `status` (`completed`, `needs_clarification`, `rejected` o `error`), `message`, `data`, `missing_fields` y `request_id`. En `rejected` y `error`, `data.error_code` trae el código del catálogo (sección 9.1).

## Pruebas

```bash
npm test            # unitarias (test/unit y *.spec.ts)
npm run test:e2e    # HTTP completas con el extractor simulado (test/e2e)
npm run lint
```

Ninguna de estas pruebas llama al LLM real. El dataset dorado (`test/golden/`) se ejecuta aparte contra el modelo.

## Estructura

```
src/
  agent/        Camino con IA: POST /agent/requests, orquestador, puerto y adaptador del LLM
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
test/
  unit/  integration/  e2e/  golden/
```

## Guía para los módulos

- **Rutas públicas:** todas exigen `X-API-Key`. Solo `/health` usa `@Public()`; no agregues otras sin acordarlo.
- **Errores de dominio:** basta con lanzar un error con `code` del catálogo (`src/common/errors/error-catalog.ts`), por ejemplo `{ code: 'CUSTOMER_NOT_FOUND', message: '...' }`. El filtro global lo traduce: `422` en `/billing/*`, `200` con `status: "rejected"` o `"needs_clarification"` en `/agent/*`. `missingFields` llena `missing_fields`, y `httpStatus` fuerza un código (por ejemplo `504` para un timeout del modelo).
- **Idempotencia:** ante la misma `Idempotency-Key` con otro cuerpo, lanza `ConflictException`; el filtro responde `409` con `IDEMPOTENCY_CONFLICT`.
- **request_id:** usa `resolveRequestId(req)` de `common/interceptors/request-id.interceptor.ts` para obtener el mismo valor que viaja en la respuesta y en los logs.
- **Logs:** usa `new Logger(MiClase.name)`; el logger global ya enmascara cédulas y oculta claves. Aun así, enmascara con `maskDocument()` lo que vaya a `llm_call_logs` y a las respuestas.
- **Configuración:** lee con `ConfigService`, por ejemplo `config.getOrThrow<string>('billing.taxRate')`. Las claves están en `src/common/config/configuration.ts`.
- **Swagger:** documenta cada endpoint con `@ApiTags`, `@ApiOperation`, `@ApiStandardErrors()` y, en los POST que crean o pagan, `@ApiIdempotencyKey()`.

## Trabajo en equipo

Una rama por persona (`DevAlejo`, `DevCristian`, `DevJheison`, `DevZaidy`); nada entra a `main` sin pull request revisado. Las interfaces compartidas y el contrato solo cambian por acuerdo del grupo (sección 12.4).
