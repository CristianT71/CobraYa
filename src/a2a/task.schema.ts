import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { PARTNER_SKILLS } from '../partners/skills';

// Tarea que manda un negocio (formato del concesionario: { from, message } o
// { skill, params }). TODO es dato no confiable: objetos estrictos (un campo de
// más es error), tipos exactos y textos acotados.

export const MAX_MESSAGE_CHARS = 2_000;
// invoices.idempotency_key es varchar(100): se reservan 21 para "<identificador>:".
export const MAX_IDEMPOTENCY_KEY_CHARS = 79;

const AMOUNT = /^\d+(\.\d{1,2})?$/;

export const taskSchema = z
  .strictObject({
    from: z.string().max(80).optional(),
    message: z.string().max(MAX_MESSAGE_CHARS).optional(),
    skill: z.enum(PARTNER_SKILLS).optional(),
    params: z.record(z.string().max(40), z.unknown()).optional(),
    // Alternativa al encabezado Idempotency-Key, para clientes que no controlan los encabezados.
    idempotency_key: z.string().optional(),
  })
  .refine(
    (task) =>
      (task.message !== undefined && task.message.trim().length > 0) ||
      task.skill !== undefined,
    { message: 'Falta message o skill', path: ['message'] },
  );

export type Task = z.output<typeof taskSchema>;

const documentType = z.enum(['CC', 'NIT', 'CE']);

// Documento: dígitos con separadores comunes (puntos, espacios, guiones), o un
// entero. Una letra mezclada se rechaza: quitarla en silencio podría convertir el
// documento en el de otro cliente. El NIT va sin dígito de verificación.
const documentNumber = z
  .union([z.string().regex(/^[\d.\s-]+$/), z.number().int().nonnegative()])
  .transform((value) => String(value).replace(/\D/g, ''))
  .pipe(z.string().regex(/^\d{5,20}$/));

// Dinero y cantidades: texto decimal con hasta 2 decimales; un número solo se
// acepta si sus textos cumplen el mismo formato (nunca flotantes con ruido).
const decimalText = z
  .union([z.string(), z.number().nonnegative()])
  .transform(String)
  .pipe(z.string().regex(AMOUNT));

const quantity = decimalText.refine((value) => Number(value) > 0);

const paymentMethod = z.enum(['cash', 'card', 'transfer']);

const fullName = z.string().trim().min(2).max(150);

const invoiceId = z.uuid();

const itemSchema = z.strictObject({
  description: z.string().trim().min(1).max(200),
  quantity,
  unit_price: decimalText,
});

export const registrarClienteParams = z.strictObject({
  document_type: documentType,
  document_number: documentNumber,
  full_name: fullName,
});

export const crearCuentaParams = z.strictObject({
  customer: z.strictObject({
    document_type: documentType.optional(),
    document_number: documentNumber,
    // Con tipo y nombre, un cliente que no existe se registra en el mismo paso.
    full_name: fullName.optional(),
  }),
  items: z.array(itemSchema).min(1).max(50),
  payment: z
    .strictObject({
      method: paymentMethod,
      amount: decimalText.optional(),
    })
    .optional(),
  external_ref: z.string().trim().min(1).max(60).optional(),
});

export const registrarPagoParams = z.strictObject({
  invoice_id: invoiceId,
  method: paymentMethod,
  amount: decimalText.optional(),
});

export const consultarCuentaParams = z.strictObject({
  invoice_id: invoiceId,
});

export const consultarComprobanteParams = z
  .strictObject({
    receipt_number: z.number().int().min(1).optional(),
    invoice_id: invoiceId.optional(),
  })
  .refine(
    (value) =>
      value.receipt_number !== undefined || value.invoice_id !== undefined,
    { message: 'Falta receipt_number o invoice_id', path: ['receipt_number'] },
  );

// Valida contra un esquema y, si falla, responde 400 con las rutas de los campos
// (sin repetir los valores recibidos, que pueden traer datos personales).
export function parseOrReject<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const paths = [
    ...new Set(
      result.error.issues.map((issue) =>
        issue.path.length > 0 ? formatPath(issue.path) : 'cuerpo',
      ),
    ),
  ];
  throw new BadRequestException({
    message: `Datos inválidos en: ${paths.join(', ')}.`,
    missing_fields: paths,
  });
}

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((text, part) => {
    if (typeof part === 'number') return `${text}[${part}]`;
    return text === '' ? String(part) : `${text}.${String(part)}`;
  }, '');
}
