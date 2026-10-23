import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Reglas de dependencia del contrato (sección 2.2), comprobadas sobre los
// imports reales del código fuente:
//   - agent puede usar billing y customers; nunca al revés.
//   - billing/domain es TypeScript puro: sin NestJS, TypeORM ni cliente del LLM.
//   - Solo fireworks-extractor.adapter.ts conoce a Fireworks (SDK `openai`).

const SRC = join(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

// Rutas de cada import/export ... from '...' y de los import('...') dinámicos.
function importsOf(file: string): string[] {
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const paths: string[] = [];
  for (const match of code.matchAll(
    /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g,
  )) {
    paths.push(match[1]);
  }
  return paths;
}

const files = sourceFiles(SRC).map((file) => ({
  file,
  name: relative(SRC, file).replace(/\\/g, '/'),
  imports: importsOf(file),
}));

// Archivos de un módulo que importan algo que cumple `forbidden`.
function violations(
  scope: (name: string) => boolean,
  forbidden: (importPath: string) => boolean,
): string[] {
  return files
    .filter(({ name }) => scope(name))
    .flatMap(({ name, imports }) =>
      imports.filter(forbidden).map((path) => `${name} importa "${path}"`),
    );
}

const pointsToAgent = (path: string) =>
  path.startsWith('.') && /(^|\/)agent(\/|$)/.test(path);

describe('Reglas de dependencia (contrato, sección 2.2)', () => {
  it('encuentra los archivos fuente', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('billing no importa nada de agent', () => {
    expect(violations((n) => n.startsWith('billing/'), pointsToAgent)).toEqual(
      [],
    );
  });

  it('customers no importa nada de agent', () => {
    expect(
      violations((n) => n.startsWith('customers/'), pointsToAgent),
    ).toEqual([]);
  });

  it('common no importa nada de agent, billing ni customers', () => {
    expect(
      violations(
        (n) => n.startsWith('common/'),
        (path) =>
          path.startsWith('.') &&
          /(^|\/)(agent|billing|customers)(\/|$)/.test(path),
      ),
    ).toEqual([]);
  });

  it('billing/domain no depende de NestJS, TypeORM, el LLM ni de capas superiores', () => {
    expect(
      violations(
        (n) => n.startsWith('billing/domain/'),
        (path) =>
          /^(@nestjs|typeorm|openai|zod|express|rxjs)/.test(path) ||
          pointsToAgent(path) ||
          /\/(application|entities|dto|ports|queries|idempotency|locking|mappers)(\/|$)/.test(
            path,
          ),
      ),
    ).toEqual([]);
  });

  it('solo fireworks-extractor.adapter.ts conoce al SDK del proveedor', () => {
    const importers = files
      .filter(({ imports }) =>
        imports.some((path) => path === 'openai' || path.startsWith('openai/')),
      )
      .map(({ name }) => name);

    expect(importers).toEqual(['agent/llm/fireworks-extractor.adapter.ts']);
  });

  it('el dominio de facturación no conoce a Fireworks ni al LLM', () => {
    expect(
      violations(
        (n) => n.startsWith('billing/') || n.startsWith('customers/'),
        (path) => /fireworks|llm/i.test(path),
      ),
    ).toEqual([]);
  });
});
