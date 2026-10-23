import { DataSource } from 'typeorm';
import { Customer } from '../../../src/customers/customer.entity';
import { CustomersService } from '../../../src/customers/customers.service';

// CustomersService contra la tabla real. Si E2E_DATABASE_URL no está definida,
// la suite se omite.

const DATABASE_URL = process.env.E2E_DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('CustomersService (PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: CustomersService;

  const SEED = [
    {
      documentType: 'CC',
      documentNumber: '1032456789',
      fullName: 'Cliente de ejemplo',
    },
    {
      documentType: 'NIT',
      documentNumber: '900123456',
      fullName: 'Transportes de Prueba S.A.S.',
    },
    // Mismo número con dos tipos de documento: AMBIGUOUS_CUSTOMER (RN-02).
    {
      documentType: 'CE',
      documentNumber: '4567890',
      fullName: 'Cliente Extranjero de Prueba',
    },
    {
      documentType: 'CC',
      documentNumber: '4567890',
      fullName: 'Cliente Ambiguo de Prueba',
    },
  ] as const;

  const total = () => dataSource.getRepository(Customer).count();

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: DATABASE_URL,
      entities: [Customer],
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource
      .createQueryBuilder()
      .insert()
      .into(Customer)
      .values(SEED.map((customer) => ({ ...customer })))
      .orIgnore()
      .execute();
    service = new CustomersService(dataSource.getRepository(Customer));
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('encuentra un cliente por tipo y número, con la forma que usa el orquestador', async () => {
    const result = await service.findByDocument('CC', '1032456789');

    expect(result).toEqual([
      {
        id: expect.any(String),
        document_type: 'CC',
        document_number: '1032456789',
        full_name: 'Cliente de ejemplo',
      },
    ]);
  });

  it('sin tipo de documento busca solo por número', async () => {
    const result = await service.findByDocument(null, '900123456');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ document_type: 'NIT' });
  });

  it('sin tipo y con un número repetido devuelve todos los clientes (RN-02)', async () => {
    const result = await service.findByDocument(null, '4567890');

    expect(result.map((c) => c.document_type).sort()).toEqual(['CC', 'CE']);
  });

  it('con tipo desambigua el número repetido', async () => {
    const result = await service.findByDocument('CE', '4567890');

    expect(result).toHaveLength(1);
    expect(result[0].full_name).toBe('Cliente Extranjero de Prueba');
  });

  it('un cliente inexistente devuelve una lista vacía y nunca lo crea (RN-01)', async () => {
    const before = await total();

    await expect(service.findByDocument('CC', '999999999')).resolves.toEqual(
      [],
    );
    await expect(service.findByDocument(null, '999999999')).resolves.toEqual(
      [],
    );

    expect(await total()).toBe(before);
  });

  it('el tipo de documento correcto no encuentra el número de otro tipo', async () => {
    await expect(service.findByDocument('NIT', '1032456789')).resolves.toEqual(
      [],
    );
  });
});
