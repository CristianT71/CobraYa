import { BadRequestException } from '@nestjs/common';
import {
  consultarComprobanteParams,
  consultarCuentaParams,
  crearCuentaParams,
  parseOrReject,
  registrarClienteParams,
  registrarPagoParams,
  taskSchema,
} from '../../../src/a2a/task.schema';

const UUID = 'b2f1c0de-0000-4000-8000-000000000001';

const ok = <T>(
  schema: { safeParse(v: unknown): { success: boolean } },
  value: T,
) => expect(schema.safeParse(value).success).toBe(true);
const bad = (
  schema: { safeParse(v: unknown): { success: boolean } },
  value: unknown,
) => expect(schema.safeParse(value).success).toBe(false);

describe('taskSchema', () => {
  it('acepta el formato del concesionario: { from, message }', () => {
    ok(taskSchema, {
      from: 'automax-bot',
      message: '¿Pueden cobrar un filtro?',
    });
  });

  it('acepta una habilidad explícita con parámetros', () => {
    ok(taskSchema, { skill: 'crear_cuenta', params: { cualquier: 'cosa' } });
  });

  it('acepta idempotency_key en el cuerpo', () => {
    ok(taskSchema, { message: 'hola', idempotency_key: 'pedido-1' });
  });

  it.each([
    ['vacío', {}],
    ['solo from', { from: 'x' }],
    ['message vacío', { message: '' }],
    ['message de espacios', { message: '   ' }],
    ['skill desconocida', { skill: 'borrar_todo' }],
    ['campo no declarado', { message: 'hola', total: '1' }],
    ['message demasiado largo', { message: 'a'.repeat(2001) }],
    ['from demasiado largo', { message: 'hola', from: 'a'.repeat(81) }],
    ['message que no es texto', { message: 123 }],
  ])('rechaza un cuerpo %s', (_name, value) => {
    bad(taskSchema, value);
  });

  it.each([null, undefined, 'texto', 42, []])(
    'rechaza %j como cuerpo',
    (value) => {
      bad(taskSchema, value);
    },
  );
});

describe('registrarClienteParams', () => {
  const valid = {
    document_type: 'CC',
    document_number: '1.032.456.789',
    full_name: '  Ana Pérez  ',
  };

  it('normaliza el documento a dígitos y recorta el nombre', () => {
    expect(registrarClienteParams.parse(valid)).toEqual({
      document_type: 'CC',
      document_number: '1032456789',
      full_name: 'Ana Pérez',
    });
  });

  it('acepta el documento como número entero', () => {
    expect(
      registrarClienteParams.parse({ ...valid, document_number: 1032456789 })
        .document_number,
    ).toBe('1032456789');
  });

  it.each([
    ['sin tipo', { ...valid, document_type: undefined }],
    ['tipo desconocido', { ...valid, document_type: 'TI' }],
    ['documento corto', { ...valid, document_number: '1234' }],
    ['documento largo', { ...valid, document_number: '1'.repeat(21) }],
    ['documento con letras', { ...valid, document_number: 'ABC' }],
    [
      'documento con letras mezcladas',
      { ...valid, document_number: '1032456789X' },
    ],
    [
      'documento con un prefijo',
      { ...valid, document_number: 'CC 1032456789' },
    ],
    ['nombre de un carácter', { ...valid, full_name: 'A' }],
    ['nombre demasiado largo', { ...valid, full_name: 'a'.repeat(151) }],
    ['campo extra', { ...valid, edad: 30 }],
  ])('rechaza %s', (_name, value) => {
    bad(registrarClienteParams, value);
  });
});

