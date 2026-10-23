import { Layout } from './components/Layout';
import { useHashRoute } from './lib/route';
import { Admin } from './pages/Admin';
import { Businesses } from './pages/Businesses';
import { Home } from './pages/Home';
import { VerifyReceipt } from './pages/VerifyReceipt';

export function App() {
  const route = useHashRoute();

  return (
    <Layout route={route}>
      {route === '/' && <Home />}
      {route === '/negocios' && <Businesses />}
      {route === '/comprobantes' && <VerifyReceipt />}
      {route === '/panel' && <Admin />}
    </Layout>
  );
}
