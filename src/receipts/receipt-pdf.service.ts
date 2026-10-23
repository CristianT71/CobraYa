import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { amountInWords } from './amount-in-words';
import { formatCop, formatRate } from './format-cop';
import type { ReceiptDocument } from './receipt-document';

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#dbe2ef';
const BRAND = '#312e81';
const BRAND_SOFT = '#eef2ff';
const OK = '#166534';
const OK_SOFT = '#ecfdf5';

const METHODS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

const DATE_FORMAT = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'long',
  timeZone: 'America/Bogota',
});
const TIME_FORMAT = new Intl.DateTimeFormat('es-CO', {
  timeStyle: 'short',
  timeZone: 'America/Bogota',
});

type Pdf = PDFKit.PDFDocument;

// Dibuja el comprobante en PDF (A4) con la estructura de una factura: emisor, cliente,
// ítems, totales, valor en letras y código QR de verificación. No inventa nada que no
// esté en la base ni imita documentos oficiales: sin logo ni CUFE ni resolución de la
// DIAN, y el pie dice que no es factura electrónica.
@Injectable()
export class ReceiptPdfService {
  constructor(private readonly config: ConfigService) {}

  async render(doc: ReceiptDocument): Promise<Buffer> {
    const base = this.config.getOrThrow<string>('a2a.publicBaseUrl');
    const verifyUrl = `${base}/#/comprobantes?numero=${doc.receiptNumber}`;
    const qr = await QRCode.toBuffer(verifyUrl, {
      margin: 1,
      width: 240,
      errorCorrectionLevel: 'M',
    });

    return new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `Comprobante de pago N° ${doc.receiptNumber}`,
          Author: doc.issuerName,
          Subject: 'Comprobante de pago',
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
    pdf: Pdf,
    doc: ReceiptDocument,
    qr: Buffer,
    verifyUrl: string,
  ): void {
    const left = pdf.page.margins.left;
    const right = pdf.page.width - pdf.page.margins.right;
    const width = right - left;

    this.header(pdf, doc, left, width);
    let y = this.parties(pdf, doc, left, width);
    y = this.items(pdf, doc, left, right, width, y);

    // Los totales y la verificación van juntos: si la tabla llegó muy abajo,
    // pasan a una página nueva.
    if (y > pdf.page.height - 330) {
      pdf.addPage();
      y = pdf.page.margins.top;
    }
    this.totals(pdf, doc, left, right, width, y + 16);
    this.verification(pdf, qr, verifyUrl, left, right, width);
  }

  private header(pdf: Pdf, doc: ReceiptDocument, left: number, width: number) {
    pdf.rect(0, 0, pdf.page.width, 8).fill(BRAND);

    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(21)
      .text(doc.issuerName, left, 34, { width: width * 0.58 });
    pdf
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text('Comprobante emitido con Facturación y Pagos', left, 62, {
        width: width * 0.58,
      });

    const boxW = width * 0.36;
    const boxX = left + width - boxW;
    pdf.roundedRect(boxX, 30, boxW, 62, 8).lineWidth(1.2).stroke(BRAND);
    pdf
      .fillColor(BRAND)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('COMPROBANTE DE PAGO', boxX, 40, { width: boxW, align: 'center' });
    pdf
      .fontSize(24)
      .text(`N° ${String(doc.receiptNumber).padStart(6, '0')}`, boxX, 56, {
        width: boxW,
        align: 'center',
      });
  }

  // Dos fichas: datos del cliente y datos del comprobante. Devuelve la y siguiente.
  private parties(
    pdf: Pdf,
    doc: ReceiptDocument,
    left: number,
    width: number,
  ): number {
    const top = 112;
    const gap = 14;
    const cardW = (width - gap) / 2;

    const card = (
      x: number,
      title: string,
      rows: Array<[string, string]>,
    ): void => {
      pdf.roundedRect(x, top, cardW, 96, 8).lineWidth(1).stroke(LINE);
      pdf
        .fillColor(BRAND)
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text(title, x + 14, top + 12);
      let ry = top + 30;
      for (const [label, value] of rows) {
        pdf
          .fillColor(MUTED)
          .font('Helvetica')
          .fontSize(8.5)
          .text(label, x + 14, ry, { width: 78 });
        pdf
          .fillColor(INK)
          .font('Helvetica-Bold')
          .fontSize(9.5)
          .text(value, x + 94, ry - 1, { width: cardW - 108, ellipsis: true });
        ry += 16;
      }
    };

    const when = doc.issuedAt;
    card(left, 'DATOS DEL CLIENTE', [
      ['Nombre', doc.customer.fullName],
      [
        'Documento',
        `${doc.customer.documentType} ${doc.customer.documentNumber}`,
      ],
    ]);
    card(left + cardW + gap, 'DATOS DEL COMPROBANTE', [
      ['Fecha', DATE_FORMAT.format(when)],
      ['Hora', TIME_FORMAT.format(when)],
      ['Cuenta', doc.accountRef],
      ['Pedido', doc.externalRef ?? '—'],
    ]);
    return top + 96 + 22;
  }

