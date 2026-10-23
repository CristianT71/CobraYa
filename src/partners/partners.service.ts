import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Partner } from './partner.entity';
import {
  generateApiKey,
  hashApiKey,
  keyPreview,
  looksLikeApiKey,
} from './partner-keys';
import { PartnerExistsError, PartnerNotFoundError } from './partners.errors';
import { PARTNER_SKILLS, type PartnerSkill } from './skills';

const UNIQUE_VIOLATION = '23505';

// Lo que se puede mostrar de un negocio: nunca la key ni su hash.
export interface PartnerView {
  id: string;
  slug: string;
  name: string;
  key_prefix: string;
  skills: PartnerSkill[];
  active: boolean;
  rate_per_minute: number;
  daily_quota: number;
  created_at: string;
  last_used_at: string | null;
}

export interface CreatePartnerInput {
  slug: string;
  name: string;
  skills?: PartnerSkill[];
  ratePerMinute?: number;
  dailyQuota?: number;
}

export interface UpdatePartnerInput {
  name?: string;
  skills?: PartnerSkill[];
  active?: boolean;
  ratePerMinute?: number;
  dailyQuota?: number;
}

// last_used_at se actualiza a lo sumo una vez por minuto y negocio, para no
// escribir en la base en cada petición.
const TOUCH_INTERVAL_MS = 60_000;

export function toPartnerView(partner: Partner): PartnerView {
  return {
    id: partner.id,
    slug: partner.slug,
    name: partner.name,
    key_prefix: partner.keyPrefix,
    skills: partner.skills,
    active: partner.active,
    rate_per_minute: partner.ratePerMinute,
    daily_quota: partner.dailyQuota,
    created_at: partner.createdAt.toISOString(),
    last_used_at: partner.lastUsedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class PartnersService {
  private readonly pepper: string;
  private readonly lastTouch = new Map<string, number>();

  constructor(
    @InjectRepository(Partner) private readonly partners: Repository<Partner>,
    config: ConfigService,
  ) {
    this.pepper = config.getOrThrow<string>('partners.keyPepper');
  }

  // La key se devuelve aquí y no se puede volver a ver.
  async create(
    input: CreatePartnerInput,
  ): Promise<{ partner: PartnerView; apiKey: string }> {
    const apiKey = generateApiKey();
    try {
      const saved = await this.partners.save(
        this.partners.create({
          slug: input.slug,
          name: input.name,
          keyHash: hashApiKey(apiKey, this.pepper),
          keyPrefix: keyPreview(apiKey),
          skills: input.skills ?? [...PARTNER_SKILLS],
          ...(input.ratePerMinute !== undefined && {
            ratePerMinute: input.ratePerMinute,
          }),
          ...(input.dailyQuota !== undefined && {
            dailyQuota: input.dailyQuota,
          }),
        }),
      );
      const created = await this.require(saved.id);
      return { partner: toPartnerView(created), apiKey };
    } catch (error) {
      if (isUniqueViolation(error)) throw new PartnerExistsError(input.slug);
      throw error;
    }
  }

  async list(): Promise<PartnerView[]> {
    const all = await this.partners.find({ order: { createdAt: 'ASC' } });
    return all.map(toPartnerView);
  }

  async get(id: string): Promise<PartnerView> {
    return toPartnerView(await this.require(id));
  }

  async update(id: string, patch: UpdatePartnerInput): Promise<PartnerView> {
    const partner = await this.require(id);
    if (patch.name !== undefined) partner.name = patch.name;
    if (patch.skills !== undefined) partner.skills = patch.skills;
    if (patch.active !== undefined) partner.active = patch.active;
    if (patch.ratePerMinute !== undefined) {
      partner.ratePerMinute = patch.ratePerMinute;
    }
    if (patch.dailyQuota !== undefined) partner.dailyQuota = patch.dailyQuota;
    return toPartnerView(await this.partners.save(partner));
  }

  // La key anterior deja de servir en el mismo momento.
  async rotateKey(
    id: string,
  ): Promise<{ partner: PartnerView; apiKey: string }> {
    const partner = await this.require(id);
    const apiKey = generateApiKey();
    partner.keyHash = hashApiKey(apiKey, this.pepper);
    partner.keyPrefix = keyPreview(apiKey);
    return {
      partner: toPartnerView(await this.partners.save(partner)),
      apiKey,
    };
  }

  // Busca por el hash de la key. Una key desconocida, mal formada o de un negocio
  // desactivado da el mismo resultado (null): quien llama no puede distinguirlos.
  async findActiveByApiKey(key: string): Promise<Partner | null> {
    if (!looksLikeApiKey(key)) return null;
    const partner = await this.partners.findOneBy({
      keyHash: hashApiKey(key, this.pepper),
    });
    return partner?.active ? partner : null;
  }

  async touch(partner: Partner): Promise<void> {
    const now = Date.now();
    const last = this.lastTouch.get(partner.id) ?? 0;
    if (now - last < TOUCH_INTERVAL_MS) return;
    this.lastTouch.set(partner.id, now);
    await this.partners.update({ id: partner.id }, { lastUsedAt: new Date() });
  }

  private async require(id: string): Promise<Partner> {
    // Un id que no es uuid no existe: se evita el error de PostgreSQL.
    const found = isUuid(id) ? await this.partners.findOneBy({ id }) : null;
    if (!found) throw new PartnerNotFoundError();
    return found;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => UUID.test(value);

function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: string; driverError?: { code?: string } };
  return (err?.driverError?.code ?? err?.code) === UNIQUE_VIOLATION;
}
