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
export interface StudioState {
  owner: boolean;
  preview: boolean;
  selected: number;
  ready: boolean;
  saving: boolean;
  dirty: boolean;
  notice: string;
}

/** All images come from the static import registry; metadata is escaped text. */
export function profileStudioHtml(profile: PlayerProfile, state: StudioState): string {
  const edit = state.owner && !state.preview;
  const disabled = !state.ready || state.saving;
  const worn = profile.slots.filter((id) => id !== null);
  const portrait = PORTRAITS[profile.portrait - 1] ?? PORTRAITS[0];
  const stage = `<div class="ps-card"><div class="ps-stage"><img class="ps-portrait" src="${portrait}" alt="${esc(portraitName(profile.portrait))}"><div class="ps-cloth" style="${tunicFit(profile.portrait)}">${profile.slots.map((id) => `<span class="ps-pin" title="${id ? esc(medalName(id, profile)) : ''}">${id ? emblem(id, profile) : ''}</span>`).join('')}</div></div><div class="ps-caption"><b>${esc(profile.login || t('auth.commander'))}</b><span>${t('profile.worn', { n: worn.length })}</span></div></div>`;
  const toolbar = state.owner
    ? `<div class="ps-toolbar"><button data-ps="mode" aria-pressed="${state.preview}">${t(state.preview ? 'profile.customize' : 'profile.preview')}</button><button data-ps="save" ${disabled || !state.dirty ? 'disabled' : ''}>${t(state.saving ? 'profile.saving' : 'profile.save')}</button><button data-ps="cancel" ${disabled || !state.dirty ? 'disabled' : ''}>${t('profile.cancel')}</button></div>`
    : '';
  const slots = `<div class="ps-slots" role="group" aria-label="${esc(t('profile.slots'))}">${profile.slots.map((id, i) => `<button data-slot="${i}" ${disabled ? 'disabled' : ''} aria-pressed="${state.selected === i}" aria-label="${esc(t('profile.slot', { n: i + 1 }) + (id ? ': ' + medalName(id, profile) : ''))}">${id ? emblem(id, profile) : '<span aria-hidden="true">+</span>'}<small>${i + 1}</small></button>`).join('')}</div>`;
  const gallery = `<h3>${t('profile.portraits')}</h3><div class="ps-portraits">${PORTRAITS.map((src, i) => `<button data-portrait="${i + 1}" ${disabled ? 'disabled' : ''} aria-pressed="${profile.portrait === i + 1}" title="${esc(portraitName(i + 1))}" aria-label="${esc(portraitName(i + 1))}"><img src="${src}" loading="lazy" alt=""><small>${i + 1}</small></button>`).join('')}</div>`;
  const collection = `<h3>${t('profile.collection')}</h3><p>${t('profile.auto-grade')}</p><div class="ps-collection">${PROFILE_MEDALS.map(
    (m) => {
      const grade = medalGrade(m.id, profile.progress);
      const target = grade === 1 ? m.goals[2] : m.goals[grade === 2 ? 2 : grade === 3 ? 1 : 0];
      const progress = profile.progress[m.metric] ?? 0;
      return `<button data-medal="${m.id}" ${disabled || grade === null ? 'disabled' : ''} class="${grade === null ? 'locked' : ''}" aria-pressed="${profile.slots[state.selected] === m.id}">${emblem(m.id, profile)}<span><b>${esc(medalName(m.id, profile))}</b><small>${t(profileMetricKey(m.metric))}</small><small>${progress} / ${target} · ${t(grade === 1 ? 'profile.highest' : grade === null ? 'profile.locked' : 'profile.next-grade')}</small></span></button>`;
    },
  ).join('')}</div>`;
  const publicMedals = `<div class="ps-public-medals">${worn.length ? worn.map((id) => `<div>${emblem(id, profile)}<span>${esc(medalName(id, profile))}</span></div>`).join('') : `<p>${t('profile.no-worn')}</p>`}</div>`;
  return `<section class="ps-studio">${toolbar}<p class="ps-notice" role="status" aria-live="polite">${esc(state.notice)}</p><div class="ps-layout">${stage}<div class="ps-side">${edit ? `<h3>${t('profile.slots')}</h3><p>${t('profile.choose-slot')}</p>${slots}<button data-ps="remove" ${disabled || !profile.slots[state.selected] ? 'disabled' : ''}>${t('profile.remove')}</button>${gallery}` : publicMedals}</div></div>${edit ? collection : ''}</section>`;
}