  private items(
    pdf: Pdf,
    doc: ReceiptDocument,
    left: number,
    right: number,
    width: number,
    startY: number,
  ): number {
    const colIdx = left + 8;
    const colDesc = left + 34;
    const descW = width * 0.46;
    const colQty = left + width * 0.55;
    const colUnit = left + width * 0.64;
    const colTotal = left + width * 0.82;
    const numW = width * 0.18;

    const head = (y: number): number => {
      pdf.rect(left, y, width, 24).fill(BRAND);
      pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
      pdf.text('#', colIdx, y + 8);
      pdf.text('DESCRIPCIÓN', colDesc, y + 8);
      pdf.text('CANT.', colQty, y + 8, { width: width * 0.08, align: 'right' });
      pdf.text('VALOR UNITARIO', colUnit, y + 8, {
        width: numW - 8,
        align: 'right',
      });
      pdf.text('VALOR TOTAL', colTotal, y + 8, {
        width: numW - 8,
        align: 'right',
      });
      return y + 24;
    };

    let y = head(startY);
    pdf.font('Helvetica').fontSize(9.5);
    doc.items.forEach((item, index) => {
      const height = Math.max(
        26,
        pdf.heightOfString(item.description, { width: descW }) + 16,
      );
      if (y + height > pdf.page.height - 90) {
        pdf.addPage();
        y = head(pdf.page.margins.top);
      }
      if (index % 2 === 1) pdf.rect(left, y, width, height).fill(BRAND_SOFT);
      pdf.fillColor(MUTED).text(String(index + 1), colIdx, y + 8);
      pdf.fillColor(INK).text(item.description, colDesc, y + 8, {
        width: descW,
      });
      pdf.text(String(item.quantity), colQty, y + 8, {
        width: width * 0.08,
        align: 'right',
      });
      pdf.text(formatCop(item.unitPrice), colUnit, y + 8, {
        width: numW - 8,
        align: 'right',
      });
      pdf.text(formatCop(item.lineTotal), colTotal, y + 8, {
        width: numW - 8,
        align: 'right',
      });
      y += height;
    });
    pdf.moveTo(left, y).lineTo(right, y).lineWidth(1).stroke(LINE);
    return y;
  }

  private totals(
    pdf: Pdf,
    doc: ReceiptDocument,
    left: number,
    right: number,
    width: number,
    top: number,
  ): void {
    // Izquierda: valor en letras y estado del pago.
    const leftW = width * 0.5;
    pdf.roundedRect(left, top, leftW, 66, 8).lineWidth(1).stroke(LINE);
    pdf
      .fillColor(BRAND)
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text('VALOR EN LETRAS', left + 14, top + 11);
    pdf
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(9)
      .text(`SON: ${amountInWords(doc.total)}`, left + 14, top + 26, {
        width: leftW - 28,
      });

    if (doc.payment) {
      const payY = top + 76;
      pdf.roundedRect(left, payY, leftW, 44, 8).fill(OK_SOFT);
      pdf
        .fillColor(OK)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text('PAGADO', left + 14, payY + 9);
      pdf
        .font('Helvetica')
        .fontSize(9)
        .text(
          `${METHODS[doc.payment.method] ?? doc.payment.method} · ${formatCop(doc.payment.amount)}`,
          left + 14,
          payY + 25,
        );
    }

    // Derecha: subtotal, impuesto y total.
    const boxX = left + width * 0.56;
    const boxW = right - boxX;
    let y = top;
    const row = (label: string, value: string) => {
      pdf
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(9.5)
        .text(label, boxX, y, { width: boxW * 0.6 });
      pdf.fillColor(INK).text(value, boxX, y, { width: boxW, align: 'right' });
      y += 20;
    };
    row('Subtotal', formatCop(doc.subtotal));
    row(`Impuesto (${formatRate(doc.taxRate)})`, formatCop(doc.taxAmount));
    pdf.roundedRect(boxX - 10, y, boxW + 10, 38, 8).fill(BRAND);
    pdf
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('TOTAL', boxX + 2, y + 13);
    pdf.fontSize(16).text(formatCop(doc.total), boxX, y + 10, {
      width: boxW - 12,
      align: 'right',
    });
    y += 48;
    if (doc.payment) {
      pdf
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(9.5)
        .text('Valor pagado', boxX, y, { width: boxW * 0.6 });
      pdf.fillColor(INK).text(formatCop(doc.payment.amount), boxX, y, {
        width: boxW,
        align: 'right',
      });
    }
  }

  private verification(
    pdf: Pdf,
    qr: Buffer,
    verifyUrl: string,
    left: number,
    right: number,
    width: number,
  ): void {
    const footY = pdf.page.height - 190;
    pdf.moveTo(left, footY).lineTo(right, footY).lineWidth(1).stroke(LINE);
    pdf.image(qr, left, footY + 14, { width: 100 });
    pdf
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('Verifica este comprobante', left + 118, footY + 22);
    pdf
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        'Escanea el código o entra al enlace e ingresa el número del comprobante y el documento del cliente. Así confirmas que es auténtico y que los valores coinciden.',
        left + 118,
        footY + 40,
        { width: width - 118 },
      );
    pdf.fillColor(BRAND).text(verifyUrl, left + 118, footY + 82, {
      width: width - 118,
      link: verifyUrl,
    });
    pdf
      .fillColor(MUTED)
      .fontSize(7.5)
      .text(
        'Comprobante de pago emitido con Facturación y Pagos. No es una factura electrónica de venta ni un documento soporte tributario.',
        left,
        pdf.page.height - 72,
        { width, align: 'center' },
      );
  }
}
