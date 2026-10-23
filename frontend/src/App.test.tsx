import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { CodeBlock } from './components/CodeBlock';
import { SERVICE_INFO, mockFetch } from './test/helpers';

function serve(options: { info?: boolean; healthy?: boolean } = {}) {
  const { info = true, healthy = true } = options;
  return mockFetch((call) => {
    if (call.url === '/public/info') {
      return info ? { body: SERVICE_INFO } : new Error('offline');
    }
    if (call.url === '/health') {
      return healthy ? { body: { status: 'ok' } } : { status: 503, body: { status: 'error' } };
    }
    return { status: 404, body: {} };
  });
}

function go(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

describe('App: enrutado', () => {
  it('empieza en la portada', async () => {
    serve();
    render(<App />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Facturación y Pagos' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page');
  });

  it.each([
    ['#/negocios', 'Para negocios', 'Para negocios'],
    ['#/comprobantes', 'Verificar un comprobante', 'Verificar comprobante'],
    ['#/panel', 'Panel del operador', 'Panel'],
  ])('%s muestra su página y marca la sección activa', async (hash, heading, navLabel) => {
    serve();
    render(<App />);

    go(hash);

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: navLabel })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current');
  });

  it('una ruta desconocida vuelve a la portada', async () => {
    serve();
    render(<App />);

    go('#/no-existe');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Facturación y Pagos' }),
    ).toBeInTheDocument();
  });

  it('empieza en la sección que indica la dirección al cargar', async () => {
    window.location.hash = '#/comprobantes';
    serve();
    render(<App />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Verificar un comprobante' }),
    ).toBeInTheDocument();
  });

  it('los enlaces del menú navegan sin recargar la página', async () => {
    serve();
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('link', { name: 'Para negocios' }));

    expect(window.location.hash).toBe('#/negocios');
  });

  it('tiene enlace para saltar al contenido y un único contenido principal', () => {
    serve();
    render(<App />);

    expect(screen.getByRole('link', { name: 'Saltar al contenido' })).toHaveAttribute(
      'href',
      '#contenido',
    );
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});

describe('App: portada', () => {
  it('muestra el alcance y las habilidades que informa el servicio', async () => {
    serve();
    render(<App />);

    expect(await screen.findByText('Cuentas de cobro con cálculo exacto')).toBeInTheDocument();
    expect(screen.getByText('Facturación electrónica ni DIAN')).toBeInTheDocument();
    expect(await screen.findByText('Entiende frases en español.')).toBeInTheDocument();
  });

  it('si el servicio no responde igual muestra el alcance (no queda vacía) y oculta las habilidades', async () => {
    serve({ info: false });
    render(<App />);

    expect(await screen.findByText(/Contabilidad \(libros, balances/)).toBeInTheDocument();
    expect(screen.queryByText('Habilidades disponibles')).not.toBeInTheDocument();
  });

  it('deja claro que somos facturación y no contabilidad', async () => {
    serve();
    render(<App />);

    expect(
      await screen.findByText(/Somos facturación: cobrar y comprobar\. No somos un sistema contable\./),
    ).toBeInTheDocument();
  });

  it('ofrece los dos caminos principales', async () => {
    serve();
    render(<App />);

    expect(await screen.findByRole('link', { name: 'Conectar mi negocio' })).toHaveAttribute(
      'href',
      '#/negocios',
    );
    expect(screen.getByRole('link', { name: 'Verificar un comprobante' })).toHaveAttribute(
      'href',
      '#/comprobantes',
    );
  });
});

describe('App: estado del servicio', () => {
  it('indica que el servicio está disponible', async () => {
    serve({ healthy: true });
    render(<App />);

    expect(await screen.findByText('Servicio disponible')).toBeInTheDocument();
  });

  it('indica que el servicio no está disponible', async () => {
    serve({ healthy: false });
    render(<App />);

    expect(await screen.findByText('Servicio no disponible')).toBeInTheDocument();
  });

  it('aclara en el pie que es un proyecto educativo', async () => {
    serve();
    render(<App />);

    expect(await screen.findByText(/Proyecto educativo/)).toHaveTextContent(/pagos son simulados/);
  });
});

describe('CodeBlock', () => {
  it('muestra el código y lo copia al portapapeles', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CodeBlock label="Ejemplo" code={'curl -X POST /a2a/tasks'} />);

    expect(screen.getByLabelText('Ejemplo')).toHaveTextContent('curl -X POST /a2a/tasks');
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(writeText).toHaveBeenCalledWith('curl -X POST /a2a/tasks');
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeInTheDocument();
  });

  it('si el navegador no deja copiar, lo avisa en vez de fallar', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denegado')) },
      configurable: true,
    });
    render(<CodeBlock label="Ejemplo" code="x" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'No se pudo copiar' })).toBeInTheDocument(),
    );
  });
});
