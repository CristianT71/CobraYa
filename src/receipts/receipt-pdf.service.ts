import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { formatCop, formatRate } from './format-cop';
import type { ReceiptDocument } from './receipt-document';

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const BRAND = '#4338ca';

const METHODS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

const DATE_FORMAT = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Bogota',
});

// Dibuja el comprobante en PDF (A4). No inventa nada que no esté en la base: ni
// CUFE ni resolución de la DIAN. El código QR lleva a la verificación pública.
@Injectable()
export class ReceiptPdfService {
  constructor(private readonly config: ConfigService) {}

  async render(doc: ReceiptDocument): Promise<Buffer> {
    const base = this.config.getOrThrow<string>('a2a.publicBaseUrl');
    const verifyUrl = `${base}/#/comprobantes?numero=${doc.receiptNumber}`;
    const qr = await QRCode.toBuffer(verifyUrl, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
    });

    return new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({
        size: 'A4',
        margin: 48,
        info: {
          Title: `Comprobante de pago N° ${doc.receiptNumber}`,
          Author: doc.issuerName,
        },
      });
      const chunks: Buffer[] = [];
      pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      this.draw(pdf, doc, qr, verifyUrl);
      pdf.end();
    });
  }

  private draw(
    pdf: PDFKit.PDFDocument,
    doc: ReceiptDocument,
    qr: Buffer,
    verifyUrl: string,
  ): void {
    const left = pdf.page.margins.left;
    const right = pdf.page.width - pdf.page.margins.right;
    const width = right - left;

    // Encabezado
    pdf.rect(0, 0, pdf.page.width, 110).fill(BRAND);
    pdf
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(doc.issuerName, left, 38, { width: width * 0.6 });
    pdf
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#c7d2fe')
      .text('Comprobante de pago', left, 66);
    pdf
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#ffffff')
      .text('COMPROBANTE N°', left, 36, { width, align: 'right' });
    pdf
      .fontSize(24)
      .text(String(doc.receiptNumber).padStart(6, '0'), left, 52, {
        width,
        align: 'right',
      });

    // Datos del comprobante y del cliente
    let y = 140;
    pdf.fillColor(MUTED).font('Helvetica').fontSize(9);
    pdf.text('FECHA', left, y);
    pdf.text('CLIENTE', left + width / 2, y);
    pdf.fillColor(INK).fontSize(11);
    pdf.text(DATE_FORMAT.format(doc.issuedAt), left, y + 14, {
      width: width / 2 - 12,
    });
    pdf
      .font('Helvetica-Bold')
      .text(doc.customer.fullName, left + width / 2, y + 14, {
        width: width / 2,
      });
    pdf
      .font('Helvetica')
      .fillColor(MUTED)
      .text(
        `${doc.customer.documentType} ${doc.customer.documentNumber}`,
        left + width / 2,
        y + 30,
      );

    // Tabla de ítems
    y = 220;
    const colQty = left + width * 0.5;
    const colUnit = left + width * 0.62;
    const colTotal = left + width * 0.82;
    pdf.rect(left, y, width, 24).fill('#eef2ff');
    pdf.fillColor(BRAND).font('Helvetica-Bold').fontSize(9);
    pdf.text('DESCRIPCIÓN', left + 10, y + 8);
    pdf.text('CANT.', colQty, y + 8, { width: width * 0.1, align: 'right' });
    pdf.text('VALOR UNIT.', colUnit, y + 8, {
      width: width * 0.18,
      align: 'right',
    });
    pdf.text('TOTAL', colTotal, y + 8, {
      width: width * 0.18 - 10,
      align: 'right',
    });

    y += 24;
    pdf.font('Helvetica').fontSize(10).fillColor(INK);
    for (const item of doc.items) {
      const height = Math.max(
        24,
        pdf.heightOfString(item.description, { width: width * 0.46 }) + 14,
      );
      if (y + height > pdf.page.height - 90) {
        pdf.addPage();
        y = pdf.page.margins.top;
      }
      pdf.fillColor(INK).text(item.description, left + 10, y + 7, {
        width: width * 0.46,
      });
      pdf.text(String(item.quantity), colQty, y + 7, {
        width: width * 0.1,
        align: 'right',
      });
      pdf.text(formatCop(item.unitPrice), colUnit, y + 7, {
        width: width * 0.18,
        align: 'right',
      });
      pdf.text(formatCop(item.lineTotal), colTotal, y + 7, {
        width: width * 0.18 - 10,
        align: 'right',
      });
      y += height;
      pdf
        .moveTo(left, y)
        .lineTo(right, y)
        .strokeColor(LINE)
        .lineWidth(1)
        .stroke();
    }

    // Los totales y el bloque de verificación van en la misma página: si la tabla
    // llegó muy abajo, pasan a una página nueva.
    if (y > pdf.page.height - 280) {
      pdf.addPage();
      y = pdf.page.margins.top;
    }

    // Pago y totales: el recuadro de pago queda a la izquierda, los totales a la derecha.
    y += 18;
    const totalsTop = y;
    const labelX = left + width * 0.55;
    const valueW = right - labelX;
    const row = (label: string, value: string, bold = false) => {
      pdf
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 14 : 10)
        .fillColor(bold ? INK : MUTED)
        .text(label, labelX, y);
      pdf
        .fillColor(INK)
        .text(value, labelX, y, { width: valueW, align: 'right' });
      y += bold ? 26 : 18;
    };
    row('Subtotal', formatCop(doc.subtotal));
    row(`Impuesto (${formatRate(doc.taxRate)})`, formatCop(doc.taxAmount));
    pdf
      .moveTo(labelX, y)
      .lineTo(right, y)
      .strokeColor(INK)
      .lineWidth(1)
      .stroke();
    y += 10;
    row('TOTAL', formatCop(doc.total), true);

    if (doc.payment) {
      pdf.roundedRect(left, totalsTop, width * 0.45, 58, 8).fill('#ecfdf5');
      pdf
        .fillColor('#166534')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text('PAGADA', left + 14, totalsTop + 12);
      pdf
        .font('Helvetica')
        .fontSize(10)
        .text(
          `${METHODS[doc.payment.method] ?? doc.payment.method} · ${formatCop(doc.payment.amount)}`,
          left + 14,
          totalsTop + 30,
        );
    }

    // Verificación y nota al pie
    const footY = pdf.page.height - 190;
    pdf
      .moveTo(left, footY)
      .lineTo(right, footY)
      .strokeColor(LINE)
      .lineWidth(1)
      .stroke();
    pdf.image(qr, left, footY + 14, { width: 96 });
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('Verifica este comprobante', left + 112, footY + 20);
    pdf
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        'Escanea el código o entra al enlace e ingresa el número del comprobante y el documento del cliente.',
        left + 112,
        footY + 38,
        { width: width - 112 },
      );
    pdf.fillColor(BRAND).text(verifyUrl, left + 112, footY + 72, {
      width: width - 112,
      link: verifyUrl,
    });
    pdf
      .fillColor(MUTED)
      .fontSize(8)
      .text(
        'Comprobante de pago emitido con Facturación y Pagos. No es una factura electrónica de venta ni un documento soporte tributario.',
        left,
        pdf.page.height - 72,
        { width, align: 'center' },
      );
  }
}
