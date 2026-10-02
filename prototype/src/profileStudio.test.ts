import { describe, expect, it } from 'vitest';
import { defaultAppearance, type PlayerProfile } from '../../packages/protocol/src/playerProfile';
import { profileSaveBarHtml, profileStudioHtml, type StudioState } from './profileStudio';
import { setLocale } from '../../localization/runtime';

const state: StudioState = {
  owner: true,
  preview: false,
  selected: 0,
  ready: true,
  saving: false,
  dirty: false,
  notice: '',
};
const profile: PlayerProfile = {
  ...defaultAppearance(),
  login: '<img src=x onerror=alert(1)>',
  xp: 0,
  progress: { wins: 10 },
};
describe('profile editor and public portrait', () => {
  it('offers all forty portraits and exactly fifteen medal positions', () => {
    const html = profileStudioHtml(profile, state);
    expect([...html.matchAll(/data-portrait="/g)]).toHaveLength(40);
    expect([...html.matchAll(/data-slot="/g)]).toHaveLength(15);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });
  it('public and owner preview render the same tunic, and no editing controls', () => {
    const worn = { ...profile, slots: [...profile.slots] };
    worn.slots[9] = 'first';
    const publicView = profileStudioHtml(worn, { ...state, owner: false });
    const preview = profileStudioHtml(worn, { ...state, preview: true });
    const cloth = (html: string) => /<div class="ps-cloth".*?<\/div>/.exec(html)?.[0];
    expect(cloth(preview)).toBe(cloth(publicView));
    expect(publicView).not.toMatch(/data-portrait=|data-slot=|data-medal=|data-ps=/);
    expect(publicView).toContain('>II</i>');
    expect(publicView).not.toContain('>III</i>');
  });
  it('English and Russian both localize the collection and grade guidance', () => {
    for (const locale of ['en', 'ru'] as const) {
      setLocale(locale);
      const html = profileStudioHtml(profile, state);
      expect(html).not.toMatch(/profile\.(metric|medal|portrait|autoGrade)/);
      expect(html).toContain(locale === 'en' ? 'Class II' : 'II степень');
    }
  });
});

describe('profile tabs, collection order and save bar (UIX-15.3)', () => {
  const panel = (html: string, id: string) =>
    new RegExp(`<div class="ps-panel" role="tabpanel" id="ps-panel-${id}"[^>]*>`).exec(html)?.[0] ??
    '';
  const panelBody = (html: string, id: string) => {
    const open = panel(html, id);
    const from = html.indexOf(open) + open.length;
    const next = html.indexOf('<div class="ps-panel"', from);
    return html.slice(from, next < 0 ? undefined : next);
  };

  it('the owner editor opens on the portrait tab and hides the other two', () => {
    const html = profileStudioHtml(profile, state, '<div class="pf-grid">career</div>');
    expect([...html.matchAll(/role="tab" /g)]).toHaveLength(3);
    expect(html).toMatch(/data-pstab="portrait"[^>]*aria-selected="true"[^>]*tabindex="0"/);
    expect(html).toMatch(/data-pstab="medals"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(panel(html, 'portrait')).not.toContain('hidden');
    expect(panel(html, 'medals')).toContain('hidden');
    expect(panel(html, 'career')).toContain('hidden');
    expect(panelBody(html, 'portrait')).toContain('data-portrait="1"');
    expect(panelBody(html, 'medals')).toContain('data-slot="0"');
    expect(panelBody(html, 'medals')).toContain('data-medal=');
    expect(panelBody(html, 'career')).toContain('career');
  });

  it('the open tab follows the state', () => {
    const html = profileStudioHtml(profile, { ...state, tab: 'career' });
    expect(html).toMatch(/data-pstab="career"[^>]*aria-selected="true"/);
    expect(panel(html, 'career')).not.toContain('hidden');
    expect(panel(html, 'portrait')).toContain('hidden');
  });

  it('the preview and the public card have no tabs and print the career under the card', () => {
    for (const view of [
      { ...state, preview: true },
      { ...state, owner: false },
    ]) {
      const html = profileStudioHtml(profile, view, '<div class="pf-grid">career</div>');
      expect(html).not.toContain('role="tablist"');
      expect(html).toMatch(/<\/div><\/div><div class="pf-grid">career<\/div><\/section>$/);
    }
  });

  it('the preview toggle sits on the card, for the owner only', () => {
    const own = profileStudioHtml(profile, state);
    expect(own).toMatch(/<div class="ps-card">.*data-ps="mode".*<\/div><div class="ps-side">/);
    expect(profileStudioHtml(profile, { ...state, owner: false })).not.toContain('data-ps="mode"');
  });

  it('earned medals come first, each with its progress share for the bar', () => {
    // 25 completed matches: «Ветеран» (service) has grade III, every other medal is locked.
    const veteran = { ...profile, progress: { matches: 25 } };
    const order = [...profileStudioHtml(veteran, state).matchAll(/data-medal="([a-z]+)"/g)].map(
      (m) => m[1],
    );
    expect(order[0]).toBe('service');
    expect(order).toHaveLength(12);
    const card = /<button data-medal="service"[^>]*>/.exec(profileStudioHtml(veteran, state))?.[0];
    expect(card).toContain('--p:25%'); // 25 of the 100 matches for grade II
    expect(card).not.toContain('locked');
  });

  it('the save bar exists only for the owner with unsaved changes', () => {
    expect(profileSaveBarHtml(state)).toBe('');
    expect(profileSaveBarHtml({ ...state, owner: false, dirty: true })).toBe('');
    const bar = profileSaveBarHtml({ ...state, dirty: true });
    expect(bar).toContain('data-ps="cancel"');
    expect(bar).toContain('data-ps="save"');
    expect(bar).not.toContain('disabled');
    const saving = profileSaveBarHtml({ ...state, dirty: true, saving: true });
    expect([...saving.matchAll(/disabled/g)]).toHaveLength(2);
    // The editor itself no longer carries Save and Cancel.
    expect(profileStudioHtml(profile, { ...state, dirty: true })).not.toMatch(
      /data-ps="(save|cancel)"/,
    );
  });
});
