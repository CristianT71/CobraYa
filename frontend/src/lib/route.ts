import { useEffect, useState } from 'react';

// Enrutado por hash (#/negocios): el servicio entrega una sola página y no hace
// falta configurar redirecciones en el servidor.

export const ROUTES = [
  { path: '/', label: 'Inicio' },
  { path: '/negocios', label: 'Para negocios' },
  { path: '/comprobantes', label: 'Verificar comprobante' },
  { path: '/panel', label: 'Panel' },
] as const;

export type RoutePath = (typeof ROUTES)[number]['path'];

export function parseHash(hash: string): RoutePath {
  const path = hash.replace(/^#/, '').split('?')[0] || '/';
  const known = ROUTES.find((route) => route.path === path);
  return known ? known.path : '/';
}

export function useHashRoute(): RoutePath {
  const [route, setRoute] = useState<RoutePath>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}
