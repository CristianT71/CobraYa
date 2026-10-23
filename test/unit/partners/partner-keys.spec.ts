import {
  KEY_PREFIX,
  generateApiKey,
  hashApiKey,
  keyPreview,
  looksLikeApiKey,
} from '../../../src/partners/partner-keys';

const PEPPER = 'p'.repeat(32);

describe('partner-keys', () => {
  describe('generateApiKey', () => {
    it('genera keys con el prefijo fac_ y 43 caracteres aleatorios', () => {
      const key = generateApiKey();

      expect(key.startsWith(KEY_PREFIX)).toBe(true);
      expect(key).toHaveLength(KEY_PREFIX.length + 43);
      expect(looksLikeApiKey(key)).toBe(true);
    });

    it('no repite keys', () => {
      const keys = new Set(Array.from({ length: 200 }, generateApiKey));
      expect(keys.size).toBe(200);
    });
  });

  describe('hashApiKey', () => {
    it('es determinista para la misma key y el mismo pepper', () => {
      const key = generateApiKey();
      expect(hashApiKey(key, PEPPER)).toBe(hashApiKey(key, PEPPER));
    });

    it('cambia con otra key o con otro pepper', () => {
      const key = generateApiKey();
      expect(hashApiKey(key, PEPPER)).not.toBe(
        hashApiKey(generateApiKey(), PEPPER),
      );
      expect(hashApiKey(key, PEPPER)).not.toBe(hashApiKey(key, 'q'.repeat(32)));
    });

    it('devuelve 64 caracteres hexadecimales y nunca contiene la key', () => {
      const key = generateApiKey();
      const hash = hashApiKey(key, PEPPER);

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).not.toContain(key.slice(KEY_PREFIX.length));
    });
  });

  describe('keyPreview', () => {
    it('muestra solo el prefijo y 4 caracteres', () => {
      const key = generateApiKey();
      const preview = keyPreview(key);

      expect(preview).toHaveLength(KEY_PREFIX.length + 4);
      expect(key.startsWith(preview)).toBe(true);
    });
  });

  describe('looksLikeApiKey', () => {
    it.each([
      ['vacía', ''],
      ['sin prefijo', 'a'.repeat(47)],
      ['prefijo equivocado', `amx_${'a'.repeat(43)}`],
      ['demasiado corta', `fac_${'a'.repeat(42)}`],
      ['demasiado larga', `fac_${'a'.repeat(44)}`],
      ['con caracteres no permitidos', `fac_${'a'.repeat(42)}!`],
      ['con espacios', `fac_ ${'a'.repeat(42)}`],
      ['con salto de línea', `fac_${'a'.repeat(43)}\n`],
    ])('rechaza una key %s', (_name, value) => {
      expect(looksLikeApiKey(value)).toBe(false);
    });
  });
});
