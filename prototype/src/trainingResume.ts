/**
 * Кнопка «Вернуть обучение» учебного полигона (заказ владельца 2026-10-25). «Пропустить
 * обучение» гасит подсказки насовсем, а игрок, закрывший их по ошибке или из любопытства,
 * должен вернуться без перезапуска полигона. Кнопка стоит там же, где «Подсказка» свёрнутого
 * обучения, и видна, только пока тура нет; с какого шага вернуть, решает
 * `decisions/tourResume.ts`.
 */
import { t } from '../../localization/runtime';

export interface TrainingResume {
  /** Показать кнопку: нажатие вернёт подсказки с шага `from`. */
  offer(from: number): void;
  hide(): void;
}

export function initTrainingResume(resume: (from: number) => void): TrainingResume {
  let button: HTMLButtonElement | null = null;
  let from = 0;
  const hide = (): void => {
    if (button) button.style.display = 'none';
  };
  const ensure = (): HTMLButtonElement => {
    if (button) return button;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'training-resume';
    b.addEventListener('click', () => {
      hide();
      resume(from);
    });
    document.body.append(b);
    button = b;
    return b;
  };
  return {
    offer(step) {
      from = step;
      const b = ensure();
      b.textContent = t('training.guide.resume');
      b.style.display = 'block';
    },
    hide,
  };
}
