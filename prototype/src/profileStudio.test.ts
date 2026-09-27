import { describe, expect, it } from 'vitest';
import { defaultAppearance, type PlayerProfile } from '../../packages/protocol/src/playerProfile';
import { profileStudioHtml, type StudioState } from './profileStudio';
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