describe('crearCuentaParams', () => {
  const valid = {
    customer: { document_type: 'CC', document_number: '1032456789' },
    items: [{ description: 'Filtro', quantity: 1, unit_price: '25000.00' }],
  };

  it('acepta una cuenta mínima y convierte cantidad y precio a texto', () => {
    const parsed = crearCuentaParams.parse({
      ...valid,
      items: [{ description: ' Filtro ', quantity: 2, unit_price: 25000 }],
    });

    expect(parsed.items[0]).toEqual({
      description: 'Filtro',
      quantity: '2',
      unit_price: '25000',
    });
  });

  it('acepta pago, referencia externa y nombre del cliente', () => {
    ok(crearCuentaParams, {
      ...valid,
      customer: { ...valid.customer, full_name: 'Ana Pérez' },
      payment: { method: 'cash', amount: '29750.00' },
      external_ref: 'OT-2026-118',
    });
  });

  it('el tipo de documento es opcional (RN-02)', () => {
    ok(crearCuentaParams, {
      ...valid,
      customer: { document_number: '1032456789' },
    });
  });

  it.each([
    ['sin cliente', { items: valid.items }],
    ['sin ítems', { ...valid, items: [] }],
    ['más de 50 ítems', { ...valid, items: Array(51).fill(valid.items[0]) }],
    [
      'cantidad cero',
      { ...valid, items: [{ ...valid.items[0], quantity: 0 }] },
    ],
    [
      'cantidad negativa',
      { ...valid, items: [{ ...valid.items[0], quantity: -1 }] },
    ],
    [
      'cantidad con 3 decimales',
      { ...valid, items: [{ ...valid.items[0], quantity: 1.234 }] },
    ],
    [
      'precio negativo',
      { ...valid, items: [{ ...valid.items[0], unit_price: '-5' }] },
    ],
    [
      'precio con puntos de miles',
      { ...valid, items: [{ ...valid.items[0], unit_price: '80.000' }] },
    ],
    [
      'precio con palabras',
      { ...valid, items: [{ ...valid.items[0], unit_price: '80 mil' }] },
    ],
    [
      'precio con notación científica',
      { ...valid, items: [{ ...valid.items[0], unit_price: 1e21 }] },
    ],
    [
      'descripción vacía',
      { ...valid, items: [{ ...valid.items[0], description: '  ' }] },
    ],
    [
      'descripción de 201 caracteres',
      {
        ...valid,
        items: [{ ...valid.items[0], description: 'x'.repeat(201) }],
      },
    ],
    [
      'método de pago desconocido',
      { ...valid, payment: { method: 'bitcoin' } },
    ],
    ['total enviado por el negocio', { ...valid, total: '1' }],
    [
      'ítem con total enviado',
      { ...valid, items: [{ ...valid.items[0], line_total: '1' }] },
    ],
    ['referencia de 61 caracteres', { ...valid, external_ref: 'x'.repeat(61) }],
  ])('rechaza %s', (_name, value) => {
    bad(crearCuentaParams, value);
  });
});

describe('registrarPagoParams', () => {
  it('acepta cuenta y método; el monto es opcional', () => {
    ok(registrarPagoParams, { invoice_id: UUID, method: 'transfer' });
    ok(registrarPagoParams, {
      invoice_id: UUID,
      method: 'cash',
      amount: '124950.00',
    });
  });

  it.each([
    ['sin cuenta', { method: 'cash' }],
    ['cuenta que no es uuid', { invoice_id: '123', method: 'cash' }],
    ['sin método', { invoice_id: UUID }],
    [
      'monto mal escrito',
      { invoice_id: UUID, method: 'cash', amount: '124.950' },
    ],
  ])('rechaza %s', (_name, value) => {
    bad(registrarPagoParams, value);
  });
});

describe('consultarCuentaParams y consultarComprobanteParams', () => {
  it('consultar_cuenta exige un uuid', () => {
    ok(consultarCuentaParams, { invoice_id: UUID });
    bad(consultarCuentaParams, { invoice_id: 'abc' });
    bad(consultarCuentaParams, {});
  });

  it('consultar_comprobante acepta número, cuenta o ambos, pero no ninguno (RN-10)', () => {
    ok(consultarComprobanteParams, { receipt_number: 7 });
    ok(consultarComprobanteParams, { invoice_id: UUID });
    ok(consultarComprobanteParams, { receipt_number: 7, invoice_id: UUID });
    bad(consultarComprobanteParams, {});
  });

  it.each([0, -1, 1.5, '7'])('rechaza el número de comprobante %j', (value) => {
    bad(consultarComprobanteParams, { receipt_number: value });
  });
});

describe('parseOrReject', () => {
  it('devuelve los datos válidos', () => {
    expect(parseOrReject(consultarCuentaParams, { invoice_id: UUID })).toEqual({
      invoice_id: UUID,
    });
  });

  it('responde 400 con las rutas de los campos y sin repetir los valores', () => {
    let error: unknown;
    try {
      parseOrReject(crearCuentaParams, {
        customer: { document_number: '1032456789SECRETO' },
        items: [{ description: 'x', quantity: 1, unit_price: '80 mil' }],
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as {
      message: string;
      missing_fields: string[];
    };
    expect(body.missing_fields).toEqual(
      expect.arrayContaining([
        'customer.document_number',
        'items[0].unit_price',
      ]),
    );
    expect(JSON.stringify(body)).not.toContain('SECRETO');
    expect(JSON.stringify(body)).not.toContain('80 mil');
  });

  it('un error en la raíz se reporta como "cuerpo"', () => {
    try {
      parseOrReject(taskSchema, null);
      fail('debía lanzar');
    } catch (e) {
      const body = (e as BadRequestException).getResponse() as {
        missing_fields: string[];
      };
      expect(body.missing_fields).toEqual(['cuerpo']);
    }
  });
});
