import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run an async loader, track { loading, data, error } and expose refresh().
 * `key` is a plain dependency list (strings/numbers) that re-triggers the load.
 */
export function useApi(loader, key = [], { immediate = true } = {}) {
  const [state, setState] = useState({ loading: immediate, data: null, error: null });
  const [version, setVersion] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const signature = JSON.stringify(key);

  useEffect(() => {
    if (!immediate) return undefined;
    let alive = true;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    loaderRef
      .current()
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error: error.message }));

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, version, immediate]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback(
    (updater) => setState((prev) => ({ ...prev, data: typeof updater === 'function' ? updater(prev.data) : updater })),
    []
  );

  return { ...state, refresh, setData };
}

/** Generic "is this action running?" flag for buttons. */
export function usePending() {
  const [pending, setPending] = useState(false);
  const run = useCallback(async (fn) => {
    setPending(true);
    try {
      return await fn();
    } finally {
      setPending(false);
    }
  }, []);
  return [pending, run];
}
