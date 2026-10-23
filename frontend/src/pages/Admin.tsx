import { useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  SKILLS,
  api,
  type Exchange,
  type Partner,
  type PartnerWithKey,
  type Skill,
} from '../lib/api';
import { formatDate } from '../lib/format';

const SLUG = /^[a-z][a-z0-9-]{1,19}$/;

// La clave de servicio del operador solo vive en el estado de este componente: no se
// guarda en el navegador y se pierde al recargar o al salir.
export function Admin() {
  const [session, setSession] = useState<string | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);

  async function enter(operatorKey: string) {
    setPartners(await api.admin.listPartners(operatorKey));
    setSession(operatorKey);
  }

  function leave() {
    setSession(null);
    setPartners([]);
  }

  return (
    <section aria-labelledby="titulo">
      <h1 id="titulo">Panel del operador</h1>
      {session === null ? (
        <LoginForm onEnter={enter} />
      ) : (
        <Panel
          operatorKey={session}
          partners={partners}
          setPartners={setPartners}
          onLeave={leave}
        />
      )}
    </section>
  );
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'La clave de servicio no es válida.';
    if (error.code === 'PARTNER_EXISTS') {
      return 'Ya existe un negocio con ese identificador.';
    }
    if (error.status === 400) return `Datos inválidos: ${error.message}`;
    return error.message;
  }
  return 'Ocurrió un error inesperado.';
}

function LoginForm({ onEnter }: { onEnter: (key: string) => Promise<void> }) {
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!key.trim()) {
      setError('Escribe la clave de servicio.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onEnter(key.trim());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <p className="muted">
        Aquí se registran los negocios que usan el servicio y se les entrega su key.
        Entra con la clave de servicio (<code className="inline">SERVICE_API_KEY</code>
        ). No se guarda: tendrás que escribirla de nuevo si recargas la página.
      </p>
      <form className="form card" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="operator-key">Clave de servicio</label>
          <input
            id="operator-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </form>
    </>
  );
}

interface PanelProps {
  operatorKey: string;
  partners: Partner[];
  setPartners: (partners: Partner[]) => void;
  onLeave: () => void;
}

type Selection = { id: string; mode: 'exchanges' | 'edit' } | null;

