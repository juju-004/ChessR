type RouteHandler = (params: Record<string, string>) => void;

const routes: { pattern: RegExp; keys: string[]; handler: RouteHandler }[] = [];

export function route(path: string, handler: RouteHandler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/:[a-zA-Z]+/g, (match) => {
        keys.push(match.slice(1));
        return '([^/]+)';
      }) +
      '$',
  );
  routes.push({ pattern, keys, handler });
}

function resolve() {
  const hash = location.hash.slice(1) || '/';
  for (const r of routes) {
    const match = hash.match(r.pattern);
    if (match) {
      const params: Record<string, string> = {};
      r.keys.forEach((key, i) => (params[key] = decodeURIComponent(match[i + 1])));
      r.handler(params);
      return;
    }
  }
  navigate('/'); // fallback
}

export function navigate(path: string) {
  if (location.hash.slice(1) === path) {
    resolve();
  } else {
    location.hash = path;
  }
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}
