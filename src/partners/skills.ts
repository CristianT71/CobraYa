// Habilidades que un negocio puede pedirle al servicio de Facturación y Pagos.
// Siguen el alcance del contrato (sección 1): cuentas de cobro, pagos simulados y
// comprobantes. No incluye contabilidad (libros, balances, reportes tributarios).

export const PARTNER_SKILLS = [
  'registrar_cliente',
  'crear_cuenta',
  'registrar_pago',
  'consultar_cuenta',
  'consultar_comprobante',
  'lenguaje_natural',
] as const;

export type PartnerSkill = (typeof PARTNER_SKILLS)[number];

export const SKILL_DESCRIPTIONS: Record<PartnerSkill, string> = {
  registrar_cliente:
    'Registra a un cliente del negocio (documento y nombre) para poder cobrarle.',
  crear_cuenta:
    'Crea una cuenta de cobro con sus ítems; con método de pago, queda pagada y emite comprobante.',
  registrar_pago:
    'Registra el pago, único y completo, de una cuenta pendiente y emite el comprobante.',
  consultar_cuenta:
    'Consulta una cuenta de cobro: ítems, totales, pago y comprobante.',
  consultar_comprobante:
    'Consulta un comprobante emitido, por número de comprobante o por cuenta.',
  lenguaje_natural:
    'Entiende una frase en español ("cóbrale a la cédula 123 un cambio de aceite de 80.000, pagó en efectivo") y ejecuta cobros, pagos o consultas.',
};

export function isPartnerSkill(value: unknown): value is PartnerSkill {
  return (
    typeof value === 'string' &&
    (PARTNER_SKILLS as readonly string[]).includes(value)
  );
}
