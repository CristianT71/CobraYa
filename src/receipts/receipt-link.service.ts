import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Siete días: lo bastante para que el cliente lo abra desde el chat, y no para siempre.
export const RECEIPT_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

const CONTEXT = 'receipt-link/v1:';

const b64url = (value: Buffer | string): string =>
  Buffer.from(value).toString('base64url');

/**
 * Enlaces firmados al PDF de un comprobante. Sirven para que el chat de otro negocio
 * le entregue a su cliente un enlace que abre sin key: la firma (HMAC con el secreto
 * del servidor) demuestra que lo emitimos nosotros, y lleva fecha de caducidad.
 * No se guarda nada en la base: el enlace se calcula y se verifica.
 */
@Injectable()
export class ReceiptLinkService {
  constructor(private readonly config: ConfigService) {}

  /** URL completa del PDF del comprobante, vigente por siete días. */
  urlFor(receiptNumber: number, nowMs = Date.now()): string {
    const base = this.config.getOrThrow<string>('a2a.publicBaseUrl');
    return `${base}/public/receipts/${this.issue(receiptNumber, nowMs)}/pdf`;
  }

  issue(receiptNumber: number, nowMs = Date.now()): string {
    const expires = Math.floor(nowMs / 1000) + RECEIPT_LINK_TTL_SECONDS;
    const payload = b64url(`${receiptNumber}.${expires}`);
    return `${payload}.${this.sign(payload)}`;
  }

  /** Número de comprobante del enlace, o null si es falso, está alterado o caducó. */
  verify(token: string, nowMs = Date.now()): number | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;

    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return null;
    }

    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    const match = /^(\d{1,10})\.(\d{1,12})$/.exec(decoded);
    if (!match) return null;
    const receiptNumber = Number(match[1]);
    const expires = Number(match[2]);
    if (receiptNumber < 1 || expires <= Math.floor(nowMs / 1000)) return null;
    return receiptNumber;
  }

  private sign(payload: string): string {
    const pepper = this.config.getOrThrow<string>('partners.keyPepper');
    return b64url(
      createHmac('sha256', pepper)
        .update(CONTEXT + payload)
        .digest(),
    );
  }
}
