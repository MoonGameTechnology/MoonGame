import type { TelemetryProps } from '../../protocol/src/telemetry';

export type TutorialGuide = 'main' | 'sector-zero' | 'hud';
export type TutorialOutcome = 'completed' | 'skipped' | 'stopped' | 'exited' | 'replaced' | 'error';

/** Client observations only: no account identity, game state, selectors or copy. */
export function tutorialAnalytics(deps: {
  guide: TutorialGuide;
  attempt: string;
  from: number;
  total: number;
  now(): number;
  emit(props: TelemetryProps): void;
}) {
  const started = deps.now();
  let sequence = 0;
  let closed = false;
  let step = '';
  let stage = '';
  let index = deps.from;
  let skippedStages = 0;
  const send = (action: string): void => {
    if (closed) return;
    try {
      deps.emit({
        guide: deps.guide, attempt: deps.attempt, sequence: sequence++, action,
        step, stage, index, total: deps.total, from: deps.from,
        elapsedMs: Math.max(0, Math.round(deps.now() - started)), skippedStages,
      });
    } catch { /* An observer must never interrupt the lesson. */ }
  };
  send('started');
  return {
    enter(next: { id: string; stage?: string }, at: number): void {
      if (step === next.id && index === at) return;
      step = next.id;
      stage = next.stage ?? '';
      index = at;
      send('step');
    },
    skipStage(): void { skippedStages++; send('stage_skipped'); },
    checkpoint(action: 'heartbeat' | 'hidden' | 'visible' | 'pagehide'): void { send(action); },
    finish(outcome: TutorialOutcome): void { send(outcome); closed = true; },
  };
}
