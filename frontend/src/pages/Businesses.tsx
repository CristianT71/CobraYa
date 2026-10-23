import { useEffect, useState, type FormEvent } from 'react';
import { CodeBlock } from '../components/CodeBlock';
import { ApiError, SKILLS, api, type RawResponse, type ServiceInfo, type Skill } from '../lib/api';
import { newIdempotencyKey } from '../lib/format';

export const EXAMPLES: Record<Skill, { label: string; body: unknown }> = {
  lenguaje_natural: {
    label: 'Lenguaje natural',
    body: {
      from: 'mi-negocio',
      message:
        'Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000 y un filtro de 25.000, pagó en efectivo',
    },
  },
  registrar_cliente: {
    label: 'Registrar cliente',
    body: {
      skill: 'registrar_cliente',
      params: {
        document_type: 'CC',
        document_number: '1032456789',
        full_name: 'Cliente de ejemplo',
      },
    },
  },
  crear_cuenta: {
    label: 'Crear cuenta de cobro',
    body: {
      skill: 'crear_cuenta',
      params: {
        customer: { document_type: 'CC', document_number: '1032456789' },
        items: [
          { description: 'Cambio de aceite', quantity: 1, unit_price: '80000.00' },
          { description: 'Filtro', quantity: 1, unit_price: '25000.00' },
        ],
        payment: { method: 'cash' },
        external_ref: 'ORDEN-2026-77',
      },
    },
  },
  registrar_pago: {
    label: 'Registrar pago',
    body: {
      skill: 'registrar_pago',
      params: { invoice_id: '<id de la cuenta>', method: 'transfer' },
    },
  },
  consultar_cuenta: {
    label: 'Consultar cuenta',
    body: { skill: 'consultar_cuenta', params: { invoice_id: '<id de la cuenta>' } },
  },
  consultar_comprobante: {
    label: 'Consultar comprobante',
    body: { skill: 'consultar_comprobante', params: { receipt_number: 1 } },
  },
};

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

const RESPONSE_EXAMPLE = pretty({
  status: 'completed',
  message: 'Cuenta de cobro creada y pagada en efectivo.',
  answer:
    'Cuenta de cobro creada y pagada en efectivo. Cliente Cliente de ejemplo (****6789). Total $124.950 (subtotal $105.000 + impuesto $19.950). Pago en efectivo por $124.950. Comprobante N.º 1.',
  data: {
    invoice_id: 'b2f1c0de-0000-4000-8000-000000000001',
    customer: {
      document_type: 'CC',
      document_number: '****6789',
      full_name: 'Cliente de ejemplo',
    },
    subtotal: '105000.00',
    tax_rate: '0.1900',
    tax_amount: '19950.00',
    total: '124950.00',
    payment: { method: 'cash', amount: '124950.00', status: 'APPLIED' },
    receipt: { receipt_number: 1, issued_at: '2026-10-21T16:50:00-05:00' },
  },
  missing_fields: [],
  request_id: 'sup-20261021-0001',
});

const SKILL_PARAMS: Record<Skill, string> = {
  lenguaje_natural: 'message (texto); sin params',
  registrar_cliente: 'document_type, document_number, full_name',
  crear_cuenta:
    'customer {document_type?, document_number, full_name?}, items [{description, quantity, unit_price}], payment? {method, amount?}, external_ref?',
  registrar_pago: 'invoice_id, method, amount?',
  consultar_cuenta: 'invoice_id',
  consultar_comprobante: 'receipt_number o invoice_id',
};

