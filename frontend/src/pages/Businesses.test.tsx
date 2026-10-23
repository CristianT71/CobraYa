import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SKILLS } from '../lib/api';
import { SERVICE_INFO, mockFetch, notFoundEnvelope } from '../test/helpers';
import { Businesses, EXAMPLES } from './Businesses';

const COMPLETED = {
  status: 'completed',
  message: 'Cuenta de cobro creada y pagada en efectivo.',
  answer: 'Cuenta de cobro creada y pagada en efectivo. Total $124.950.',
  data: { invoice_id: 'abc' },
  missing_fields: [],
  request_id: 'r-1',
};

// El servicio de pruebas responde la información pública y, para las tareas, lo que se le indique.
function serve(
  task: (body: unknown) => { status?: number; body?: unknown } | Error,
) {
  return mockFetch((call) => {
    if (call.url === '/public/info') return { body: SERVICE_INFO };
    if (call.url === '/a2a/tasks') return task(call.body);
    return { status: 404, body: {} };
  });
}

const textarea = () =>
  screen.getByLabelText('Cuerpo de la tarea (JSON)') as HTMLTextAreaElement;

describe('Businesses: guía', () => {
  it('muestra las URLs reales del servicio en los ejemplos', async () => {
    serve(() => ({ body: COMPLETED }));
    render(<Businesses />);

    expect(
      (await screen.findAllByText(/facturacion\.example\.co\/a2a\/tasks/))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole('link', {
        name: 'https://facturacion.example.co/.well-known/agent.json',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Swagger' })).toHaveAttribute(
      'href',
      'https://facturacion.example.co/docs',
    );
  });

  it('explica cómo entregar el comprobante en PDF: enlace en la respuesta y descarga con la key', async () => {
    serve(() => ({ body: COMPLETED }));
    render(<Businesses />);

    expect(
      await screen.findByRole('heading', { name: 'El comprobante en PDF' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/pdf_url/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Vale 7 días/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/\/a2a\/receipts\/1\/pdf/).length,
    ).toBeGreaterThan(0);
  });

  it('da buenas prácticas para integrarse: idempotencia, key en el servidor, límites', async () => {
    serve(() => ({ body: COMPLETED }));
    render(<Businesses />);

    expect(
      await screen.findByRole('heading', { name: 'Buenas prácticas' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Una Idempotency-Key por acción del cliente'),
    ).toBeInTheDocument();
    expect(screen.getByText('La key va en tu servidor')).toBeInTheDocument();
    expect(screen.getByText(/no hay CORS/)).toBeInTheDocument();
    expect(screen.getByText(/90 segundos/)).toBeInTheDocument();
  });

  it('si el servicio no responde usa la dirección actual en vez de dejar la guía vacía', async () => {
    mockFetch(() => new Error('offline'));
    render(<Businesses />);

    expect(
      (
        await screen.findAllByText(
          new RegExp(`${window.location.origin}/a2a/tasks`),
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it('lista las seis habilidades con sus datos', async () => {
    serve(() => ({ body: COMPLETED }));
    render(<Businesses />);

    const table = (await screen.findAllByRole('table'))[0];
    for (const skill of SKILLS) {
      expect(table).toHaveTextContent(skill);
    }
    expect(table).toHaveTextContent(
      'document_type, document_number, full_name',
    );
  });

  it('explica los cuatro estados de la respuesta', async () => {
    serve(() => ({ body: COMPLETED }));
    render(<Businesses />);

    const tables = await screen.findAllByRole('table');
    for (const status of [
      'completed',
      'needs_clarification',
      'rejected',
      'error',
    ]) {
      expect(tables[1]).toHaveTextContent(status);
    }
  });

  it('los ejemplos de curl nunca traen una key real', async () => {
    serve(() => ({ body: COMPLETED }));
    render(<Businesses />);

    await screen.findAllByText(/facturacion\.example\.co/);
    const text = document.body.textContent ?? '';
    expect(text).toContain('fac_TU_KEY');
    expect(text).not.toMatch(/fac_[A-Za-z0-9_-]{43}/);
  });
});

describe('Businesses: consola de pruebas', () => {
  it('la key se escribe en un campo de contraseña', () => {
    serve(() => ({ body: COMPLETED }));
    render(<Businesses />);

    expect(screen.getByLabelText('Key de tu negocio')).toHaveAttribute(
      'type',
      'password',
    );
  });

  it('empieza con el ejemplo del contrato y cambia el cuerpo al elegir otra habilidad', async () => {
    serve(() => ({ body: COMPLETED }));
    render(<Businesses />);
    const user = userEvent.setup();

    expect(JSON.parse(textarea().value)).toEqual(
      EXAMPLES.lenguaje_natural.body,
    );

    await user.selectOptions(
      screen.getByLabelText('Habilidad'),
      'crear_cuenta',
    );

    expect(JSON.parse(textarea().value)).toEqual(EXAMPLES.crear_cuenta.body);
  });

  it('pide la key antes de enviar y no llama al servicio', async () => {
    const { calls } = serve(() => ({ body: COMPLETED }));
    render(<Businesses />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Enviar tarea' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /key de tu negocio/i,
    );
    expect(calls.filter((c) => c.url === '/a2a/tasks')).toHaveLength(0);
  });

  it('avisa si el cuerpo no es un JSON válido y no envía nada', async () => {
    const { calls } = serve(() => ({ body: COMPLETED }));
    render(<Businesses />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Key de tu negocio'), 'fac_clave');
    fireEvent.change(textarea(), {
      target: { value: '{ "message": "falta cerrar' },
    });
    await user.click(screen.getByRole('button', { name: 'Enviar tarea' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /no es un JSON válido/i,
    );
    expect(textarea()).toHaveAttribute('aria-invalid', 'true');
    expect(calls.filter((c) => c.url === '/a2a/tasks')).toHaveLength(0);
  });

  it('envía la tarea con la key y la Idempotency-Key, y muestra el answer y la respuesta', async () => {
    const { calls } = serve(() => ({ body: COMPLETED }));
    render(<Businesses />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Key de tu negocio'), 'fac_clave');
    const idem = (screen.getByLabelText('Idempotency-Key') as HTMLInputElement)
      .value;
    await user.click(screen.getByRole('button', { name: 'Enviar tarea' }));

    expect(await screen.findByText('HTTP 200')).toHaveClass('badge-ok');
    expect(
      screen.getByText(COMPLETED.answer, { selector: 'p' }),
    ).toBeInTheDocument();
    const sent = calls.find((c) => c.url === '/a2a/tasks');
    expect(sent).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer fac_clave',
        'idempotency-key': idem,
      },
      body: EXAMPLES.lenguaje_natural.body,
    });
    expect(idem).toMatch(/^web-/);
  });

  it('muestra los errores del servicio con su código HTTP en rojo', async () => {
    serve(() => ({
      status: 403,
      body: notFoundEnvelope('SKILL_NOT_ALLOWED', 'Sin permiso.'),
    }));
    render(<Businesses />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Key de tu negocio'), 'fac_clave');
    await user.click(screen.getByRole('button', { name: 'Enviar tarea' }));

    expect(await screen.findByText('HTTP 403')).toHaveClass('badge-bad');
    // La guía también tiene un bloque "Respuesta" (el ejemplo): el de la consola es el último.
    expect(screen.getAllByLabelText('Respuesta').at(-1)).toHaveTextContent(
      'SKILL_NOT_ALLOWED',
    );
  });

  it('si no hay conexión muestra un aviso y no deja resultados viejos', async () => {
    let first = true;
    serve(() => {
      if (first) {
        first = false;
        return { body: COMPLETED };
      }
      return new Error('offline');
    });
    render(<Businesses />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Key de tu negocio'), 'fac_clave');

    await user.click(screen.getByRole('button', { name: 'Enviar tarea' }));
    await screen.findByText('HTTP 200');
    await user.click(screen.getByRole('button', { name: 'Enviar tarea' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo conectar',
    );
    expect(screen.queryByText('HTTP 200')).not.toBeInTheDocument();
  });

  it('"Generar otra" cambia la Idempotency-Key', async () => {
    serve(() => ({ body: COMPLETED }));
    render(<Businesses />);
    const user = userEvent.setup();
    const field = screen.getByLabelText('Idempotency-Key') as HTMLInputElement;
    const before = field.value;

    await user.click(screen.getByRole('button', { name: 'Generar otra' }));

    expect(field.value).not.toBe(before);
    expect(field.value).toMatch(/^web-/);
  });

  it('mientras envía deshabilita el botón', async () => {
    let release: (() => void) | undefined;
    mockFetch((call) => {
      if (call.url === '/public/info') return { body: SERVICE_INFO };
      return new Promise((resolve) => {
        release = () => resolve({ body: COMPLETED });
      }) as never;
    });
    render(<Businesses />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Key de tu negocio'), 'fac_clave');

    await user.click(screen.getByRole('button', { name: 'Enviar tarea' }));

    expect(
      await screen.findByRole('button', { name: 'Enviando…' }),
    ).toBeDisabled();
    release?.();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Enviar tarea' }),
      ).toBeEnabled(),
    );
  });

  it('la key no se guarda en el navegador ni se incluye en la página', async () => {
    serve(() => ({ body: COMPLETED }));
    render(<Businesses />);
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText('Key de tu negocio'),
      'fac_clave_secreta_123',
    );
    await user.click(screen.getByRole('button', { name: 'Enviar tarea' }));
    await screen.findByText('HTTP 200');

    expect(JSON.stringify({ ...window.localStorage })).not.toContain(
      'clave_secreta',
    );
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(
      'clave_secreta',
    );
    expect(document.body.textContent).not.toContain('clave_secreta');
  });
});
