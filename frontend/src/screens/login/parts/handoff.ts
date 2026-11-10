const SIGN_IN_PATHS = ['/login', '/who', '/setup'];

export function nextPath(query: URLSearchParams): string {
  const next = query.get('next');
  if (!next?.startsWith('/') || next.startsWith('//')) {
    return '/';
  }
  const path = next.split(/[?#]/)[0] ?? next;
  return SIGN_IN_PATHS.some((page) => path === page || path.startsWith(`${page}/`)) ? '/' : next;
}

export function carriedQuery(query: URLSearchParams): string {
  const carried = new URLSearchParams();
  for (const key of ['next', 'restored']) {
    const value = query.get(key);
    if (value !== null) {
      carried.set(key, value);
    }
  }
  const search = carried.toString();
  return search === '' ? '' : `?${search}`;
}
