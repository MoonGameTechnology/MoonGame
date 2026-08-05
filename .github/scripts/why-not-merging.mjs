#!/usr/bin/env node
// Отвечает на один вопрос: ПОЧЕМУ этот PR сейчас не вливается — и пишет ответ туда, где
// его увидят, sticky-комментарием в самом PR.
//
//   node .github/scripts/why-not-merging.mjs
//
// Env: GH_TOKEN, REPO=owner/name, PR=<номер>, STATE=<mergeStateStatus, который увидел
// automerge>, ATTEMPTS=<сколько раз он перечитывал>, RESOLVED=1 (PR поставлен в очередь —
// схлопнуть комментарий в одну строку).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ ЕЩЁ ОДИН ШАГ В automerge.yml. Раньше причина отказа жила
// одной строкой в логе джобы («mergeStateStatus=BLOCKED — ждём следующего прогона»), и
// найти её можно было, только зная, что такая джоба вообще существует, и открыв её лог.
// PR при этом выглядел зелёным и просто стоял. Причина обязана быть там же, где PR.
//
// Pure Node (global fetch), без зависимостей — тот же принцип, что у summarize-security.mjs:
// не тащить в привилегированный воркфлоу неприпиненный установочный шаг.

const token = process.env.GH_TOKEN;
const repo = process.env.REPO ?? '';
const pr = Number(process.env.PR ?? 0);
const observedState = process.env.STATE ?? '';
const attempts = Number(process.env.ATTEMPTS ?? 0);
const resolved = process.env.RESOLVED === '1';
const [owner, name] = repo.split('/');

const MARKER = '<!-- void-automerge-why -->';
// Actions сам выставляет GITHUB_API_URL (на github.com — api.github.com, на GHES — свой).
// Берём его, а не константу: так скрипт заодно проверяется на локальном моке.
const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';

if (!token || !owner || !name || !pr) {
  console.error('why-not-merging: нет GH_TOKEN / REPO / PR — нечего делать');
  process.exit(0);
}

const gh = async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  return { ok: true, status: r.status, data: await r.json().catch(() => null) };
};

const graphql = async (query, variables) => {
  const r = await gh('/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) });
  return r.ok ? (r.data?.data ?? null) : null;
};

// --- 1. состояние PR -----------------------------------------------------------------

const prData = await graphql(
  `query($owner:String!,$name:String!,$number:Int!){
     repository(owner:$owner,name:$name){
       pullRequest(number:$number){
         state isDraft mergeStateStatus baseRefName reviewDecision
         mergeQueueEntry { position }
         commits(last:1){ nodes { commit { oid } } }
       }
     }
   }`,
  { owner, name, number: pr },
);
const p = prData?.repository?.pullRequest;
if (!p) {
  console.error(`why-not-merging: PR #${pr} не читается — выходим тихо`);
  process.exit(0);
}
const headSha = p.commits?.nodes?.[0]?.commit?.oid ?? '';
const state = observedState || p.mergeStateStatus;

// --- 2. чеки на головном коммите -------------------------------------------------------

const checksRes = await gh(`/repos/${repo}/commits/${headSha}/check-runs?per_page=100&filter=latest`);
const checkRuns = checksRes.data?.check_runs ?? [];

// Какие чеки ТРЕБУЕТ ruleset базовой ветки. Без этого нельзя отличить «красный, но
// необязательный» (штатно — чужие CVE в caddy) от «красный и блокирует».
let requiredContexts = [];
let requiredApprovals = 0;
let queueRequired = false;
const rulesRes = await gh(`/repos/${repo}/rules/branches/${encodeURIComponent(p.baseRefName)}`);
for (const rule of rulesRes.data ?? []) {
  if (rule.type === 'required_status_checks') {
    for (const c of rule.parameters?.required_status_checks ?? []) requiredContexts.push(c.context);
  }
  if (rule.type === 'pull_request') {
    requiredApprovals = Math.max(
      requiredApprovals,
      rule.parameters?.required_approving_review_count ?? 0,
    );
  }
  if (rule.type === 'merge_queue') queueRequired = true;
}
const isRequired = (n) => requiredContexts.includes(n);

// --- 3. что именно сломалось ------------------------------------------------------------

const BAD = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'stale']);
const broken = checkRuns.filter((c) => BAD.has(c.conclusion));
const pending = checkRuns.filter((c) => c.status !== 'completed');

