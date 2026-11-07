#!/usr/bin/env node
// Read-only inventory of GitHub's OPEN alerts, distinct from a scanner run's SARIF.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Never copy snippets, messages, code flows or detected secret values into the export. */
function projectAlert(a) {
  if (!Number.isSafeInteger(a?.number) || a.number < 1 || a.state !== 'open' || !a.rule || !a.tool)
    throw new Error('E_INVALID_ALERT');
  const location = a.most_recent_instance?.location;
  return {
    number: a.number,
    url: a.html_url,
    state: a.state,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    tool: a.tool.name,
    rule: a.rule.id,
    level: a.rule.severity,
    securitySeverity: a.rule.security_severity_level ?? null,
    location: location
      ? { path: location.path, startLine: location.start_line, endLine: location.end_line }
      : null,
  };
}

export async function snapshotAlerts({
  repo,
  token,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
}) {
  const report = {
    schemaVersion: 1,
    source: 'github-code-scanning',
    repository: repo,
    startedAt: now(),
    finishedAt: null,
    available: false,
    defaultBranch: null,
    observedDefaultBranchSha: null,
    state: 'open',
    count: null,
    byTool: {},
    bySecuritySeverity: {},
    alerts: [],
    error: null,
  };
  try {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? '')) throw new Error('E_REPOSITORY');
    if (!token) throw new Error('E_TOKEN');
    const get = async (path) => {
      const response = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: globalThis.AbortSignal.timeout(30_000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`E_GITHUB_HTTP_${response.status}`);
      try {
        return await response.json();
      } catch {
        throw new Error('E_GITHUB_JSON');
      }
    };
    const metadata = await get('');
    if (typeof metadata.default_branch !== 'string' || !metadata.default_branch)
      throw new Error('E_DEFAULT_BRANCH');
    report.defaultBranch = metadata.default_branch;
    const commit = await get(`/commits/${encodeURIComponent(report.defaultBranch)}`);
    if (!/^[a-f0-9]{40}$/.test(commit.sha ?? '')) throw new Error('E_COMMIT');
    report.observedDefaultBranchSha = commit.sha;
    const ref = encodeURIComponent(`refs/heads/${report.defaultBranch}`);
    const alerts = [],
      seen = new Set();
    for (let page = 1; ; page++) {
      if (page > 1000) throw new Error('E_PAGE_LIMIT');
      const rows = await get(
        `/code-scanning/alerts?state=open&ref=${ref}&sort=created&direction=asc&per_page=100&page=${page}`,
      );
      if (!Array.isArray(rows) || rows.length > 100) throw new Error('E_INVALID_PAGE');
      for (const row of rows) {
        const alert = projectAlert(row);
        if (seen.has(alert.number)) throw new Error('E_DUPLICATE_ALERT');
        seen.add(alert.number);
        alerts.push(alert);
      }
      if (rows.length < 100) break;
    }
    const byTool = new Map(),
      bySeverity = new Map();
    for (const a of alerts) {
      const tool = String(a.tool ?? 'unknown'),
        severity = String(a.securitySeverity ?? 'unspecified');
      byTool.set(tool, (byTool.get(tool) ?? 0) + 1);
      bySeverity.set(severity, (bySeverity.get(severity) ?? 0) + 1);
    }
    report.byTool = Object.fromEntries(byTool);
    report.bySecuritySeverity = Object.fromEntries(bySeverity);
    report.alerts = alerts;
    report.count = alerts.length;
    report.available = true;
  } catch (error) {
    // A failed/partial request is unavailable, never a clean zero or a partial total.
    report.error = /^E_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'E_REQUEST';
  }
  report.finishedAt = now();
  return report;
}

export function snapshotMarkdown(r) {
  return [
    '## Открытые алерты GitHub Code scanning',
    '',
    `Репозиторий: \`${r.repository ?? '—'}\`. Ветка: \`${r.defaultBranch ?? '—'}\`.`,
    `Получено: ${r.finishedAt}. Коммит ветки перед чтением: \`${r.observedDefaultBranchSha ?? '—'}\`.`,
    '',
    r.available
      ? `Открытых алертов: **${r.count}**.`
      : `**Экспорт недоступен: ${r.error}. Число находок неизвестно.**`,
    '',
    'Это состояние панели GitHub, а не число результатов одного запуска сканеров.',
    'API читается постранично в указанном временном интервале; это не атомарный снимок и не подтверждение сканирования указанного коммита.',
    'Полный список с правилами, серьёзностью, путями и ссылками: `code-scanning-alerts.json` в артефакте `code-scanning-alerts`.',
    '',
    '| Сканер | Открыто |',
    '| --- | ---: |',
    ...Object.entries(r.byTool).map(
      ([tool, count]) => `| ${tool.replace(/[|\r\n]/g, ' ')} | ${count} |`,
    ),
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await snapshotAlerts({
    repo: process.env.GITHUB_REPOSITORY,
    token: process.env.GH_TOKEN,
  });
  writeFileSync('code-scanning-alerts.json', JSON.stringify(report, null, 2) + '\n');
  writeFileSync('code-scanning-alerts.md', snapshotMarkdown(report));
  console.log(
    report.available
      ? `Open Code scanning alerts: ${report.count}`
      : `Code scanning export unavailable: ${report.error}`,
  );
  if (!report.available) process.exitCode = 1;
}
