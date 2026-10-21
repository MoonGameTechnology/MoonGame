/**
 * Состав корпорации (CORP-3): что игрок может сделать с участником. Права — те же, что
 * проверяет сервер (`packages/server/src/corpService.ts`): кнопки, которой сервер откажет,
 * нет. Решение общее для вкладки хаба и окна корпорации в партии.
 *
 * 1. **Заявку** (роль `recruit`) принимают и отклоняют глава и офицеры.
 * 2. **Главу и себя не трогает никто:** главенство уходит только передачей, а из
 *    корпорации уходят своей кнопкой, не исключением.
 * 3. **Глава** делает участника офицером и офицера участником, передаёт главенство и
 *    исключает любого.
 * 4. **Офицер** исключает только участников: другие офицеры ему не подчинены.
 */

export type CorpMemberRole = 'head' | 'officer' | 'member' | 'recruit';

/** Действие над участником; `officer` и `member` — назначить эту роль. */
export type CorpMemberAction = 'accept' | 'decline' | 'officer' | 'member' | 'transfer' | 'kick';

/** Действия, которые игрок с ролью `myRole` может применить к участнику. */
export function corpMemberActions(
  myRole: CorpMemberRole,
  myId: string,
  target: { accountId: string; role: CorpMemberRole },
): CorpMemberAction[] {
  const manager = myRole === 'head' || myRole === 'officer';
  if (target.role === 'recruit') return manager ? ['accept', 'decline'] : [];
  if (target.accountId === myId || target.role === 'head' || !manager) return [];
  if (myRole === 'head')
    return [target.role === 'officer' ? 'member' : 'officer', 'transfer', 'kick'];
  return target.role === 'officer' ? [] : ['kick'];
}