/**
 * Классификация по ИМЕНИ УПАВШЕГО ШАГА. Имена шагов в наших воркфлоу — это контракт:
 * блокирующий сканер валится в шаге `gate — …`, информационный — в `report — …`, гейт
 * репозитория — в `pnpm run check` / `Gate (…`. Всё остальное, что упало ДО них, —
 * инфраструктура (не стянулся образ, не встал node, отвалился checkout).
 */
function classify(job, checkRun) {
  if (checkRun.conclusion === 'cancelled')
    return { klass: 'отменён', why: 'прогон отменён (concurrency или вручную) — перезапусти' };
  if (checkRun.conclusion === 'timed_out')
    return { klass: 'таймаут', why: 'джоба не уложилась в лимит' };
  if (!job)
    return {
      klass: 'внешняя проверка',
      why: 'чек создан приложением, а не Actions — смотри его страницу',
    };
  const failed = (job.steps ?? []).find((s) => BAD.has(s.conclusion));
  const step = failed?.name ?? '';
  if (!failed)
    return { klass: 'инфраструктура', why: 'джоба упала вне именованных шагов (раннер/сеть)' };
  if (/^gate — /.test(step))
    return {
      klass: 'сканер',
      why: `находка ЛИБО сбой скана — блокирующий гейт «${step}». Что именно, видно в сводке сканеров этого PR: у сломанного скана в таблице стоит «⚠️ НЕ подтверждён»`,
    };
  if (/^report — /.test(step))
    return {
      klass: 'сканер',
      why: `скан не состоялся — шаг «${step}» валит джобу, когда сканировать было нечего или инструмент не отработал`,
    };
  if (/pnpm run check|^Gate \(/.test(step))
    return {
      klass: 'код',
      why: `упал гейт репозитория (шаг «${step}») — lint / typecheck / тесты. Это НЕ сканер: чинится кодом`,
    };
  if (/^(Set up job|Run actions\/|Post |Complete job)/.test(step))
    return { klass: 'инфраструктура', why: `упал служебный шаг «${step}» — раннер, checkout, сеть` };
  return { klass: 'скрипт', why: `упал шаг «${step}»` };
}

const rows = [];
for (const c of broken) {
  // У Actions id чек-рана совпадает с id джобы; у чеков от приложений — нет, там 404.
  const jobRes = await gh(`/repos/${repo}/actions/jobs/${c.id}`);
  const { klass, why } = classify(jobRes.data, c);
  rows.push({
    name: c.name,
    conclusion: c.conclusion,
    required: isRequired(c.name),
    klass,
    why,
    url: c.html_url ?? c.details_url ?? '',
  });
}
// Обязательные — первыми: именно они держат мерж.
rows.sort((a, b) => Number(b.required) - Number(a.required));

// --- 4. текст ---------------------------------------------------------------------------

const STATE_RU = {
  BLOCKED: 'GitHub считает PR заблокированным: не все обязательные чеки зелёные, либо не хватает ревью, либо ветка защищена правилом',
  BEHIND: 'ветка отстала от базовой — нужно подтянуть `main`',
  DIRTY: 'конфликт с базовой веткой',
  DRAFT: 'PR — черновик',
  UNKNOWN: 'GitHub ещё не досчитал состояние',
  HAS_HOOKS: 'мержу мешает пре-receive хук',
  CLEAN: 'всё зелено',
  UNSTABLE: 'обязательные зелёные, необязательный красный (это НЕ помеха)',
  NO_QUEUE:
    'PR готов, но у его БАЗОВОЙ ветки нет merge queue — ставить некуда. Так бывает у стекового PR: база станет `main`, когда вольётся нижний, и тогда же поедет этот',
};

const blockingBroken = rows.filter((r) => r.required);
const infoBroken = rows.filter((r) => !r.required);

function body() {
  if (resolved) {
    return `${MARKER}\n### 🚦 Авто-мерж\n\n✅ PR поставлен в очередь — очередь перепроверит его на «свежий \`main\` + PR» и вольёт.`;
  }
  const L = [];
  L.push(MARKER);
  L.push('### 🚦 Почему этот PR не вливается автоматически');
  L.push('');
  L.push(
    `**Состояние:** \`${state}\` — ${STATE_RU[state] ?? 'нераспознанное состояние, см. лог авто-мержа'}.`,
  );
  if (attempts > 1) {
    L.push('');
    L.push(
      `_Прочитано ${attempts} раз(а) с паузами: GitHub пересчитывает мержабельность асинхронно, и сразу после позеленевшего чека она ещё может быть \`BLOCKED\`. Здесь состояние держалось до конца ожидания, то есть это не гонка._`,
    );
  }

  if (blockingBroken.length) {
    L.push('');
    L.push('#### ❌ Обязательные чеки, которые упали');
    L.push('');
    L.push('| Чек | Итог | Класс | Что это значит |');
    L.push('| --- | --- | --- | --- |');
    for (const r of blockingBroken)
      L.push(`| [${r.name}](${r.url}) | \`${r.conclusion}\` | **${r.klass}** | ${r.why} |`);
  }

  if (pending.length) {
    L.push('');
    L.push(`#### ⏳ Ещё не отчитались (${pending.length})`);
    L.push('');
    L.push(pending.map((c) => `\`${c.name}\``).join(', '));
  }

  const missing = requiredContexts.filter((n) => !checkRuns.some((c) => c.name === n));
  if (missing.length) {
    L.push('');
    L.push('#### 🕳 Обязательные чеки, которых на коммите НЕТ ВООБЩЕ');
    L.push('');
    L.push(missing.map((n) => `\`${n}\``).join(', '));
    L.push('');
    L.push(
      '_Такой чек ждут вечно. Обычно причина одна: воркфлоу, который его даёт, не подписан на нужное событие (`pull_request` / `merge_group`) либо его джоба пропущена по `if`._',
    );
  }

  if (requiredApprovals > 0 && p.reviewDecision !== 'APPROVED') {
    L.push('');
    L.push(
      `#### 👤 Нужно ревью — требуется одобрений: ${requiredApprovals}, сейчас \`${p.reviewDecision ?? 'нет'}\``,
    );
    L.push('');
    L.push('_Это не чинится автоматикой: PR ждёт человека._');
  }

  if (infoBroken.length) {
    L.push('');
    L.push('#### ℹ️ Красное, но мержу НЕ мешает');
    L.push('');
    L.push('| Чек | Итог | Класс | Что это значит |');
    L.push('| --- | --- | --- | --- |');
    for (const r of infoBroken)
      L.push(`| [${r.name}](${r.url}) | \`${r.conclusion}\` | ${r.klass} | ${r.why} |`);
    L.push('');
    L.push(
      '_Информационные сканеры краснеют штатно (чужие CVE в `caddy`/`gosu` чинятся апстримом). Авто-постановка в очередь их не ждёт._',
    );
  }

  if (!blockingBroken.length && !pending.length && !missing.length && state === 'BLOCKED') {
    L.push('');
    L.push('#### 🤔 Красных обязательных чеков нет, а состояние всё равно `BLOCKED`');
    L.push('');
    L.push(
      'Значит мержу мешает правило ветки, а не проверка: требование ревью, «Require deployments to succeed», запрет на мерж от автора или несогласованный список required-чеков в ruleset. Открой Settings → Rules для `' +
        p.baseRefName +
        '`.',
    );
  }

  if (state === 'BEHIND') {
    L.push('');
    L.push('**Что делать:** нажми «Update branch» — база ушла вперёд.');
  }
  if (state === 'DIRTY') {
    L.push('');
    L.push('**Что делать:** разреши конфликт с `' + p.baseRefName + '`.');
  }
  if (queueRequired && !p.mergeQueueEntry) {
    L.push('');
    L.push(
      '_Мерж идёт только через merge queue. Как только помеха выше уйдёт, авто-мерж поставит PR в очередь сам — руками жать ничего не нужно._',
    );
  }

  L.push('');
  L.push('---');
  L.push(
    '_Комментарий обновляется автоматически на каждом прогоне авто-мержа. Пропадёт — значит PR поехал._',
  );
  return L.join('\n');
}

// --- 5. sticky-комментарий ---------------------------------------------------------------

const list = await gh(`/repos/${repo}/issues/${pr}/comments?per_page=100`);
const existing = (list.data ?? []).find((c) => (c.body ?? '').includes(MARKER));
const text = body();

if (existing) {
  await gh(`/repos/${repo}/issues/comments/${existing.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: text }),
  });
  console.log(`why-not-merging: комментарий обновлён (#${pr})`);
} else if (!resolved) {
  // Успех без прошлого комментария не создаёт нового: молчание — нормальный отчёт о том,
  // что всё поехало само.
  await gh(`/repos/${repo}/issues/${pr}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: text }),
  });
  console.log(`why-not-merging: комментарий создан (#${pr})`);
}
