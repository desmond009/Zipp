import { useAuth } from '../auth';
import type { Route } from '../router';

const NAV = [
  { key: '1', label: 'shorten', href: '#/', page: 'shorten' },
  { key: '2', label: 'links', href: '#/links', page: 'links' },
  { key: '3', label: 'stats', href: '#/stats', page: 'stats' },
  { key: '4', label: 'api', href: '#/api', page: 'api' },
] as const;

export function Header({ route }: { route: Route }) {
  const { user, logout } = useAuth();

  const onUserClick = () => {
    if (window.confirm(`Log out of ${user?.email}?`)) {
      void logout();
    }
  };

  return (
    <header className="header">
      <div className="container header-inner">
        <a className="brand" href="#/">
          <span className="accent">~/</span>zipp
        </a>
        <nav className="nav">
          {NAV.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className={route.page === item.page ? 'nav-item active' : 'nav-item'}
              aria-current={route.page === item.page ? 'page' : undefined}
            >
              [{item.key}] {item.label}
            </a>
          ))}
          {user ? (
            <button className="nav-user" onClick={onUserClick} title="Log out">
              {user.email}
            </button>
          ) : (
            <a className="btn btn-outline" href="#/login">
              $ login
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
