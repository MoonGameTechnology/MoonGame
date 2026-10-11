/** Bound the HTTP wait and retain at most ONE pending dependency check. A timeout
 * does not cancel a possibly active database transaction; readiness probes are reads.
 * Once the underlying check settles, the next request may probe again. */
export function boundedReadiness(check: () => boolean | Promise<boolean>, timeoutMs = 1000): () => Promise<boolean> {
  let pending: Promise<boolean> | undefined;
  return () => {
    if (pending) return pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = Promise.resolve().then(check).catch(() => false);
    const result = Promise.race([
      work,
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
    pending = result;
    work.then(() => {
      clearTimeout(timer);
      if (pending === result) pending = undefined;
    }).catch(() => undefined);
    return result;
  };
}
