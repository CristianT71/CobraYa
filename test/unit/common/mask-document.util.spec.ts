import {
  maskDocument,
  maskDocumentsInText,
  sanitizeForLog,
} from '../../../src/common/utils/mask-document.util';

describe('maskDocument', () => {
  it('deja solo los últimos 4 dígitos', () => {
    expect(maskDocument('1032456789')).toBe('****6789');
    expect(maskDocument('1.032.456.789')).toBe('****6789');
    expect(maskDocument(900123456)).toBe('****3456');
  });

  it('no falla con valores vacíos', () => {
    expect(maskDocument(null)).toBe('****');
    expect(maskDocument(undefined)).toBe('****');
  });
});

describe('maskDocumentsInText', () => {
  it('enmascara la cédula del ejemplo del contrato y conserva los montos', () => {
    const text =
      'Cóbrale a la cédula 1032456789 un cambio de aceite de 80.000 y un filtro de 25.000, pagó en efectivo';
    const masked = maskDocumentsInText(text);
    expect(masked).not.toContain('1032456789');
    expect(masked).toContain('cédula ****6789');
    expect(masked).toContain('80.000');
    expect(masked).toContain('25.000');
  });

  it.each([
    ['C.C. 1.032.456.789', '****6789'],
    ['cc 79 123 456', '****3456'],
    ['NIT 900123456-7', '****4567'],
    ['documento: 52.345.678', '****5678'],
    ['el cliente 1032456789 pagó', '****6789'],
  ])('enmascara "%s"', (text, expected) => {
    const masked = maskDocumentsInText(text);
    expect(masked).toContain(expected);
    expect(masked.replace(/\D/g, '').length).toBeLessThanOrEqual(4);
  });
});

describe('sanitizeForLog', () => {
  it('enmascara document_number, textos y oculta claves', () => {
    const result = sanitizeForLog({
      customer: { document_type: 'CC', document_number: '1032456789' },
      text: 'cédula 1032456789',
      headers: { 'x-api-key': 'secreta', authorization: 'Bearer abc' },
      amount: '80000.00',
    });
    expect(result).toEqual({
      customer: { document_type: 'CC', document_number: '****6789' },
      text: 'cédula ****6789',
      headers: { 'x-api-key': '[REDACTED]', authorization: '[REDACTED]' },
      amount: '80000.00',
    });
    expect(JSON.stringify(result)).not.toContain('secreta');
  });
});