const STATUSES: Array<{ status: string; http: string; meaning: string }> = [
  {
    status: 'completed',
    http: '200',
    meaning: 'Se ejecutó y quedó guardado. Muestra `answer` y usa `data`.',
  },
  {
    status: 'needs_clarification',
    http: '200',
    meaning:
      'Falta información o hay ambigüedad; no se guardó nada. Pídele al usuario lo de `missing_fields` y reenvía.',
  },
  {
    status: 'rejected',
    http: '200 / 4xx',
    meaning:
      'La solicitud no cumple una regla (cliente inexistente, monto excedido…). `data.error_code` dice cuál.',
  },
  {
    status: 'error',
    http: '5xx',
    meaning:
      'Falla técnica (por ejemplo, el modelo no responde); no se guardó nada. Reintenta con la misma Idempotency-Key.',
  },
];

export function Businesses() {
  const [info, setInfo] = useState<ServiceInfo | null>(null);

  useEffect(() => {
    let active = true;
    api
      .info()
      .then((data) => {
        if (active) setInfo(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const origin = window.location.origin;
  const tasksUrl = info?.a2a.tasks_url ?? `${origin}/a2a/tasks`;
  const cardUrl = info?.a2a.card_url ?? `${origin}/.well-known/agent.json`;
  const docsUrl = info?.docs_url ?? `${origin}/docs`;

  const curlNatural = `curl -X POST ${tasksUrl} \\
  -H "Authorization: Bearer fac_TU_KEY" \\
  -H "Idempotency-Key: pedido-0001" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(EXAMPLES.lenguaje_natural.body)}'`;

  const curlSkill = `curl -X POST ${tasksUrl} \\
  -H "Authorization: Bearer fac_TU_KEY" \\
  -H "Idempotency-Key: pedido-0002" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(EXAMPLES.crear_cuenta.body)}'`;

  return (
    <>
      <section aria-labelledby="titulo">
        <h1 id="titulo">Para negocios</h1>
        <p className="muted">
          Conecta el bot de tu concesionario, taller o tienda con Facturación y
          Pagos. Tu negocio recibe una key propia y solo ve y toca lo suyo:
          sus clientes, sus cuentas y sus comprobantes.
        </p>

        <div className="grid">
          <article className="card">
            <h3>1. Pide tu key</h3>
            <p>
              El operador registra tu negocio y te entrega una key{' '}
              <code className="inline">fac_…</code>. Se muestra una sola vez.
            </p>
          </article>
          <article className="card">
            <h3>2. Descubre el bot</h3>
            <p>
              La tarjeta pública describe qué sabemos hacer:{' '}
              <a href={cardUrl}>{cardUrl}</a>
            </p>
          </article>
          <article className="card">
            <h3>3. Envía tareas</h3>
            <p>
              <code className="inline">POST {tasksUrl}</code> con tu key en{' '}
              <code className="inline">Authorization: Bearer</code> o en{' '}
              <code className="inline">X-API-Key</code>.
            </p>
          </article>
        </div>
      </section>

      <section className="section" aria-labelledby="ejemplos">
        <h2 id="ejemplos">Ejemplos</h2>
        <div className="stack">
          <CodeBlock label="En lenguaje natural" code={curlNatural} />
          <CodeBlock label="Con una habilidad explícita" code={curlSkill} />
          <CodeBlock label="Respuesta" code={RESPONSE_EXAMPLE} />
        </div>
      </section>

      <section className="section" aria-labelledby="habilidades">
        <h2 id="habilidades">Habilidades</h2>
        <p className="intro">
          Crear cuentas y registrar pagos exigen <code className="inline">Idempotency-Key</code>{' '}
          (encabezado o campo <code className="inline">idempotency_key</code>): si
          repites la petición con la misma clave, recibes el resultado original y
          nada se duplica.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Habilidad</th>
                <th>Qué hace</th>
                <th>Datos</th>
              </tr>
            </thead>
            <tbody>
              {SKILLS.map((skill) => (
                <tr key={skill}>
                  <td>
                    <code className="inline">{skill}</code>
                  </td>
                  <td>
                    {info?.skills.find((item) => item.id === skill)?.description ??
                      EXAMPLES[skill].label}
                  </td>
                  <td>{SKILL_PARAMS[skill]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" aria-labelledby="respuestas">
        <h2 id="respuestas">Cómo leer la respuesta</h2>
        <p className="intro">
          Lee <code className="inline">status</code> antes de usar{' '}
          <code className="inline">data</code>. El campo{' '}
          <code className="inline">answer</code> es un texto listo para mostrar a
          tu cliente.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>status</th>
                <th>HTTP</th>
                <th>Qué hacer</th>
              </tr>
            </thead>
            <tbody>
              {STATUSES.map((row) => (
                <tr key={row.status}>
                  <td>
                    <code className="inline">{row.status}</code>
                  </td>
                  <td>{row.http}</td>
                  <td>{row.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Documentación completa de cada ruta en <a href={docsUrl}>Swagger</a>.
        </p>
      </section>

      <Console />
    </>
  );
}

function Console() {
  const [partnerKey, setPartnerKey] = useState('');
  const [skill, setSkill] = useState<Skill>('lenguaje_natural');
  const [body, setBody] = useState(pretty(EXAMPLES.lenguaje_natural.body));
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RawResponse | null>(null);

  function chooseSkill(next: Skill) {
    setSkill(next);
    setBody(pretty(EXAMPLES[next].body));
    setResult(null);
    setError(null);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!partnerKey.trim()) {
      setError('Escribe la key de tu negocio (fac_…).');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      setError('El cuerpo no es un JSON válido. Revisa las comas y las comillas.');
      return;
    }

    setLoading(true);
    try {
      setResult(await api.sendTask(partnerKey.trim(), parsed, idempotencyKey.trim()));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo enviar la tarea.');
    } finally {
      setLoading(false);
    }
  }

  const answer =
    result &&
    typeof result.body === 'object' &&
    result.body !== null &&
    'answer' in result.body &&
    typeof result.body.answer === 'string'
      ? result.body.answer
      : null;
  const ok = result !== null && result.status >= 200 && result.status < 300;

  return (
    <section className="section" aria-labelledby="consola">
      <h2 id="consola">Consola de pruebas</h2>
      <p className="intro">
        Prueba tu key desde aquí. La key solo se usa en tu navegador para esta
        petición: no se guarda en ningún lado. Lo que crees queda registrado de
        verdad en tu negocio.
      </p>

      <form className="form card" onSubmit={send} noValidate>
        <div className="row">
          <div className="field">
            <label htmlFor="partner-key">Key de tu negocio</label>
            <input
              id="partner-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="fac_…"
              value={partnerKey}
              onChange={(e) => setPartnerKey(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="skill">Habilidad</label>
            <select
              id="skill"
              value={skill}
              onChange={(e) => chooseSkill(e.target.value as Skill)}
            >
              {SKILLS.map((id) => (
                <option key={id} value={id}>
                  {EXAMPLES[id].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="idem">Idempotency-Key</label>
          <div className="toolbar">
            <input
              id="idem"
              type="text"
              autoComplete="off"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => setIdempotencyKey(newIdempotencyKey())}
            >
              Generar otra
            </button>
          </div>
          <span className="hint">
            Repetir la misma clave devuelve el resultado original sin duplicar nada.
          </span>
        </div>

        <div className="field">
          <label htmlFor="body">Cuerpo de la tarea (JSON)</label>
          <textarea
            id="body"
            spellCheck={false}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-invalid={error?.startsWith('El cuerpo') ?? false}
          />
        </div>

        <div className="actions">
          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'Enviando…' : 'Enviar tarea'}
          </button>
        </div>
      </form>

      <div className="stack result" aria-live="polite">
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <>
            <p>
              <span className={`badge ${ok ? 'badge-ok' : 'badge-bad'}`}>
                HTTP {result.status}
              </span>
            </p>
            {answer && <p className="answer">{answer}</p>}
            <CodeBlock label="Respuesta" code={pretty(result.body)} />
          </>
        )}
      </div>
    </section>
  );
}
