// Deduplicate expensive runs without changing workflow triggers. Only a push can
// be skipped; queue branches, PR, manual and scheduled checks always run in full.
export async function runPolicy({ github, context, core }) {
  if (context.eventName !== 'push') return true;
  if (context.ref.startsWith('refs/heads/gh-readonly-queue/')) {
    // GitHub does not always deliver merge_group (observed with auto-enqueue).
    // The push may be the queue's only run and must produce required contexts.
    core.info('Queue push: keeping required checks even without merge_group delivery.');
    return true;
  }
  if (context.payload.deleted === true) {
    core.info('Deleted branch: nothing to check.');
    return false;
  }
  if (!context.ref.startsWith('refs/heads/')) return true;

  try {
    const branch = context.ref.slice('refs/heads/'.length);
    const { data } = await github.rest.pulls.list({
      ...context.repo,
      state: 'open',
      head: `${context.repo.owner}:${branch}`,
      per_page: 100,
      request: { timeout: 10_000 },
    });
    if (!Array.isArray(data)) throw new Error('E_PR_LOOKUP');
    const covered = data.some(
      (pr) =>
        pr?.state === 'open' &&
        pr.head?.ref === branch &&
        pr.head?.repo?.full_name === `${context.repo.owner}/${context.repo.repo}`,
    );
    core.info(
      covered
        ? 'Push copy skipped: pull_request owns checks for this branch.'
        : 'No open PR: keeping early branch checks.',
    );
    return !covered;
  } catch {
    // Optimization unavailable: spend runner minutes rather than miss a check.
    core.warning('Open PR lookup unavailable; running full branch checks.');
    return true;
  }
}