function Panel({ operatorKey, partners, setPartners, onLeave }: PanelProps) {
  const [revealed, setRevealed] = useState<{ name: string; apiKey: string } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  function handle(failure: unknown) {
    if (failure instanceof ApiError && failure.status === 401) {
      onLeave();
      return;
    }
    setError(errorText(failure));
  }

  async function reload() {
    setPartners(await api.admin.listPartners(operatorKey));
  }

  async function onCreated(created: PartnerWithKey) {
    setRevealed({ name: created.partner.name, apiKey: created.api_key });
    // El formulario se cierra solo: así la key nueva queda a la vista.
    setFormOpen(false);
    await reload();
  }

  async function toggleActive(partner: Partner) {
    setError(null);
    try {
      await api.admin.updatePartner(operatorKey, partner.id, { active: !partner.active });
      await reload();
    } catch (e) {
      handle(e);
    }
  }

  async function rotate(partner: Partner) {
    const confirmed = window.confirm(
      `¿Rotar la key de ${partner.name}? La anterior dejará de servir ahora mismo.`,
    );
    if (!confirmed) return;
    setError(null);
    try {
      const rotated = await api.admin.rotateKey(operatorKey, partner.id);
      setRevealed({ name: rotated.partner.name, apiKey: rotated.api_key });
      await reload();
    } catch (e) {
      handle(e);
    }
  }

  const selected = selection ? partners.find((p) => p.id === selection.id) : undefined;

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted">
          {partners.length === 0
            ? 'Todavía no hay negocios registrados.'
            : `${partners.length} negocio${partners.length === 1 ? '' : 's'} registrado${partners.length === 1 ? '' : 's'}.`}
        </p>
        <button type="button" className="btn btn-ghost btn-small" onClick={onLeave}>
          Salir
        </button>
      </div>

      {revealed && <RevealKey revealed={revealed} onDismiss={() => setRevealed(null)} />}
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <details
        className="card"
        open={formOpen}
        onToggle={(event) => setFormOpen(event.currentTarget.open)}
      >
        <summary>
          <strong>Registrar un negocio</strong>
        </summary>
        <NewPartnerForm
          operatorKey={operatorKey}
          onCreated={onCreated}
          onFailure={handle}
        />
      </details>

      {partners.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Negocio</th>
                <th>Key</th>
                <th>Estado</th>
                <th>Límites</th>
                <th>Último uso</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((partner) => (
                <tr key={partner.id}>
                  <td>
                    <strong>{partner.name}</strong>
                    <br />
                    <code className="inline">{partner.slug}</code>
                  </td>
                  <td>
                    <code className="inline">{partner.key_prefix}…</code>
                  </td>
                  <td>
                    <span className={`badge ${partner.active ? 'badge-ok' : 'badge-bad'}`}>
                      {partner.active ? 'Activo' : 'Desactivado'}
                    </span>
                  </td>
                  <td>
                    {partner.rate_per_minute}/min · {partner.daily_quota}/día
                    <br />
                    <span className="muted">{partner.skills.length} habilidades</span>
                  </td>
                  <td>{partner.last_used_at ? formatDate(partner.last_used_at) : 'Nunca'}</td>
                  <td>
                    <div className="toolbar">
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => setSelection({ id: partner.id, mode: 'exchanges' })}
                        aria-label={`Intercambios de ${partner.name}`}
                      >
                        Intercambios
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => setSelection({ id: partner.id, mode: 'edit' })}
                        aria-label={`Permisos y límites de ${partner.name}`}
                      >
                        Permisos
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => rotate(partner)}
                        aria-label={`Rotar la key de ${partner.name}`}
                      >
                        Rotar key
                      </button>
                      <button
                        type="button"
                        className={`btn btn-small ${partner.active ? 'btn-danger' : 'btn-secondary'}`}
                        onClick={() => toggleActive(partner)}
                        aria-label={`${partner.active ? 'Desactivar' : 'Activar'} a ${partner.name}`}
                      >
                        {partner.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && selection?.mode === 'exchanges' && (
        <ExchangesPanel
          operatorKey={operatorKey}
          partner={selected}
          onFailure={handle}
          onClose={() => setSelection(null)}
        />
      )}
      {selected && selection?.mode === 'edit' && (
        <PartnerEditor
          operatorKey={operatorKey}
          partner={selected}
          onSaved={async () => {
            await reload();
            setSelection(null);
          }}
          onFailure={handle}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}

function RevealKey({
  revealed,
  onDismiss,
}: {
  revealed: { name: string; apiKey: string };
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(revealed.apiKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="alert alert-warn key-reveal" role="status">
      <strong>Key de {revealed.name}</strong>
      <span>
        Guárdala ahora y entrégasela al negocio: no se vuelve a mostrar. Si se pierde, se
        rota.
      </span>
      <div className="key-value" data-testid="revealed-key">
        {revealed.apiKey}
      </div>
      <div className="toolbar">
        <button type="button" className="btn btn-secondary btn-small" onClick={copy}>
          {copied ? 'Copiada' : 'Copiar key'}
        </button>
        <button type="button" className="btn btn-small" onClick={onDismiss}>
          Ya la guardé
        </button>
      </div>
    </div>
  );
}

function SkillChecks({
  value,
  onChange,
}: {
  value: Skill[];
  onChange: (next: Skill[]) => void;
}) {
  return (
    <fieldset className="checks">
      <legend>Habilidades permitidas</legend>
      {SKILLS.map((skill) => (
        <label key={skill}>
          <input
            type="checkbox"
            checked={value.includes(skill)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...value, skill] : value.filter((s) => s !== skill),
              )
            }
          />
          <code className="inline">{skill}</code>
        </label>
      ))}
    </fieldset>
  );
}

function intInRange(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

function NewPartnerForm({
  operatorKey,
  onCreated,
  onFailure,
}: {
  operatorKey: string;
  onCreated: (created: PartnerWithKey) => Promise<void>;
  onFailure: (error: unknown) => void;
}) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [skills, setSkills] = useState<Skill[]>([...SKILLS]);
  const [rate, setRate] = useState('30');
  const [quota, setQuota] = useState('500');
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);

    if (!SLUG.test(slug)) {
      setProblem(
        'El identificador usa minúsculas, dígitos y guiones, empieza con una letra y tiene de 2 a 20 caracteres.',
      );
      return;
    }
    if (name.trim().length < 2) {
      setProblem('Escribe el nombre del negocio (mínimo 2 caracteres).');
      return;
    }
    if (skills.length === 0) {
      setProblem('Elige al menos una habilidad.');
      return;
    }
    const ratePerMinute = intInRange(rate, 1, 600);
    const dailyQuota = intInRange(quota, 1, 100_000);
    if (ratePerMinute === null || dailyQuota === null) {
      setProblem('El límite por minuto va de 1 a 600 y la cuota diaria de 1 a 100000.');
      return;
    }

    setLoading(true);
    try {
      const created = await api.admin.createPartner(operatorKey, {
        slug,
        name: name.trim(),
        skills,
        rate_per_minute: ratePerMinute,
        daily_quota: dailyQuota,
      });
      setSlug('');
      setName('');
      setSkills([...SKILLS]);
      await onCreated(created);
    } catch (e) {
      onFailure(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="row">
        <div className="field">
          <label htmlFor="slug">Identificador</label>
          <input
            id="slug"
            type="text"
            autoComplete="off"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <span className="hint">Ejemplo: concesionario. No se puede cambiar después.</span>
        </div>
        <div className="field">
          <label htmlFor="name">Nombre del negocio</label>
          <input
            id="name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="rate">Límite por minuto</label>
          <input
            id="rate"
            type="number"
            min={1}
            max={600}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="quota">Cuota diaria</label>
          <input
            id="quota"
            type="number"
            min={1}
            max={100000}
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
          />
        </div>
      </div>
      <SkillChecks value={skills} onChange={setSkills} />
      {problem && (
        <p className="alert alert-error" role="alert">
          {problem}
        </p>
      )}
      <div className="actions">
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Registrando…' : 'Registrar negocio'}
        </button>
      </div>
    </form>
  );
}

function PartnerEditor({
  operatorKey,
  partner,
  onSaved,
  onFailure,
  onClose,
}: {
  operatorKey: string;
  partner: Partner;
  onSaved: () => Promise<void>;
  onFailure: (error: unknown) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(partner.name);
  const [skills, setSkills] = useState<Skill[]>(partner.skills);
  const [rate, setRate] = useState(String(partner.rate_per_minute));
  const [quota, setQuota] = useState(String(partner.daily_quota));
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const ratePerMinute = intInRange(rate, 1, 600);
    const dailyQuota = intInRange(quota, 1, 100_000);
    if (name.trim().length < 2) {
      setProblem('Escribe el nombre del negocio (mínimo 2 caracteres).');
      return;
    }
    if (ratePerMinute === null || dailyQuota === null) {
      setProblem('El límite por minuto va de 1 a 600 y la cuota diaria de 1 a 100000.');
      return;
    }

    setLoading(true);
    try {
      await api.admin.updatePartner(operatorKey, partner.id, {
        name: name.trim(),
        skills,
        rate_per_minute: ratePerMinute,
        daily_quota: dailyQuota,
      });
      await onSaved();
    } catch (e) {
      onFailure(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form card" onSubmit={submit} noValidate aria-label={`Permisos de ${partner.name}`}>
      <h2>Permisos y límites de {partner.name}</h2>
      <div className="field">
        <label htmlFor="edit-name">Nombre</label>
        <input
          id="edit-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="edit-rate">Límite por minuto</label>
          <input
            id="edit-rate"
            type="number"
            min={1}
            max={600}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="edit-quota">Cuota diaria</label>
          <input
            id="edit-quota"
            type="number"
            min={1}
            max={100000}
            value={quota}
            onChange={(e) => setQuota(e.target.value)}
          />
        </div>
      </div>
      <SkillChecks value={skills} onChange={setSkills} />
      {problem && (
        <p className="alert alert-error" role="alert">
          {problem}
        </p>
      )}
      <div className="actions">
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function statusBadge(status: string): string {
  if (status === 'completed') return 'badge-ok';
  if (status === 'error') return 'badge-bad';
  return 'badge-warn';
}

function ExchangesPanel({
  operatorKey,
  partner,
  onFailure,
  onClose,
}: {
  operatorKey: string;
  partner: Partner;
  onFailure: (error: unknown) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Exchange[] | null>(null);

  // Se carga al mostrarse y cada vez que se elige otro negocio. Si el panel se cierra
  // o cambia de negocio antes de que llegue la respuesta, esa respuesta se descarta.
  useEffect(() => {
    let active = true;
    setRows(null);
    api.admin
      .exchanges(operatorKey, partner.id)
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setRows([]);
        onFailure(e);
      });
    return () => {
      active = false;
    };
    // onFailure cambia en cada render del padre; la carga solo depende del negocio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorKey, partner.id]);

  return (
    <section className="card" aria-label={`Intercambios de ${partner.name}`}>
      <div className="toolbar">
        <h2>Intercambios de {partner.name}</h2>
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
          Cerrar
        </button>
      </div>
      {rows === null ? (
        <p className="muted">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Este negocio todavía no ha hecho solicitudes.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Habilidad</th>
                <th>Resultado</th>
                <th className="num">ms</th>
                <th>Resumen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.created_at)}</td>
                  <td>
                    <code className="inline">{row.skill}</code>
                  </td>
                  <td>
                    <span className={`badge ${statusBadge(row.status)}`}>{row.status}</span>
                    {row.error_code && (
                      <>
                        <br />
                        <code className="inline">{row.error_code}</code>
                      </>
                    )}
                  </td>
                  <td className="num">{row.latency_ms}</td>
                  <td>{row.summary ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
