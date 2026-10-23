import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Exchange, Partner } from '../lib/api';
import { PARTNER, mockFetch, notFoundEnvelope } from '../test/helpers';
import { Admin } from './Admin';

const OPERATOR_KEY = 'clave-de-servicio-secreta';
const NEW_KEY = `fac_${'N'.repeat(43)}`;
const ROTATED_KEY = `fac_${'R'.repeat(43)}`;

interface ServerOptions {
  partners?: Partner[];
  exchanges?: Exchange[];
  createReply?: { status: number; body: unknown };
  failExchanges?: boolean;
  unauthorized?: boolean;
}

// Servicio de pruebas con estado: los cambios se reflejan al volver a listar.
function serveAdmin(options: ServerOptions = {}) {
  const partners: Partner[] = options.partners ?? [{ ...PARTNER } as Partner];
  const server = mockFetch((call) => {
    if (call.headers['x-api-key'] !== OPERATOR_KEY || options.unauthorized) {
      return { status: 401, body: notFoundEnvelope('UNAUTHORIZED') };
    }
    const [, id, action] = /^\/admin\/partners(?:\/([^/?]+))?(?:\/([^?]+))?/.exec(call.url) ?? [];

    if (call.method === 'GET' && !id) return { body: partners };
    if (call.method === 'POST' && !id) {
      if (options.createReply) return options.createReply;
      const body = call.body as Partial<Partner>;
      const created = { ...PARTNER, id: 'new-id', slug: body.slug, name: body.name } as Partner;
      partners.push(created);
      return { status: 201, body: { partner: created, api_key: NEW_KEY, warning: 'Guarda esta key.' } };
    }
    if (call.method === 'PATCH' && id) {
      const target = partners.find((p) => p.id === id);
      Object.assign(target ?? {}, call.body);
      return { body: target };
    }
    if (call.method === 'POST' && action === 'rotate-key') {
      return {
        body: {
          partner: partners.find((p) => p.id === id),
          api_key: ROTATED_KEY,
          warning: 'Guarda esta key.',
        },
      };
    }
    if (call.method === 'GET' && action?.startsWith('exchanges')) {
      if (options.failExchanges) return { status: 404, body: notFoundEnvelope('PARTNER_NOT_FOUND') };
      return { body: options.exchanges ?? [] };
    }
    return { status: 404, body: {} };
  });
  return { ...server, partners };
}

async function login(user = userEvent.setup()) {
  await user.type(screen.getByLabelText('Clave de servicio'), OPERATOR_KEY);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  return user;
}

