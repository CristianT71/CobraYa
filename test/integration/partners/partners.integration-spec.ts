import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Customer } from '../../../src/customers/customer.entity';
import { CustomersService } from '../../../src/customers/customers.service';
import { PartnerExchange } from '../../../src/partners/partner-exchange.entity';
import { Partner } from '../../../src/partners/partner.entity';
import { hashApiKey } from '../../../src/partners/partner-keys';
import {
  PartnerExistsError,
  PartnerNotFoundError,
} from '../../../src/partners/partners.errors';
import { PartnersService } from '../../../src/partners/partners.service';
import { PARTNER_SKILLS } from '../../../src/partners/skills';

// Registro de negocios y aislamiento de clientes contra PostgreSQL real, con las
// migraciones aplicadas. Si E2E_DATABASE_URL no está definida, la suite se omite.

const DATABASE_URL = process.env.E2E_DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const PEPPER = 'pepper-de-prueba-'.padEnd(40, 'x');

describeWithDb('Negocios y clientes por negocio (PostgreSQL)', () => {
  let dataSource: DataSource;
  let partners: PartnersService;
  let customers: CustomersService;
  let counter = 0;
  const slug = () => `neg-${Date.now().toString(36)}${counter++}`.slice(0, 20);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: DATABASE_URL,
      entities: [Partner, PartnerExchange, Customer],
      synchronize: false,
    });
    await dataSource.initialize();
    const config = {
      getOrThrow: () => PEPPER,
    } as unknown as ConfigService;
    partners = new PartnersService(dataSource.getRepository(Partner), config);
    customers = new CustomersService(dataSource.getRepository(Customer));
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE partner_exchanges, receipts, payments, invoice_items, invoices RESTART IDENTITY CASCADE',
    );
    await dataSource.query(
      'DELETE FROM customers WHERE partner_id IS NOT NULL',
    );
    await dataSource.query('DELETE FROM partners');
  });

  describe('PartnersService', () => {
    it('crea un negocio con todas las habilidades y devuelve la key una sola vez', async () => {
      const { partner, apiKey } = await partners.create({
        slug: 'concesionario',
        name: 'AutoMax Concesionario',
      });

      expect(partner).toMatchObject({
        slug: 'concesionario',
        name: 'AutoMax Concesionario',
        skills: [...PARTNER_SKILLS],
        active: true,
        rate_per_minute: 30,
        daily_quota: 500,
        last_used_at: null,
      });
      expect(apiKey).toMatch(/^fac_[A-Za-z0-9_-]{43}$/);
      expect(partner.key_prefix).toBe(apiKey.slice(0, 8));
      expect(JSON.stringify(partner)).not.toContain(apiKey);
    });

    it('nunca guarda la key: en la base solo hay su hash', async () => {
      const { apiKey } = await partners.create({
        slug: slug(),
        name: 'Taller',
      });

      const rows: Array<{ key_hash: string }> = await dataSource.query(
        'SELECT key_hash FROM partners',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].key_hash).toBe(hashApiKey(apiKey, PEPPER));
      expect(JSON.stringify(rows)).not.toContain(apiKey);
    });

    it('permite limitar las habilidades y los límites al crear', async () => {
      const { partner } = await partners.create({
        slug: slug(),
        name: 'Repuestos',
        skills: ['consultar_cuenta', 'consultar_comprobante'],
        ratePerMinute: 5,
        dailyQuota: 20,
      });

      expect(partner.skills).toEqual([
        'consultar_cuenta',
        'consultar_comprobante',
      ]);
      expect(partner.rate_per_minute).toBe(5);
      expect(partner.daily_quota).toBe(20);
    });

    it('rechaza un identificador repetido', async () => {
      await partners.create({ slug: 'taller', name: 'Taller' });

      await expect(
        partners.create({ slug: 'taller', name: 'Otro taller' }),
      ).rejects.toBeInstanceOf(PartnerExistsError);
    });

    it.each(['A', 'Taller', '1taller', 'taller_x', 'a'.repeat(21), 'ta ller'])(
      'la base rechaza el identificador inválido %j',
      async (bad) => {
        await expect(
          dataSource.query(
            `INSERT INTO partners (slug, name, key_hash, key_prefix, skills) VALUES ($1, 'x', $2, 'fac_xxxx', '{}')`,
            [bad, `hash-${Math.random()}`],
          ),
        ).rejects.toThrow(/ck_partners_slug|value too long/);
      },
    );

    describe('findActiveByApiKey', () => {
      it('encuentra al negocio por su key', async () => {
        const { partner, apiKey } = await partners.create({
          slug: slug(),
          name: 'Taller',
        });

        const found = await partners.findActiveByApiKey(apiKey);

        expect(found?.id).toBe(partner.id);
      });

      it('no encuentra una key desconocida, mal formada o vacía', async () => {
        await partners.create({ slug: slug(), name: 'Taller' });

        await expect(
          partners.findActiveByApiKey(`fac_${'a'.repeat(43)}`),
        ).resolves.toBeNull();
        await expect(partners.findActiveByApiKey('basura')).resolves.toBeNull();
        await expect(partners.findActiveByApiKey('')).resolves.toBeNull();
      });

      it('no encuentra a un negocio desactivado, igual que a uno inexistente', async () => {
        const { partner, apiKey } = await partners.create({
          slug: slug(),
          name: 'Taller',
        });
        await partners.update(partner.id, { active: false });

        await expect(partners.findActiveByApiKey(apiKey)).resolves.toBeNull();

        await partners.update(partner.id, { active: true });
        await expect(
          partners.findActiveByApiKey(apiKey),
        ).resolves.not.toBeNull();
      });
    });

    it('rotar la key invalida la anterior en el mismo momento', async () => {
      const { partner, apiKey: oldKey } = await partners.create({
        slug: slug(),
        name: 'Taller',
      });

      const { apiKey: newKey, partner: rotated } = await partners.rotateKey(
        partner.id,
      );

      expect(newKey).not.toBe(oldKey);
      expect(rotated.key_prefix).toBe(newKey.slice(0, 8));
      await expect(partners.findActiveByApiKey(oldKey)).resolves.toBeNull();
      await expect(partners.findActiveByApiKey(newKey)).resolves.not.toBeNull();
    });

    it('actualiza nombre, habilidades y límites sin tocar la key', async () => {
      const { partner, apiKey } = await partners.create({
        slug: slug(),
        name: 'Taller',
      });

      const updated = await partners.update(partner.id, {
        name: 'Taller Falla',
        skills: ['crear_cuenta'],
        ratePerMinute: 10,
        dailyQuota: 100,
      });

      expect(updated).toMatchObject({
        name: 'Taller Falla',
        skills: ['crear_cuenta'],
        rate_per_minute: 10,
        daily_quota: 100,
      });
      await expect(partners.findActiveByApiKey(apiKey)).resolves.not.toBeNull();
    });

    it.each([
      [{ ratePerMinute: 0 }, 'ck_partners_rate_per_minute'],
      [{ ratePerMinute: 601 }, 'ck_partners_rate_per_minute'],
      [{ dailyQuota: 0 }, 'ck_partners_daily_quota'],
      [{ dailyQuota: 100001 }, 'ck_partners_daily_quota'],
    ])('la base rechaza los límites %j', async (limits, constraint) => {
      const { partner } = await partners.create({ slug: slug(), name: 'x' });

      await expect(partners.update(partner.id, limits)).rejects.toThrow(
        constraint,
      );
    });

    it('lista los negocios en orden de creación, sin key ni hash', async () => {
      await partners.create({ slug: 'uno', name: 'Uno' });
      await partners.create({ slug: 'dos', name: 'Dos' });

      const list = await partners.list();

      expect(list.map((p) => p.slug)).toEqual(['uno', 'dos']);
      expect(JSON.stringify(list)).not.toMatch(
        /key_hash|fac_[A-Za-z0-9_-]{43}/,
      );
    });

    it.each([
      ['un uuid que no existe', '00000000-0000-4000-8000-000000000000'],
      ['algo que no es uuid', 'no-es-uuid'],
    ])('responde PARTNER_NOT_FOUND con %s', async (_name, id) => {
      await expect(partners.get(id)).rejects.toBeInstanceOf(
        PartnerNotFoundError,
      );
      await expect(
        partners.update(id, { active: false }),
      ).rejects.toBeInstanceOf(PartnerNotFoundError);
      await expect(partners.rotateKey(id)).rejects.toBeInstanceOf(
        PartnerNotFoundError,
      );
    });

    it('touch actualiza last_used_at y no vuelve a escribir en el mismo minuto', async () => {
      const { partner } = await partners.create({ slug: slug(), name: 'x' });
      const entity = await dataSource
        .getRepository(Partner)
        .findOneByOrFail({ id: partner.id });

      await partners.touch(entity);
      const first = (await partners.get(partner.id)).last_used_at;
      expect(first).not.toBeNull();

      await dataSource.query('UPDATE partners SET last_used_at = NULL');
      await partners.touch(entity);
      expect((await partners.get(partner.id)).last_used_at).toBeNull();
    });
  });

  describe('clientes por negocio (aislamiento)', () => {
    const DOC = { documentType: 'CC' as const, documentNumber: '777000111' };

    it('el mismo documento puede existir en dos negocios, una sola vez en cada uno', async () => {
      const a = (await partners.create({ slug: slug(), name: 'A' })).partner;
      const b = (await partners.create({ slug: slug(), name: 'B' })).partner;

      await customers.register({
        partnerId: a.id,
        ...DOC,
        fullName: 'Ana en A',
      });
      await customers.register({
        partnerId: b.id,
        ...DOC,
        fullName: 'Ana en B',
      });

      const [inA] = await customers.findByDocument(
        'CC',
        DOC.documentNumber,
        a.id,
      );
      const [inB] = await customers.findByDocument(
        'CC',
        DOC.documentNumber,
        b.id,
      );
      expect(inA.full_name).toBe('Ana en A');
      expect(inB.full_name).toBe('Ana en B');
      expect(inA.id).not.toBe(inB.id);
    });

    it('un negocio no ve los clientes de otro ni los de la plataforma', async () => {
      const a = (await partners.create({ slug: slug(), name: 'A' })).partner;
      const b = (await partners.create({ slug: slug(), name: 'B' })).partner;
      await customers.register({
        partnerId: a.id,
        ...DOC,
        fullName: 'Solo de A',
      });

      await expect(
        customers.findByDocument('CC', DOC.documentNumber, b.id),
      ).resolves.toEqual([]);
      await expect(
        customers.findByDocument(null, DOC.documentNumber, b.id),
      ).resolves.toEqual([]);
      await expect(
        customers.findByDocument('CC', DOC.documentNumber),
      ).resolves.toEqual([]);
    });

    it('los clientes de la plataforma no aparecen en la búsqueda de un negocio', async () => {
      const a = (await partners.create({ slug: slug(), name: 'A' })).partner;
      // Cliente de la plataforma (partner_id NULL), como los de la semilla.
      await customers.register({
        partnerId: null,
        documentType: 'CC',
        documentNumber: '888000222',
        fullName: 'De la plataforma',
      });

      await expect(
        customers.findByDocument('CC', '888000222'),
      ).resolves.toHaveLength(1);
      await expect(
        customers.findByDocument('CC', '888000222', a.id),
      ).resolves.toEqual([]);

      await dataSource.query(
        `DELETE FROM customers WHERE document_number = '888000222'`,
      );
    });

    it('register crea una sola vez y devuelve el existente sin editarlo', async () => {
      const a = (await partners.create({ slug: slug(), name: 'A' })).partner;

      const first = await customers.register({
        partnerId: a.id,
        ...DOC,
        fullName: 'Nombre original',
      });
      const second = await customers.register({
        partnerId: a.id,
        ...DOC,
        fullName: 'Nombre distinto',
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.customer.id).toBe(first.customer.id);
      expect(second.customer.full_name).toBe('Nombre original');
    });

    it('dos registros simultáneos del mismo cliente crean uno solo', async () => {
      const a = (await partners.create({ slug: slug(), name: 'A' })).partner;
      const input = { partnerId: a.id, ...DOC, fullName: 'Carrera' };

      const [x, y] = await Promise.all([
        customers.register(input),
        customers.register(input),
      ]);

      expect(x.customer.id).toBe(y.customer.id);
      expect([x.created, y.created].filter(Boolean)).toHaveLength(1);
      const rows: Array<{ n: string }> = await dataSource.query(
        'SELECT count(*) AS n FROM customers WHERE partner_id = $1',
        [a.id],
      );
      expect(Number(rows[0].n)).toBe(1);
    });

    it('sin tipo de documento encuentra los de un solo negocio y detecta el ambiguo dentro de él', async () => {
      const a = (await partners.create({ slug: slug(), name: 'A' })).partner;
      await customers.register({
        partnerId: a.id,
        documentType: 'CC',
        documentNumber: '555000999',
        fullName: 'Como CC',
      });
      await customers.register({
        partnerId: a.id,
        documentType: 'CE',
        documentNumber: '555000999',
        fullName: 'Como CE',
      });

      const found = await customers.findByDocument(null, '555000999', a.id);

      expect(found.map((c) => c.document_type).sort()).toEqual(['CC', 'CE']);
    });

    it('la base impide un cliente con un negocio que no existe', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO customers (partner_id, document_type, document_number, full_name)
           VALUES ('00000000-0000-4000-8000-000000000000', 'CC', '123456', 'x')`,
        ),
      ).rejects.toThrow(/foreign key|customers_partner_id_fkey/);
    });
  });
});
