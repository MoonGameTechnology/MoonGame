/** A foreground observation, independent of match sockets. Failures never block play.
 * Each page has one ephemeral channel; server-side interval unions deduplicate tabs. */
export interface ActivityTarget {
  base: string;
  token: string;
}
export function createActivityReporter(options: {
  target(): ActivityTarget | null;
  request?: typeof fetch;
  channel: string;
}) {
  let sequence = 0;
  let generation = 0;
  let last: ActivityTarget | null = null;
  const request = options.request ?? fetch;
  const send = async (target: ActivityTarget, active: boolean, sectorZero = false): Promise<void> => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5000);
    try {
      await request(target.base.replace(/\/$/, '') + '/activity/pulse', {
        method: 'POST',
        headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: options.channel, sequence: ++sequence, active,
          ...(sectorZero ? { sectorZero: true } : {}),
        }),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        keepalive: true,
        signal: abort.signal,
      });
    } catch {
      /* Observability is optional, including unsupported keepalive/WebView APIs. */
    } finally {
      clearTimeout(timer);
    }
  };
  return async (active: boolean, sectorZero = false): Promise<void> => {
    const call = ++generation;
    let target: ActivityTarget | null;
    try {
      target = options.target();
    } catch {
      target = null;
    }
    const previous = last;
    if (
      previous &&
      (!active || !target || previous.base !== target.base || previous.token !== target.token)
    ) {
      last = null;
      await send(previous, false);
    }
    if (active && target && call === generation) {
      last = target;
      await send(target, true, sectorZero);
    }
  };
}

export function startPlayerActivity(target: () => ActivityTarget | null): { refresh(): void; enterSectorZero(): void; stop(): void } {
  // A missing crypto primitive disables observation, never the game.
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const channel = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    const report = createActivityReporter({ target, channel });
    let stopped = false;
    const visible = () => document.visibilityState === 'visible' && navigator.onLine;
    const pulse = () => {
      if (!stopped) void report(visible());
    };
    const leave = () => {
      void report(false);
    };
    const timer = window.setInterval(pulse, 30_000);
    document.addEventListener('visibilitychange', pulse);
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', pulse);
    window.addEventListener('online', pulse);
    window.addEventListener('offline', leave);
    pulse();
    return { refresh: pulse,
      enterSectorZero: () => {
        if (!stopped && visible()) void report(true, true);
      },
      stop: () => {
      stopped = true;
      window.clearInterval(timer);
      leave();
      document.removeEventListener('visibilitychange', pulse);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', pulse);
      window.removeEventListener('online', pulse);
      window.removeEventListener('offline', leave);
    } };
  } catch {
    return { refresh: () => {}, enterSectorZero: () => {}, stop: () => {} };
  }
}
