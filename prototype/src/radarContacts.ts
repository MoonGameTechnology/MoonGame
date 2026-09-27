/** Anonymous contacts produced by the shared-core radar projection in both
 * solo and multiplayer. Rendering never reconstructs hidden fleet identities. */
/** Класс засечки — насколько крупная отметка. */
export type { SignatureSize as SigSize } from '../../packages/shared-core/src/state/radarSignals';
import type {
  SignatureContact,
  SignatureSize as SigSize,
} from '../../packages/shared-core/src/state/radarSignals';

/** Отметка на радаре: чем её помнить, где она и какого размера. */
export interface RadarContact {
  key: string;
  node: string;
  size: SigSize;
  position?: { x: number; y: number };
}

/** Грубый контакт, каким его присылает сервер. */
export type NetSignature = SignatureContact;

/** Контакты из серверных сигнатур: опознанный узел отбрасывается (правила 1, 4, 6). */
export function netContacts(
  sigs: readonly NetSignature[],
  known: (id: string) => boolean,
): RadarContact[] {
  const out: RadarContact[] = [];
  sigs.forEach((c, i) => {
    if (known(c.location)) return;
    const contact: RadarContact = { key: `sig:${c.location}:${i}`, node: c.location, size: c.size };
    if (c.position) contact.position = { ...c.position };
    out.push(contact);
  });
  return out;
}
