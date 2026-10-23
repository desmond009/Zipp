import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { useKeyboardShortcuts } from './hooks';
import { ApiPage } from './pages/ApiPage';
import { LinksPage } from './pages/LinksPage';
import { LoginPage } from './pages/LoginPage';
import { ShortenPage } from './pages/ShortenPage';
import { StatsPage } from './pages/StatsPage';
import { navigate, useHashRoute, type Route } from './router';

export function App() {
  const route = useHashRoute();

  // [1]..[4] in the nav are real shortcuts.
  useKeyboardShortcuts({
    '1': () => navigate('/'),
    '2': () => navigate('/links'),
    '3': () => navigate('/stats'),
    '4': () => navigate('/api'),
  });

  return (
    <div className="app">
      <Header route={route} />
      <main className="container main">
        <Page route={route} />
      </main>
      <Footer />
    </div>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case 'shorten':
      return <ShortenPage />;
    case 'links':
      return <LinksPage />;
    case 'stats':
      // key: switching between links remounts the page, resetting its state and live stream.
      return <StatsPage key={route.code ?? ''} code={route.code} />;
    case 'api':
      return <ApiPage />;
    case 'login':
      return <LoginPage />;
  }
}
