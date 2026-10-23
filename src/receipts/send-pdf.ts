import type { Response } from 'express';

// Entrega un PDF como descarga. Sin caché: el comprobante lleva datos del cliente.
export function sendPdf(
  res: Response,
  pdf: Buffer,
  receiptNumber: number,
): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="comprobante-${receiptNumber}.pdf"`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', String(pdf.length));
  res.end(pdf);
}
