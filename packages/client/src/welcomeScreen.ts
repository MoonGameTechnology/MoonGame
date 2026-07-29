/**
 * First-launch welcome screen — the identity gate a fresh install sees before any
 * account exists (the screen *above* the match browser). This module is the
 * **framework-agnostic view-model**: the static description of the screen plus a
 * pure reducer that turns a user action into a routing outcome. The renderer (RN
 * view, or the prototype's DOM) draws it and localises the labels.
 *
 * Why a view-model and not a rendered screen: real accounts/OIDC are not built yet
 * (the decision is an external provider — docs/accounts-roadmap.md AC-1.1), and the
 * RN client shell is still a placeholder. So this lands the screen's *logic* — the
 * social-sign-in stub, nick validation, single-player route — as shared, tested code
 * the future RN view binds to, without pulling a UI runtime in speculatively.
 *
 * Invariants (mirrors the core's discipline): pure + deterministic (no Date/random),
 * outputs are JSON-serialisable, and validation is **fail-secure** — a bad action
 * yields `{ ok: false, code }` with a stable code only, never a thrown detail.
 */
import { t } from './i18n';

/** External sign-in providers we plan to support (docs/accounts-roadmap.md AC-1.1:
 *  Google / Apple via OIDC). Facebook from the genre reference is intentionally
 *  dropped — it is not in our identity plan. */
export type AuthProviderId = 'google' | 'apple';

export interface AuthProvider {
  id: AuthProviderId;
  label: string;
  /** `false` until OIDC lands — the button is a styled stub that drops the player
   *  into guest play rather than performing a real sign-in. */
  available: boolean;
}

/** A footer legal entry (imprint / terms / privacy / support). `id` is stable for
 *  routing/analytics; `label` is the localised display text. */
export interface LegalLink {
  id: string;
  label: string;
}

/** Languages the menu offers. Only Russian ships today; the field exists so the
 *  language chip is data-driven (docs/main-menu.md §5.4). */
export type LanguageCode = 'ru';

/** Localised text for the welcome screen. Keeping strings in a bundle (not hardcoded
 *  in the model) honours the i18n seam (docs/main-menu.md §5.4 — "не хардкодить
 *  строки"); `defaultStrings` (built from `/localization` via `t()`, LOC-3) is the
 *  shipping default. */
export interface WelcomeStrings {
  title: string;
  tagline: string;
  newPlayer: string;
  signInWith: string;
  login: string;
  singlePlayer: string;
  providerLabels: Record<AuthProviderId, string>;
  legal: LegalLink[];
}

/** The shipping strings bundle — every value is a `/localization` key lookup
 *  (`t()`), never a literal: the code carries no human-readable text (LOC-3). */
export const defaultStrings: WelcomeStrings = {
  title: t('welcome.title'),
  tagline: t('welcome.tagline'),
  newPlayer: t('welcome.new'),
  signInWith: t('welcome.divider'),
  login: t('welcome.login'),
  singlePlayer: t('welcome.solo'),
  providerLabels: { google: t('welcome.google'), apple: t('welcome.apple') },
  legal: [
    { id: 'imprint', label: t('welcome.imprint') },
    { id: 'terms', label: t('welcome.terms') },
    { id: 'privacy', label: t('welcome.privacy') },
    { id: 'support', label: t('welcome.support') },
  ],
};

/** The static, render-ready description of the welcome screen. */
export interface WelcomeModel {
  title: string;
  tagline: string;
  language: LanguageCode;
  languages: LanguageCode[];
  newPlayerLabel: string;
  signInWithLabel: string;
  providers: AuthProvider[];
  loginLabel: string;
  singlePlayerLabel: string;
  legal: LegalLink[];
}

/** Build the welcome model from a strings bundle (the localized default unless the
 *  caller passes another). Social providers are stubs (`available: false`) until
 *  OIDC lands. */
export function createWelcomeModel(strings: WelcomeStrings = defaultStrings): WelcomeModel {
  return {
    title: strings.title,
    tagline: strings.tagline,
    language: 'ru',
    languages: ['ru'],
    newPlayerLabel: strings.newPlayer,
    signInWithLabel: strings.signInWith,
    providers: [
      { id: 'google', label: strings.providerLabels.google, available: false },
      { id: 'apple', label: strings.providerLabels.apple, available: false },
    ],
    loginLabel: strings.login,
    singlePlayerLabel: strings.singlePlayer,
    legal: strings.legal,
  };
}

/** What the player did on the welcome screen. */
export type WelcomeAction =
  | { kind: 'newPlayer' }
  | { kind: 'signIn'; provider: AuthProviderId }
  | { kind: 'login'; nick: string }
  | { kind: 'singlePlayer' };

/** Where the host should route next. `noticeKey` is a *key*, not a sentence — the
 *  renderer localises it (i18n seam); `provider` lets it name which stub was used. */
export type WelcomeOutcome =
  | {
      ok: true;
      route: 'browse';
      /** `new` = assign a fresh callsign; `returning` = use the supplied nick. */
      mode: 'new' | 'returning';
      nick?: string;
      noticeKey?: 'guest_stub';
      provider?: AuthProviderId;
    }
  | { ok: true; route: 'single' }
  | { ok: false; code: string };

/** Pure reducer: map a welcome action to a routing outcome. Fail-secure — unknown
 *  provider or an empty login nick returns a stable error code, never throws. */
export function resolveWelcomeAction(action: WelcomeAction, model: WelcomeModel): WelcomeOutcome {
  switch (action.kind) {
    case 'newPlayer':
      return { ok: true, route: 'browse', mode: 'new' };
    case 'singlePlayer':
      return { ok: true, route: 'single' };
    case 'signIn': {
      const provider = model.providers.find((p) => p.id === action.provider);
      if (!provider) {
        return { ok: false, code: 'E_UNKNOWN_PROVIDER' };
      }
      // Stub: a not-yet-available provider drops the player into guest play with a
      // "скоро" notice. When OIDC lands, an available provider routes as returning.
      return provider.available
        ? { ok: true, route: 'browse', mode: 'returning', provider: provider.id }
        : { ok: true, route: 'browse', mode: 'new', noticeKey: 'guest_stub', provider: provider.id };
    }
    case 'login': {
      const nick = action.nick.trim();
      if (!nick) {
        return { ok: false, code: 'E_NO_NICK' };
      }
      return { ok: true, route: 'browse', mode: 'returning', nick };
    }
  }
}

/** Callsign suggestions for a brand-new commander. The host persists the sequence
 *  number; the wordlist (`callsign.*` in `/localization`) is shared with the
 *  prototype so both surfaces suggest the same names. */
export const CALLSIGNS = [
  t('callsign.rhino'),
  t('callsign.comet'),
  t('callsign.viper'),
  t('callsign.orion'),
  t('callsign.vector'),
  t('callsign.falcon'),
  t('callsign.titan'),
  t('callsign.quasar'),
] as const;

/** Deterministic callsign for a 0-based sequence number (no random/time): the
 *  wordlist cycles, the suffix counts up. `nextCallsign(0)` → `Носорог-1`. */
export function nextCallsign(seq: number): string {
  const i = ((seq % CALLSIGNS.length) + CALLSIGNS.length) % CALLSIGNS.length;
  return `${CALLSIGNS[i]}-${seq + 1}`;
}
