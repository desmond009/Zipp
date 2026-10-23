import { useEffect, useState } from 'react';

/*
 * Hash routing (#/links, #/stats/a8Xk2) instead of a router library.
 * The part after "#" never reaches the server, so app pages can't collide
 * with short codes: /links would be a short link, #/links is the app.
 */
export type Route =
  | { page: 'shorten' }
  | { page: 'links' }
  | { page: 'stats'; code: string | null }
  | { page: 'api' }
  | { page: 'login' };

export function parseHash(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, '').split('/');
  switch (first) {
    case 'links':
      return { page: 'links' };
    case 'stats':
      return { page: 'stats', code: second ? decodeURIComponent(second) : null };
    case 'api':
      return { page: 'api' };
    case 'login':
      return { page: 'login' };
    default:
      return { page: 'shorten' };
  }
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}

/** navigate('/links'), navigate(`/stats/${code}`) */
export function navigate(path: string): void {
  window.location.hash = path;
}
