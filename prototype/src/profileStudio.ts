import {
  PROFILE_MEDALS,
  medalGrade,
  type PlayerProfile,
  type ProfileMedalId,
} from '../../packages/protocol/src/playerProfile';
import { tunicFit, profileMetricKey } from '../../decisions/playerProfile';
import { t } from '../../localization/runtime';
import { esc } from './format';
import { PORTRAITS, MEDAL_ATLAS } from './profileArt';

export const gradeRoman = (grade: number): string => ['', 'I', 'II', 'III'][grade] ?? '';
export const portraitName = (id: number): string => t(`profile.portrait.${id}`);
export function medalName(id: ProfileMedalId, profile: PlayerProfile): string {
  const grade = medalGrade(id, profile.progress);
  return (
    t(`profile.medal.${id}`) +
    (grade ? ` · ${t('profile.grade', { grade: gradeRoman(grade) })}` : '')
  );
}
function emblem(id: ProfileMedalId, profile: PlayerProfile): string {
  const index = PROFILE_MEDALS.findIndex((m) => m.id === id);
  return `<span class="ps-medal" style="background-image:url('${MEDAL_ATLAS}');background-position:${((index % 4) * 100) / 3}% ${Math.floor(index / 4) * 50}%" aria-hidden="true"><i>${gradeRoman(medalGrade(id, profile.progress) ?? 3)}</i></span>`;
}

/** Sections of the owner's editor (UIX-15.3): one job per tab instead of one long scroll. */
export const PROFILE_TABS = ['portrait', 'medals', 'career'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];
const TAB_KEY: Record<ProfileTab, string> = {
  portrait: 'profile.tab.portrait',
  medals: 'profile.tab.medals',
  career: 'profile.tab.career',
};
/** A tab id read back from the DOM, or null when it names no section. */
export const parseProfileTab = (raw: unknown): ProfileTab | null =>
  PROFILE_TABS.find((tab) => tab === raw) ?? null;

export interface StudioState {
  owner: boolean;
  preview: boolean;
  selected: number;
  ready: boolean;
  saving: boolean;
  dirty: boolean;
  notice: string;
  /** Open section of the owner's editor; the portrait when omitted. */
  tab?: ProfileTab;
}

/** All images come from the static import registry; metadata is escaped text.
 *  `career` is the dossier's own markup: the owner's editor gives it the Career tab,
 *  every other view prints it under the card. */
