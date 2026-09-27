import { expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { updateCorpInfrastructure } from '../../packages/server/src/corpConstruction';
import { corpBuildingsHtml } from './corpBuildingsView';
function fixture() {
  const result = updateCorpInfrastructure('corp', 'head', 'head', 0, null, 0).result;
  if (!result.ok) throw new Error(result.code);
  return result.infrastructure;
}
  it('shows real cost, effects, head permissions and dependency reasons in both languages', () => {
    for (const locale of ['ru', 'en'] as const) {
      setLocale(locale);
      const html = corpBuildingsHtml(fixture());
      expect(html).toContain('data-corparg="headquarters">');
      expect(html).toContain('data-corparg="supply_center" disabled');
      expect(html).toContain('24');
      expect(html).not.toContain('corp.building.');
      expect(html).not.toContain('E_CORP');
      const member = fixture();
      member.canBuild = false;
      expect(corpBuildingsHtml(member)).toContain('data-corparg="headquarters" disabled');
      expect(corpBuildingsHtml(fixture(), 0, true)).toContain(
        'data-corparg="headquarters" disabled',
      );
      expect(corpBuildingsHtml(null)).not.toContain('data-corpact="build"');
    }
  });

