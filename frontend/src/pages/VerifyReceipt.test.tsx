import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RECEIPT, mockFetch, notFoundEnvelope } from '../test/helpers';
import { VerifyReceipt } from './VerifyReceipt';

async function fill(number: string, document: string) {
  const user = userEvent.setup();
  if (number) await user.type(screen.getByLabelText('Número del comprobante'), number);
  if (document) await user.type(screen.getByLabelText('Documento del cliente'), document);
  return user;
}

describe('VerifyReceipt', () => {
  it('pide los dos datos y no consulta nada si faltan', async () => {
    const { calls } = mockFetch(() => ({ body: RECEIPT }));
    render(<VerifyReceipt />);

    const user = await fill('', '');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/número del comprobante/i);
    expect(calls).toHaveLength(0);
  });

  it.each(['0', '-3', '1.5', 'abc', '99999999999999999999'])(
    'rechaza el número %s sin consultar',
    async (number) => {
      const { calls } = mockFetch(() => ({ body: RECEIPT }));
      render(<VerifyReceipt />);

      const user = await fill(number, '1032456789');
      await user.click(screen.getByRole('button', { name: 'Verificar' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/número del comprobante/i);
      expect(calls).toHaveLength(0);
    },
  );

  it('rechaza un documento demasiado corto sin consultar', async () => {
    const { calls } = mockFetch(() => ({ body: RECEIPT }));
    render(<VerifyReceipt />);

    const user = await fill('7', '123');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/documento del cliente/i);
    expect(calls).toHaveLength(0);
  });

  it('verifica el comprobante y muestra lo justo para comprobar que es auténtico', async () => {
    const { calls } = mockFetch(() => ({ body: RECEIPT }));
    render(<VerifyReceipt />);

    const user = await fill('7', '1.032.456.789');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByText('Comprobante N.º 7')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: '/public/receipts/verify',
      method: 'POST',
      body: { receipt_number: 7, document_number: '1.032.456.789' },
    });
    expect(screen.getByText('Comprobante auténtico.')).toBeInTheDocument();
    expect(screen.getByText('AutoMax Concesionario')).toBeInTheDocument();
    expect(screen.getByText('****6789')).toBeInTheDocument();
    expect(screen.getByText('Cambio de aceite')).toBeInTheDocument();
    expect(screen.getByText('Total $124.950')).toBeInTheDocument();
    expect(screen.getByText('Subtotal $105.000')).toBeInTheDocument();
    expect(screen.getByText('Impuesto $19.950')).toBeInTheDocument();
    expect(screen.getByText(/Efectivo por \$124\.950/)).toBeInTheDocument();
  });

  it('no manda a la API una key ni ningún dato aparte del número y el documento', async () => {
    const { calls } = mockFetch(() => ({ body: RECEIPT }));
    render(<VerifyReceipt />);

    const user = await fill('7', '1032456789');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));
    await screen.findByText('Comprobante N.º 7');

    expect(Object.keys(calls[0].body as object).sort()).toEqual([
      'document_number',
      'receipt_number',
    ]);
    expect(calls[0].headers).not.toHaveProperty('x-api-key');
    expect(calls[0].headers).not.toHaveProperty('authorization');
  });

  it('un comprobante inexistente o un documento equivocado muestran el mismo mensaje', async () => {
    mockFetch(() => ({ status: 404, body: notFoundEnvelope('RECEIPT_NOT_FOUND') }));
    render(<VerifyReceipt />);

    const user = await fill('7', '999999999');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No encontramos un comprobante con esos datos',
    );
    expect(screen.queryByText('Comprobante auténtico.')).not.toBeInTheDocument();
  });

  it('con demasiadas consultas avisa cuánto esperar', async () => {
    mockFetch(() => ({
      status: 429,
      body: notFoundEnvelope('RATE_LIMITED'),
      headers: { 'Retry-After': '900' },
    }));
    render(<VerifyReceipt />);

    const user = await fill('7', '1032456789');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/demasiadas consultas.*15 min/i);
  });

  it('si el servicio no responde lo dice sin mostrar detalles técnicos', async () => {
    mockFetch(() => new Error('ECONNREFUSED'));
    render(<VerifyReceipt />);

    const user = await fill('7', '1032456789');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo conectar con el servicio');
    expect(alert).not.toHaveTextContent('ECONNREFUSED');
  });

  it('un error 500 muestra un mensaje genérico', async () => {
    mockFetch(() => ({ status: 500, body: { status: 'error', message: 'stack interno' } }));
    render(<VerifyReceipt />);

    const user = await fill('7', '1032456789');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no pudimos verificar/i);
    expect(alert).not.toHaveTextContent('stack interno');
  });

  it('deshabilita el botón mientras consulta', async () => {
    let release: (() => void) | undefined;
    mockFetch(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ body: RECEIPT });
        }),
    );
    render(<VerifyReceipt />);

    const user = await fill('7', '1032456789');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByRole('button', { name: 'Verificando…' })).toBeDisabled();
    release?.();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Verificar' })).toBeEnabled(),
    );
  });

  it('una nueva consulta reemplaza el resultado anterior', async () => {
    let first = true;
    mockFetch(() => {
      if (first) {
        first = false;
        return { body: RECEIPT };
      }
      return { status: 404, body: notFoundEnvelope('RECEIPT_NOT_FOUND') };
    });
    render(<VerifyReceipt />);

    const user = await fill('7', '1032456789');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));
    await screen.findByText('Comprobante N.º 7');
    await user.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Comprobante N.º 7')).not.toBeInTheDocument();
  });
});
