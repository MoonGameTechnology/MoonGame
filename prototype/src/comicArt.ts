/**
 * Арт комиксов глав Sector Zero (решение владельца 2026-09-24): рисует владелец, здесь
 * картинки только подключаются. Порядок — `prototype/art/comics/README.md`:
 *
 *   1. страницы лежат в `prototype/art/comics/<глава>/<момент>-<n>.webp`;
 *   2. каждая импортируется здесь и вписывается в `CHAPTER_COMICS` по порядку;
 *   3. внешние подписи — КЛЮЧИ в `/localization`; нарисованный перевод — `imageEn`.
 *
 * Сборка раскладывает картинки сама: в архиве площадки — отдельными файлами в `assets/`
 * (игрок качает их, только когда комикс показывают), в однофайловых сборках — внутрь
 * HTML, как рендеры кораблей (`shipArt.ts`). Реестр и папку сверяет `comicArt.test.ts`:
 * чужая глава, панель без картинки, подпись без перевода и файл, который лежит, но не
 * подключён, роняют гейт, а не доезжают до игрока.
 *
 * Пусто — значит комиксов пока нет, и игра идёт как раньше.
 */
import type { ComicRegistry, ComicTriggers } from '../../decisions/chapterComics';
import training1Intro1 from '../art/comics/training-1/intro-1.webp';
import training1IntroEn1 from '../art/comics/training-1/intro-en-1.webp';
import pve1Intro1 from '../art/comics/pve-1/intro-1.webp';
import pve1Task1 from '../art/comics/pve-1/task-1.webp';
import training1Outro1 from '../art/comics/training-1/outro-1.webp';
import pve1Echo1 from '../art/comics/pve-1/echo-1.webp';
import pve1EchoRecord1 from '../art/comics/pve-1/echo-record-1.webp';
import pve1Outro1 from '../art/comics/pve-1/outro-1.webp';
import pve2Intro1 from '../art/comics/pve-2/intro-1.webp';
import pve2Outro1 from '../art/comics/pve-2/outro-1.webp';
import pve3Intro1 from '../art/comics/pve-3/intro-1.webp';
import pve3Outro1 from '../art/comics/pve-3/outro-1.webp';
import pve4Intro1 from '../art/comics/pve-4/intro-1.webp';
import pve4Task1 from '../art/comics/pve-4/task-1.webp';
import pve4Outro1 from '../art/comics/pve-4/outro-1.webp';
import pve5Intro1 from '../art/comics/pve-5/intro-1.webp';
import pve5Network1 from '../art/comics/pve-5/network-1.webp';
import pve5Captive1 from '../art/comics/pve-5/captive-1.webp';
import pve5Outro1 from '../art/comics/pve-5/outro-1.webp';
import pve6Intro1 from '../art/comics/pve-6/intro-1.webp';
import pve6Refuge1 from '../art/comics/pve-6/refuge-1.webp';
import pve6Rescued1 from '../art/comics/pve-6/rescued-1.webp';
import pve6Outro1 from '../art/comics/pve-6/outro-1.webp';

// Реплики нарисованы на самих страницах. Пока английская версия есть только у
// учебного вступления; остальные страницы используют русский оригинал.
export const CHAPTER_COMICS: ComicRegistry = {
  // «Протокол допуска» — перед учебным полигоном.
  'training-1': {
    intro: [{ image: training1Intro1, imageEn: training1IntroEn1 }],
    outro: [{ image: training1Outro1 }],
  },
  'pve-1': {
    // Инструктаж — перед первой экспедицией.
    intro: [{ image: pve1Intro1 }],
    // Отлёт с учёным — когда задача спасения впервые выполнена.
    task: [{ image: pve1Task1 }],
    echo: [{ image: pve1Echo1 }],
    'echo-record': [{ image: pve1EchoRecord1 }],
    outro: [{ image: pve1Outro1 }],
  },
  'pve-2': { intro: [{ image: pve2Intro1 }], outro: [{ image: pve2Outro1 }] },
  'pve-3': { intro: [{ image: pve3Intro1 }], outro: [{ image: pve3Outro1 }] },
  'pve-4': {
    intro: [{ image: pve4Intro1 }],
    task: [{ image: pve4Task1 }],
    outro: [{ image: pve4Outro1 }],
  },
  // Глава V (§7.7): «Связь прервана» и «Голос Единения» — по событиям главы.
  'pve-5': {
    intro: [{ image: pve5Intro1 }],
    // Первый разрыв сети Роя — факт мира `net.cut` (`storyFacts`, §7.7).
    network: [{ image: pve5Network1 }],
    // Пленный «Голос Единения» доставлен на базу.
    captive: [{ image: pve5Captive1 }],
    outro: [{ image: pve5Outro1 }],
  },
  // Глава VI (§8.9–8.10): «Последний приют» и «Мы пришли за людьми» — по событиям главы,
  // эпилог Учёного — только после победы.
  'pve-6': {
    intro: [{ image: pve6Intro1 }],
    refuge: [{ image: pve6Refuge1 }],
    rescued: [{ image: pve6Rescued1 }],
    outro: [{ image: pve6Outro1 }],
  },
};

/** После какой задачи главы играет комикс момента по событиям. Триггером может быть и шаг
 *  главной цепочки главы (`decisions/chapterChain.ts`): у главы IV это встреча с союзником
 *  (§6.8), у главы VI — доки найдены (запись и живой сигнал, §8.4) и основная эвакуация
 *  завершена (§8.9). И факт мира (`storyFacts`): у главы V — первый разрыв сети Роя (§7.7). */
export const COMIC_TRIGGERS: ComicTriggers = {
  'pve-1': { task: 'mission.rescue-scientist' },
  'pve-4': { task: 'chain.contact' },
  'pve-5': { network: 'net.cut', captive: 'mission.voice-of-unity' },
  'pve-6': { refuge: 'chain.docks', rescued: 'chain.evacuate' },
};
