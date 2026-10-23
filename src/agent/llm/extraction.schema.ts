import { z } from 'zod';

// Contrato de extracción (contrato, sección 6.2). El esquema solo valida la
// estructura: las reglas de negocio (montos válidos, cantidades > 0, cliente
// existente) se aplican después en código, para responder con el error del
// catálogo correcto en vez de forzar un reintento de reparación.

// Monto como texto decimal con punto y sin separador de miles: "80000.00".
export const AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/;

export const INTENTS = [
  'create_invoice',
  'register_payment',
  'get_receipt',
  'unknown',
] as const;
export const DOCUMENT_TYPES = ['CC', 'NIT', 'CE'] as const;
export const PAYMENT_METHODS = ['cash', 'card', 'transfer'] as const;

export const ExtractionSchema = z.strictObject({
  intent: z.enum(INTENTS),
  customer: z.strictObject({
    document_type: z.enum(DOCUMENT_TYPES).nullable(),
    document_number: z.string().nullable(),
  }),
  items: z.array(
    z.strictObject({
      description: z.string(),
      quantity: z.number(),
      unit_price: z.string(),
    }),
  ),
  payment: z.strictObject({
    method: z.enum(PAYMENT_METHODS).nullable(),
    amount: z.string().nullable(),
  }),
  related_ids: z.strictObject({
    invoice_id: z.string().nullable(),
    receipt_number: z.number().int().nullable(),
    external_ref: z.string().nullable(),
  }),
  missing_fields: z.array(z.string()),
  notes: z.string().nullable(),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type Intent = Extraction['intent'];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// JSON Schema para el response_format estricto del modelo.
export const EXTRACTION_JSON_SCHEMA = z.toJSONSchema(ExtractionSchema);
