/**
 * Конвейер стройки в панели мира: что идёт, что ждёт очереди, что приостановлено (REFM-36).
 *
 * Правило, которое здесь легко сломать незаметно, и оно уже стоило живого бага:
 * **живые проценты и остаток времени НЕ входят в разметку.** Их дописывает в готовые
 * узлы покадровый патч (`updatePanelLive`), потому что иначе подпись панели менялась бы
 * шестьдесят раз в секунду, панель пересобиралась бы вместе с кнопками стройки, и клик,
 * чьи «нажал» и «отпустил» пришлись на разные пересборки, терялся бы. Именно так
 * когда-то быстрые заказы ставили в очередь один корабль вместо пяти. Поэтому здесь
 * только якоря (`data-at`, `data-dur`), а числа приходят снаружи.
 *
 * Второе правило — про пустой конвейер: **очередь, которой не хватает денег, это НЕ
 * поломка.** Такой конвейер обязан назвать цену, иначе игрок видит «простаивает» и
 * считает, что заказ потерялся.
 */
import { esc } from './format';

/** Что показывать в конвейере — снимок, уже собранный хозяином. */
export interface ConveyorView {
  /** Идущая стройка: подпись, момент завершения, длительность и id для отмены. */
  active: { label: string; at: number; durationMs: number; seq: number } | null;
  /** Очередь после активной, в порядке исполнения. */
  queued: Array<{ label: string }>;
  /** Приостановленные стройки: доля готовности 0..1. `id` — номер площадки в ядре. */
  paused: Array<{ id: string | number; label: string; progress: number }>;
  /** Голова очереди ждёт денег — тогда это её цена (уже размеченная строка). */
  waitingCost: string | null;
  /** Компактная подача (ПК с включённой настройкой): лишние строки убираются. */
  compact: boolean;
}

/** Подписи конвейера — все тексты приходят готовыми, модуль их не сочиняет. */
export interface ConveyorLabels {
  now: string;
  cancel: string;
  waiting: (cost: string) => string;
  idle: string;
  idleTag: string;
  idleSub: string;
  dequeue: string;
  queueEmpty: string;
  paused: (pct: number) => string;
  resume: string;
}

const bar = (extra = ''): string => `<div class="bar"><i${extra} style="width:0%"></i></div>`;

/** Разметка конвейера одной полосы. Чистая: ни DOM, ни состояния. */
export function conveyorHtml(
  planetId: string,
  lane: string,
  view: ConveyorView,
  labels: ConveyorLabels,
): string {
  const key = `c:${esc(planetId)}:${esc(lane)}`;
  let html = `<div class="conveyor">`;

  if (view.active) {
    const a = view.active;
    // Только якоря: число процентов и остаток дописывает покадровый патч (см. шапку).
    html +=
      `<div class="current" data-desc="${key}:active:${a.seq}">` +
      `<span>${labels.now}</span><b>${a.label}</b>` +
      `<em class="conv-time" data-at="${a.at}">—</em>` +
      `<button class="conv-cancel" data-act="cancelbuild" data-arg="${a.seq}" title="${esc(labels.cancel)}">✕</button>` +
      `</div>`;
    html += bar(` class="conv-fill" data-at="${a.at}" data-dur="${a.durationMs}"`);
  } else if (view.waitingCost !== null) {
    // Очередь НЕ застряла — её голову просто пока не на что оплатить. Говорим это
    // ценой, а не строкой «простаивает», которая читается как сломанный конвейер.
    html += `<div class="current idle"><b>⏳ ${labels.waiting(view.waitingCost)}</b></div>`;
    html += bar();
  } else if (view.compact) {
    html += `<div class="current idle"><b>${labels.idle}</b></div>`;
    html += bar();
  } else {
    html += `<div class="current idle"><span>${labels.idleTag}</span><b>${labels.idleSub}</b><em>—</em></div>`;
    html += bar();
  }

  if (view.queued.length) {
    html +=
      `<div class="queue">` +
      view.queued
        .map(
          (q, i) =>
            `<span data-desc="${key}:queued:${i}"><em>${i + 1}</em>${q.label}` +
            `<button class="q-x" data-act="dequeue" data-arg="${esc(lane)}:${i}" title="${esc(labels.dequeue)}">✕</button></span>`,
        )
        .join('') +
      `</div>`;
  } else if (!view.compact) {
    html += `<div class="queue empty">${labels.queueEmpty}</div>`;
  }

  if (view.paused.length) {
    html +=
      `<div class="paused">` +
      view.paused
        .map(
          (p) =>
            `<span data-desc="${key}:paused:${esc(String(p.id))}">` +
            `<em>${labels.paused(Math.round(p.progress * 100))}</em>${p.label}` +
            `<button class="p-go" data-act="resumebuild" data-arg="${esc(String(p.id))}" title="${esc(labels.resume)}">▶</button></span>`,
        )
        .join('') +
      `</div>`;
  }

  return html + `</div>`;
}
