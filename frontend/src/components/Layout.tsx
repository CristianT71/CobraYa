import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { ROUTES, type RoutePath } from '../lib/route';

function HealthBadge() {
  const [state, setState] = useState<'checking' | 'up' | 'down'>('checking');

  useEffect(() => {
    let active = true;
    void api.health().then((ok) => {
      if (active) setState(ok ? 'up' : 'down');
    });
    return () => {
      active = false;
    };
  }, []);

  const label =
    state === 'checking'
      ? 'Comprobando el servicio…'
      : state === 'up'
        ? 'Servicio disponible'
        : 'Servicio no disponible';

  return (
    <span className="health" role="status">
      <span className={`dot dot-${state}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export function Layout({
  route,
  children,
}: {
  route: RoutePath;
  children: ReactNode;
}) {
  return (
    <>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="#/">
            <img src="/favicon.svg" alt="" width="32" height="32" />
            <span>Facturación y Pagos</span>
          </a>
          <nav aria-label="Principal">
            <ul className="nav">
              {ROUTES.map((item) => (
                <li key={item.path}>
                  <a
                    href={`#${item.path}`}
                    aria-current={route === item.path ? 'page' : undefined}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="contenido" className="container main" tabIndex={-1}>
        {children}
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <strong>Facturación y Pagos</strong>
            <HealthBadge />
          </div>
          <nav aria-label="Secundaria">
            <ul className="footer-links">
              {ROUTES.map((item) => (
                <li key={item.path}>
                  <a href={`#${item.path}`}>{item.label}</a>
                </li>
              ))}
              <li>
                <a href="/docs">API</a>
              </li>
            </ul>
          </nav>
          <p className="footer-legal">
            No es facturación electrónica ante la DIAN ni un sistema contable.
          </p>
        </div>
      </footer>
    </>
  );
}
