import { useState, type FormEvent } from 'react';
import { ApiError, api, type PublicReceipt } from '../lib/api';
import { METHOD_LABELS, formatCop, formatDate } from '../lib/format';

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const wait = error.retryAfterSeconds
        ? ` Intenta de nuevo en ${Math.ceil(error.retryAfterSeconds / 60) || 1} min.`
        : '';
      return `Hiciste demasiadas consultas.${wait}`;
    }
    if (error.code === 'RECEIPT_NOT_FOUND') {
      return 'No encontramos un comprobante con esos datos. Revisa el número y el documento.';
    }
    if (error.status === 0) return error.message;
    if (error.status === 400) {
      return 'Revisa los datos: el número debe ser mayor que 0 y el documento solo lleva dígitos.';
    }
  }
  return 'No pudimos verificar el comprobante. Intenta de nuevo en unos minutos.';
}

// El código QR del PDF lleva el número en el enlace (#/comprobantes?numero=12).
function numberFromLink(): string {
  const query = window.location.hash.split('?')[1] ?? '';
  const value = new URLSearchParams(query).get('numero') ?? '';
  return /^\d{1,10}$/.test(value) ? value : '';
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function VerifyReceipt() {
  const [number, setNumber] = useState(numberFromLink);
  const [documentNumber, setDocumentNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function download() {
    if (!receipt) return;
    setError(null);
    setDownloading(true);
    try {
      const pdf = await api.receiptPdf(receipt.receipt_number, documentNumber);
      saveBlob(pdf, `comprobante-${receipt.receipt_number}.pdf`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setReceipt(null);

    const parsed = Number(number);
    if (
      !/^\d+$/.test(number.trim()) ||
      !Number.isSafeInteger(parsed) ||
      parsed < 1
    ) {
      setError('Escribe el número del comprobante (un entero mayor que 0).');
      return;
    }
    if (documentNumber.replace(/\D/g, '').length < 5) {
      setError('Escribe el documento del cliente (al menos 5 dígitos).');
      return;
    }

    setLoading(true);
    try {
      setReceipt(await api.verifyReceipt(parsed, documentNumber));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="titulo">
      <h1 id="titulo">Verificar un comprobante</h1>
      <p className="muted">
        Comprueba que un comprobante es auténtico con su número y el documento
        del cliente al que se emitió.
      </p>

      <form className="form card" onSubmit={submit} noValidate>
        <div className="row">
          <div className="field">
            <label htmlFor="numero">Número del comprobante</label>
            <input
              id="numero"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              aria-invalid={error !== null && number.trim() === ''}
            />
          </div>
          <div className="field">
            <label htmlFor="documento">Documento del cliente</label>
            <input
              id="documento"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
            />
            <span className="hint">
              Solo dígitos; se aceptan puntos y espacios.
            </span>
          </div>
        </div>
        <div className="actions">
          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'Verificando…' : 'Verificar'}
          </button>
        </div>
      </form>

      <div aria-live="polite" className="stack result">
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {receipt && (
          <ReceiptCard
            receipt={receipt}
            onDownload={download}
            downloading={downloading}
          />
        )}
      </div>
    </section>
  );
}

function ReceiptCard({
  receipt,
  onDownload,
  downloading,
}: {
  receipt: PublicReceipt;
  onDownload: () => void;
  downloading: boolean;
}) {
  return (
    <article className="card receipt" aria-label="Comprobante verificado">
      <p className="alert alert-ok">Comprobante auténtico.</p>
      <h2>Comprobante N.º {receipt.receipt_number}</h2>
      <dl>
        <dt>Emitido por</dt>
        <dd>{receipt.issued_by}</dd>
        <dt>Fecha</dt>
        <dd>{formatDate(receipt.issued_at)}</dd>
        <dt>Cliente</dt>
        <dd>{receipt.customer_document}</dd>
        {receipt.payment && (
          <>
            <dt>Pago</dt>
            <dd>
              {METHOD_LABELS[receipt.payment.method] ?? receipt.payment.method}{' '}
              por {formatCop(receipt.payment.amount)}
            </dd>
          </>
        )}
      </dl>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ítem</th>
              <th className="num">Cant.</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item, index) => (
              <tr key={`${item.description}-${index}`}>
                <td>{item.description}</td>
                <td className="num">{item.quantity}</td>
                <td className="num">{formatCop(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="totals">
        <span>Subtotal {formatCop(receipt.subtotal)}</span>
        <span>Impuesto {formatCop(receipt.tax_amount)}</span>
        <strong>Total {formatCop(receipt.total)}</strong>
      </div>

      <div className="actions receipt-actions">
        <button
          className="btn"
          type="button"
          onClick={onDownload}
          disabled={downloading}
        >
          {downloading ? 'Preparando el PDF…' : 'Descargar PDF'}
        </button>
      </div>
    </article>
  );
}
