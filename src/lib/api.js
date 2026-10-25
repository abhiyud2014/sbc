/**
 * Thin fetch wrapper for the local /api proxy (server/index.js).
 * All Zoom traffic goes through the proxy so credentials never reach the browser.
 *
 * Auth: after sign-in the server issues a bearer token (light auth, see
 * server/index.js). We attach it to every request; a 401 means the session
 * expired or was revoked, so we drop the token and notify the app to show
 * the sign-in screen again.
 */

const TOKEN_KEY = 'sbc.token';

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

export const setToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — session just won't survive a refresh */
  }
};

async function request(path, { method = 'GET', body } = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the local API proxy. Is `npm run dev:api` running on port 8787?');
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  // Signed out (expired / revoked / server restarted) — bounce to the login
  // screen. A failed sign-IN attempt (401 on /auth/login) is left alone so
  // the form can show its own error.
  if (res.status === 401 && token && path !== '/auth/login') {
    setToken('');
    window.dispatchEvent(new Event('sbc:signout'));
  }

  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      (typeof data?.error === 'string' ? data.error : null) ||
      `Request failed with status ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.detail = data;
    throw error;
  }

  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};

export default api;