const EXCHANGE: Exchange = {
  id: 'e1',
  request_id: 'r1',
  skill: 'crear_cuenta',
  status: 'rejected',
  error_code: 'CUSTOMER_NOT_FOUND',
  http_status: 200,
  latency_ms: 42,
  summary: 'Cóbrale a la cédula ****6789',
  created_at: '2026-10-23T15:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Admin: entrada', () => {
  it('pide la clave de servicio y no consulta nada si está vacía', async () => {
    const { calls } = serveAdmin();
    render(<Admin />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Escribe la clave de servicio');
    expect(calls).toHaveLength(0);
  });

  it('con una clave incorrecta avisa y no muestra el panel', async () => {
    serveAdmin({ unauthorized: true });
    render(<Admin />);

    await login();

    expect(await screen.findByRole('alert')).toHaveTextContent('La clave de servicio no es válida');
    expect(screen.queryByText('Registrar un negocio')).not.toBeInTheDocument();
  });

  it('con la clave correcta muestra los negocios, enviándola solo en X-API-Key', async () => {
    const { calls } = serveAdmin();
    render(<Admin />);

    await login();

    expect(await screen.findByText('AutoMax Concesionario')).toBeInTheDocument();
    expect(screen.getByText('1 negocio registrado.')).toBeInTheDocument();
    expect(screen.getByText('fac_AbCd…')).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ url: '/admin/partners', headers: { 'x-api-key': OPERATOR_KEY } });
    expect(calls[0].url).not.toContain(OPERATOR_KEY);
  });

  it('la clave de servicio no se guarda en el navegador ni queda en la página', async () => {
    serveAdmin();
    render(<Admin />);

    await login();
    await screen.findByText('AutoMax Concesionario');

    expect(JSON.stringify({ ...window.localStorage })).not.toContain(OPERATOR_KEY);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(OPERATOR_KEY);
    expect(document.body.textContent).not.toContain(OPERATOR_KEY);
  });

  it('"Salir" vuelve a pedir la clave y la olvida', async () => {
    serveAdmin();
    render(<Admin />);
    const user = await login();
    await screen.findByText('AutoMax Concesionario');

    await user.click(screen.getByRole('button', { name: 'Salir' }));

    expect(screen.getByLabelText('Clave de servicio')).toHaveValue('');
    expect(screen.queryByText('AutoMax Concesionario')).not.toBeInTheDocument();
  });

  it('sin negocios lo dice', async () => {
    serveAdmin({ partners: [] });
    render(<Admin />);

    await login();

    expect(await screen.findByText('Todavía no hay negocios registrados.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('Admin: registrar un negocio', () => {
  async function open() {
    const server = serveAdmin();
    render(<Admin />);
    const user = await login();
    await screen.findByText('AutoMax Concesionario');
    await user.click(screen.getByText('Registrar un negocio'));
    return { ...server, user };
  }

  it.each([
    ['un identificador con mayúsculas', 'Taller', 'Taller Falla', /identificador usa minúsculas/],
    ['un identificador con espacios', 'mi taller', 'Taller Falla', /identificador usa minúsculas/],
    ['un identificador de un carácter', 'a', 'Taller Falla', /identificador usa minúsculas/],
    ['un nombre demasiado corto', 'taller', 'T', /nombre del negocio/],
  ])('rechaza %s sin llamar al servicio', async (_name, slug, name, message) => {
    const { calls, user } = await open();
    const before = calls.length;

    await user.type(screen.getByLabelText('Identificador'), slug);
    await user.type(screen.getByLabelText('Nombre del negocio'), name);
    await user.click(screen.getByRole('button', { name: 'Registrar negocio' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(calls).toHaveLength(before);
  });

  it('exige al menos una habilidad', async () => {
    const { user } = await open();
    await user.type(screen.getByLabelText('Identificador'), 'taller');
    await user.type(screen.getByLabelText('Nombre del negocio'), 'Taller Falla');
    for (const box of screen.getAllByRole('checkbox')) await user.click(box);

    await user.click(screen.getByRole('button', { name: 'Registrar negocio' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('al menos una habilidad');
  });

  it.each([
    ['límite por minuto', '0', '500'],
    ['límite por minuto', '601', '500'],
    ['cuota diaria', '30', '0'],
    ['cuota diaria', '30', '100001'],
  ])('rechaza un %s fuera de rango (%s / %s)', async (_name, rate, quota) => {
    const { user } = await open();
    await user.type(screen.getByLabelText('Identificador'), 'taller');
    await user.type(screen.getByLabelText('Nombre del negocio'), 'Taller Falla');
    await user.clear(screen.getByLabelText('Límite por minuto'));
    await user.type(screen.getByLabelText('Límite por minuto'), rate);
    await user.clear(screen.getByLabelText('Cuota diaria'));
    await user.type(screen.getByLabelText('Cuota diaria'), quota);

    await user.click(screen.getByRole('button', { name: 'Registrar negocio' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/límite por minuto va de 1 a 600/);
  });

  it('registra el negocio y muestra su key una sola vez', async () => {
    const { calls, user } = await open();
    await user.type(screen.getByLabelText('Identificador'), 'taller');
    await user.type(screen.getByLabelText('Nombre del negocio'), '  Taller Falla ');

    await user.click(screen.getByRole('button', { name: 'Registrar negocio' }));

    const key = await screen.findByTestId('revealed-key');
    expect(key).toHaveTextContent(NEW_KEY);
    expect(screen.getByText(/no se vuelve a mostrar/i)).toBeInTheDocument();
    const create = calls.find((c) => c.method === 'POST');
    expect(create?.body).toEqual({
      slug: 'taller',
      name: 'Taller Falla',
      skills: [
        'lenguaje_natural',
        'registrar_cliente',
        'crear_cuenta',
        'registrar_pago',
        'consultar_cuenta',
        'consultar_comprobante',
      ],
      rate_per_minute: 30,
      daily_quota: 500,
    });
    // La lista se vuelve a pedir y ya incluye el negocio nuevo.
    expect(await screen.findByText('Taller Falla')).toBeInTheDocument();
    // El formulario se cierra solo para que la key nueva quede a la vista.
    expect(screen.getByText('Registrar un negocio').closest('details')).not.toHaveAttribute(
      'open',
    );
    // La key no aparece en la lista ni en el almacenamiento del navegador.
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(NEW_KEY);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(NEW_KEY);
  });

  it('"Ya la guardé" borra la key de la pantalla', async () => {
    const { user } = await open();
    await user.type(screen.getByLabelText('Identificador'), 'taller');
    await user.type(screen.getByLabelText('Nombre del negocio'), 'Taller Falla');
    await user.click(screen.getByRole('button', { name: 'Registrar negocio' }));
    await screen.findByTestId('revealed-key');

    await user.click(screen.getByRole('button', { name: 'Ya la guardé' }));

    expect(screen.queryByTestId('revealed-key')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(NEW_KEY);
  });

  it('copia la key al portapapeles', async () => {
    const { user } = await open();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    await user.type(screen.getByLabelText('Identificador'), 'taller');
    await user.type(screen.getByLabelText('Nombre del negocio'), 'Taller Falla');
    await user.click(screen.getByRole('button', { name: 'Registrar negocio' }));
    await screen.findByTestId('revealed-key');

    await user.click(screen.getByRole('button', { name: 'Copiar key' }));

    expect(writeText).toHaveBeenCalledWith(NEW_KEY);
    expect(await screen.findByRole('button', { name: 'Copiada' })).toBeInTheDocument();
  });

  it('un identificador repetido muestra un mensaje claro', async () => {
    serveAdmin({
      createReply: { status: 409, body: notFoundEnvelope('PARTNER_EXISTS', 'Ya existe.') },
    });
    render(<Admin />);
    const user = await login();
    await screen.findByText('AutoMax Concesionario');
    await user.click(screen.getByText('Registrar un negocio'));
    await user.type(screen.getByLabelText('Identificador'), 'concesionario');
    await user.type(screen.getByLabelText('Nombre del negocio'), 'Otro');

    await user.click(screen.getByRole('button', { name: 'Registrar negocio' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe un negocio con ese identificador',
    );
    expect(screen.queryByTestId('revealed-key')).not.toBeInTheDocument();
  });
});

describe('Admin: acciones sobre un negocio', () => {
  async function open(options: ServerOptions = {}) {
    const server = serveAdmin(options);
    render(<Admin />);
    const user = await login();
    await screen.findByText('AutoMax Concesionario');
    return { ...server, user };
  }

  it('desactiva y vuelve a activar al negocio', async () => {
    const { calls, user } = await open();

    await user.click(screen.getByRole('button', { name: 'Desactivar a AutoMax Concesionario' }));

    expect(await screen.findByText('Desactivado')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: `/admin/partners/${PARTNER.id}`,
      body: { active: false },
    });

    await user.click(screen.getByRole('button', { name: 'Activar a AutoMax Concesionario' }));

    expect(await screen.findByText('Activo')).toBeInTheDocument();
  });

  it('no rota la key si el operador cancela la confirmación', async () => {
    const { calls, user } = await open();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    await user.click(screen.getByRole('button', { name: 'Rotar la key de AutoMax Concesionario' }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('dejará de servir'));
    expect(calls.filter((c) => c.url.endsWith('rotate-key'))).toHaveLength(0);
    expect(screen.queryByTestId('revealed-key')).not.toBeInTheDocument();
  });

  it('rota la key al confirmar y muestra la nueva una sola vez', async () => {
    const { calls, user } = await open();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await user.click(screen.getByRole('button', { name: 'Rotar la key de AutoMax Concesionario' }));

    expect(await screen.findByTestId('revealed-key')).toHaveTextContent(ROTATED_KEY);
    expect(calls.filter((c) => c.url.endsWith('rotate-key'))).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Ya la guardé' }));
    expect(document.body.textContent).not.toContain(ROTATED_KEY);
  });

  it('edita permisos y límites', async () => {
    const { calls, user } = await open();

    await user.click(
      screen.getByRole('button', { name: 'Permisos y límites de AutoMax Concesionario' }),
    );
    const form = screen.getByRole('form', { name: 'Permisos de AutoMax Concesionario' });
    await user.click(within(form).getByRole('checkbox', { name: 'crear_cuenta' }));
    await user.clear(within(form).getByLabelText('Límite por minuto'));
    await user.type(within(form).getByLabelText('Límite por minuto'), '10');
    await user.click(within(form).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(screen.queryByRole('form', { name: /Permisos de/ })).not.toBeInTheDocument(),
    );
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toMatchObject({
      name: 'AutoMax Concesionario',
      rate_per_minute: 10,
      daily_quota: 500,
    });
    expect((patch?.body as { skills: string[] }).skills).not.toContain('crear_cuenta');
    expect((patch?.body as { skills: string[] }).skills).toHaveLength(5);
  });

  it('no deja guardar un límite fuera de rango', async () => {
    const { calls, user } = await open();
    await user.click(
      screen.getByRole('button', { name: 'Permisos y límites de AutoMax Concesionario' }),
    );
    const form = screen.getByRole('form', { name: 'Permisos de AutoMax Concesionario' });
    await user.clear(within(form).getByLabelText('Límite por minuto'));
    await user.type(within(form).getByLabelText('Límite por minuto'), '0');

    await user.click(within(form).getByRole('button', { name: 'Guardar cambios' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent(/de 1 a 600/);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('Cancelar cierra el editor sin guardar', async () => {
    const { calls, user } = await open();
    await user.click(
      screen.getByRole('button', { name: 'Permisos y límites de AutoMax Concesionario' }),
    );

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('form', { name: /Permisos de/ })).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('si la clave de servicio deja de valer durante una acción, vuelve a la entrada', async () => {
    const server = await open();
    server.partners.length = 0;
    mockFetch(() => ({ status: 401, body: notFoundEnvelope('UNAUTHORIZED') }));

    await server.user.click(
      screen.getByRole('button', { name: 'Desactivar a AutoMax Concesionario' }),
    );

    expect(await screen.findByLabelText('Clave de servicio')).toBeInTheDocument();
    expect(screen.queryByText('AutoMax Concesionario')).not.toBeInTheDocument();
  });
});

describe('Admin: intercambios', () => {
  async function open(options: ServerOptions = {}) {
    const server = serveAdmin(options);
    render(<Admin />);
    const user = await login();
    await screen.findByText('AutoMax Concesionario');
    return { ...server, user };
  }

  it('muestra los intercambios del negocio con su resultado y latencia', async () => {
    const { calls, user } = await open({ exchanges: [EXCHANGE] });

    await user.click(screen.getByRole('button', { name: 'Intercambios de AutoMax Concesionario' }));

    const panel = await screen.findByRole('region', { name: 'Intercambios de AutoMax Concesionario' });
    expect(await within(panel).findByText('crear_cuenta')).toBeInTheDocument();
    expect(within(panel).getByText('rejected')).toBeInTheDocument();
    expect(within(panel).getByText('CUSTOMER_NOT_FOUND')).toBeInTheDocument();
    expect(within(panel).getByText('42')).toBeInTheDocument();
    expect(within(panel).getByText('Cóbrale a la cédula ****6789')).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/exchanges'))?.url).toBe(
      `/admin/partners/${PARTNER.id}/exchanges?limit=20`,
    );
  });

  it('si el negocio no tiene intercambios lo dice', async () => {
    const { user } = await open({ exchanges: [] });

    await user.click(screen.getByRole('button', { name: 'Intercambios de AutoMax Concesionario' }));

    expect(await screen.findByText('Este negocio todavía no ha hecho solicitudes.')).toBeInTheDocument();
  });

  it('si falla la consulta lo avisa y no se queda cargando', async () => {
    const { user } = await open({ failExchanges: true });

    await user.click(screen.getByRole('button', { name: 'Intercambios de AutoMax Concesionario' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Cargando…')).not.toBeInTheDocument();
  });

  it('Cerrar oculta el panel', async () => {
    const { user } = await open({ exchanges: [EXCHANGE] });
    await user.click(screen.getByRole('button', { name: 'Intercambios de AutoMax Concesionario' }));
    const panel = await screen.findByRole('region', { name: 'Intercambios de AutoMax Concesionario' });
    await within(panel).findByText('crear_cuenta');

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(screen.queryByRole('region', { name: /Intercambios de/ })).not.toBeInTheDocument();
  });
});