export function profileStudioHtml(profile: PlayerProfile, state: StudioState, career = ''): string {
  const edit = state.owner && !state.preview;
  const disabled = !state.ready || state.saving;
  const worn = profile.slots.filter((id) => id !== null);
  const portrait = PORTRAITS[profile.portrait - 1] ?? PORTRAITS[0];
  // The preview toggle switches the card itself, so it lives under the card.
  const mode = state.owner
    ? `<button type="button" class="ps-mode" data-ps="mode" aria-pressed="${state.preview}">${t(state.preview ? 'profile.customize' : 'profile.preview')}</button>`
    : '';
  const stage = `<div class="ps-card"><div class="ps-stage"><img class="ps-portrait" src="${portrait}" alt="${esc(portraitName(profile.portrait))}"><div class="ps-cloth" style="${tunicFit(profile.portrait)}">${profile.slots.map((id) => `<span class="ps-pin" title="${id ? esc(medalName(id, profile)) : ''}">${id ? emblem(id, profile) : ''}</span>`).join('')}</div></div><div class="ps-caption"><b>${esc(profile.login || t('auth.commander'))}</b><span>${t('profile.worn', { n: worn.length })}</span></div>${mode}</div>`;
  const slots = `<div class="ps-slots" role="group" aria-label="${esc(t('profile.slots'))}">${profile.slots.map((id, i) => `<button data-slot="${i}" ${disabled ? 'disabled' : ''} aria-pressed="${state.selected === i}" aria-label="${esc(t('profile.slot', { n: i + 1 }) + (id ? ': ' + medalName(id, profile) : ''))}">${id ? emblem(id, profile) : '<span aria-hidden="true">+</span>'}<small>${i + 1}</small></button>`).join('')}</div>`;
  const gallery = `<h3>${t('profile.portraits')}</h3><div class="ps-portraits">${PORTRAITS.map((src, i) => `<button data-portrait="${i + 1}" ${disabled ? 'disabled' : ''} aria-pressed="${profile.portrait === i + 1}" title="${esc(portraitName(i + 1))}" aria-label="${esc(portraitName(i + 1))}"><img src="${src}" loading="lazy" alt=""></button>`).join('')}</div>`;
  // Earned medals first, in catalog order; the bar under each card draws its «N / M».
  const earnedFirst = [...PROFILE_MEDALS].sort(
    (a, b) =>
      Number(medalGrade(a.id, profile.progress) === null) -
      Number(medalGrade(b.id, profile.progress) === null),
  );
  const collection = `<h3>${t('profile.collection')}</h3><p>${t('profile.auto-grade')}</p><div class="ps-collection">${earnedFirst
    .map((m) => {
      const grade = medalGrade(m.id, profile.progress);
      const target = grade === 1 ? m.goals[2] : m.goals[grade === 2 ? 2 : grade === 3 ? 1 : 0];
      const progress = profile.progress[m.metric] ?? 0;
      const share = Math.min(100, Math.round((progress / target) * 100));
      return `<button data-medal="${m.id}" ${disabled || grade === null ? 'disabled' : ''} class="${grade === null ? 'locked' : ''}" style="--p:${share}%" aria-pressed="${profile.slots[state.selected] === m.id}">${emblem(m.id, profile)}<span><b>${esc(medalName(m.id, profile))}</b><small>${t(profileMetricKey(m.metric))}</small><small>${progress} / ${target} · ${t(grade === 1 ? 'profile.highest' : grade === null ? 'profile.locked' : 'profile.next-grade')}</small></span></button>`;
    })
    .join('')}</div>`;
  const publicMedals = `<div class="ps-public-medals">${worn.length ? worn.map((id) => `<div>${emblem(id, profile)}<span>${esc(medalName(id, profile))}</span></div>`).join('') : `<p>${t('profile.no-worn')}</p>`}</div>`;
  const tab = state.tab ?? 'portrait';
  const tabs = `<div class="ps-tabs" role="tablist" aria-label="${esc(t('profile.tabs'))}">${PROFILE_TABS.map((id) => `<button type="button" role="tab" id="ps-tab-${id}" data-pstab="${id}" aria-controls="ps-panel-${id}" aria-selected="${id === tab}" tabindex="${id === tab ? 0 : -1}">${t(TAB_KEY[id])}</button>`).join('')}</div>`;
  const panel = (id: ProfileTab, html: string): string =>
    `<div class="ps-panel" role="tabpanel" id="ps-panel-${id}" aria-labelledby="ps-tab-${id}"${id === tab ? '' : ' hidden'}>${html}</div>`;
  const side = edit
    ? tabs +
      panel('portrait', gallery) +
      panel(
        'medals',
        `<h3>${t('profile.slots')}</h3><p>${t('profile.choose-slot')}</p>${slots}<button data-ps="remove" ${disabled || !profile.slots[state.selected] ? 'disabled' : ''}>${t('profile.remove')}</button>${collection}`,
      ) +
      panel('career', career)
    : publicMedals;
  return `<section class="ps-studio"><p class="ps-notice" role="status" aria-live="polite">${esc(state.notice)}</p><div class="ps-layout">${stage}<div class="ps-side">${side}</div></div>${edit ? '' : career}</section>`;
}

/** Cancel and Save as a bar under the dossier, shown only while there is something to
 *  save (UIX-15.3): two greyed-out buttons above the portrait told the player nothing. */
export function profileSaveBarHtml(state: StudioState): string {
  if (!state.owner || !(state.dirty || state.saving)) return '';
  const off = !state.ready || state.saving ? ' disabled' : '';
  return `<div class="ps-savebar"><button type="button" data-ps="cancel"${off}>${t('profile.cancel')}</button><button type="button" class="ps-save" data-ps="save"${off}>${t(state.saving ? 'profile.saving' : 'profile.save')}</button></div>`;
}
