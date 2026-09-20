import { expect, it, vi } from 'vitest';
import { initPirateIntro } from './pirateIntro';

function element() {
  const click = { run: () => {} };
  const node = {
    hidden: true, textContent: '',
    addEventListener: (_event: string, fn: () => void) => { click.run = fn; },
  } as unknown as HTMLElement;
  return { node, click };
}

it('focuses the target, opens the first fight once, and honours dismissal until a new run', () => {
  const root = element(), copy = element(), action = element(), close = element();
  const focus = vi.fn(), openBattle = vi.fn();
  const ui = initPirateIntro({ root: root.node, copy: copy.node, action: action.node, close: close.node, focus, openBattle });
  ui.update({ stage: 'approach', sector: 'pirate_den' });
  action.click.run();
  expect(focus).toHaveBeenCalledWith('pirate_den');
  const fight = { stage: 'battle', sector: 'pirate_den', battleId: 'battle:0' } as const;
  ui.update(fight);
  ui.update(fight);
  ui.update(null); // menu / hidden match
  ui.update(fight);
  expect(openBattle).toHaveBeenCalledTimes(1);
  close.click.run();
  ui.update({ ...fight, battleId: 'battle:1' });
  expect(root.node.hidden).toBe(true);
  expect(openBattle).toHaveBeenCalledTimes(1);
  ui.reset();
  ui.update(fight);
  expect(root.node.hidden).toBe(false);
  expect(openBattle).toHaveBeenCalledTimes(2);
});
