/** RuStore network client has no campaign entry or campaign UI lifecycle. */
type Shell = typeof import('./sectorZeroShell');
const noop = () => {};
export const sectorZeroMenu = { isOpen: () => false, canGoBack: () => false, back: noop, hide: noop };
export const runWallet = { render: noop };
export const initSectorZeroShell: Shell['initSectorZeroShell'] = noop;
export const openSectorZero: Shell['openSectorZero'] = noop;
export const openAbandon: Shell['openAbandon'] = noop;
export const closeAbandon: Shell['closeAbandon'] = noop;
export const syncSectorZeroTools: Shell['syncSectorZeroTools'] = noop;
export const tickAbandon: Shell['tickAbandon'] = noop;
export const syncShopDay: Shell['syncShopDay'] = noop;
export const playTaskComic: Shell['playTaskComic'] = noop;
export const playChapterComic: Shell['playChapterComic'] = (_chapter, _moment, then) => then();
export const watchAd: Shell['watchAd'] = async () => 'unavailable';
