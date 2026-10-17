/**
 * Вход отдельного потока расчёта соло-мира. Сборка кладёт этот бандл строкой в бандл экрана
 * (`build.mjs`), и экран поднимает поток из неё (`simLink.ts`): так поток работает и в
 * однофайловой сборке, открытой с диска.
 */
import { createSimHost } from './simHost';
import type { SimRequest } from './simProtocol';

const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<SimRequest>) => void) | null;
};
const handle = createSimHost((reply) => scope.postMessage(reply));
scope.onmessage = (event) => handle(event.data);
