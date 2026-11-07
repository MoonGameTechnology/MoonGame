import { addTemplate, MAX_TEMPLATE_NAME, type BuildTemplate } from '../../decisions/buildTemplates';
import { t } from '../../localization/runtime';

interface Editor {
  dialog: HTMLDialogElement;
  template?: BuildTemplate;
  submitting: boolean;
}
const editors = new WeakMap<HTMLElement, Editor>();
const bound = new WeakSet<HTMLElement>();
export function closeTemplateDialog(root: HTMLElement): boolean {
  const editor = editors.get(root);
  if (!editor) return false;
  editor.dialog.close();
  editor.dialog.remove();
  editors.delete(root);
  return true;
}

/** A body portal survives the live yard repaint; the captured build cannot change while naming. */
function openEditor(root: HTMLElement, template?: BuildTemplate, deletion?: string): void {
  closeTemplateDialog(root);
  const dialog = root.ownerDocument.createElement('dialog');
  dialog.className = 'pw-template-editor';
  const heading = template ? t('yard.tpl.save') : t('production.template-delete');
  dialog.setAttribute('aria-label', heading);
  dialog.innerHTML =
    `<header><b></b><button class="btn-x" data-pw-template-close aria-label="${t('production.fitting-close')}">×</button></header>` +
    (template
      ? `<label>${t('production.template-name')}<input data-pw-template-name maxlength="${MAX_TEMPLATE_NAME}" autocomplete="off"></label><p class="pw-template-error" role="alert"></p>`
      : `<p>${t('production.template-delete-question')}</p>`) +
    `<footer><button class="btn-second" data-pw-template-close>${t('production.cancel')}</button><button class="btn-main" data-pw-template-submit></button></footer>`;
  dialog.querySelector('header b')!.textContent = heading;
  const confirm = dialog.querySelector<HTMLButtonElement>('[data-pw-template-submit]')!;
  confirm.textContent = template ? t('production.save') : t('production.template-delete');
  const editor: Editor = {
    dialog,
    template: template && { ...template, modules: [...template.modules] },
    submitting: false,
  };
  editors.set(root, editor);
  root.ownerDocument.body.append(dialog);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeTemplateDialog(root);
  });
  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-pw-template-close]') || target === dialog) {
      closeTemplateDialog(root);
      return;
    }
    if (!target.closest('[data-pw-template-submit]')) return;
    editor.submitting = true;
    try {
      // Replay the existing UI command against the current root, with the captured draft/name.
      const button = template
        ? root.querySelector<HTMLElement>('[data-cntplsave]')
        : Array.from(root.querySelectorAll<HTMLElement>('[data-cntpldel]')).find(
            (el) => el.dataset.cntpldel === deletion,
          );
      button?.click();
      if (!template) closeTemplateDialog(root);
    } finally {
      editor.submitting = false;
    }
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.target as HTMLElement).matches('[data-pw-template-name]')) {
      event.preventDefault();
      confirm.click();
    }
  });
  dialog.showModal();
  dialog.querySelector<HTMLInputElement>('input')?.focus();
}

export function wireTemplateDialogs(root: HTMLElement): void {
  if (bound.has(root)) return;
  bound.add(root);
  root.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement;
      const del = target.closest<HTMLElement>('[data-cntpldel]');
      if (!del || editors.get(root)?.submitting) return;
      event.stopImmediatePropagation();
      openEditor(root, undefined, del.dataset.cntpldel);
    },
    true,
  );
  new MutationObserver(() => {
    if (!root.classList.contains('show')) closeTemplateDialog(root);
  }).observe(root, { attributes: true, attributeFilter: ['class'] });
}

export function saveNamedTemplate(
  root: HTMLElement,
  list: readonly BuildTemplate[],
  template: BuildTemplate,
) {
  if (root.nodeType !== 1) return addTemplate(list, template);
  const editor = editors.get(root);
  if (!editor?.submitting) {
    openEditor(root, template);
    return { ok: false as const, reason: 'editing' as const };
  }
  const name = editor.dialog.querySelector<HTMLInputElement>('input')!.value.trim();
  const result = !name
    ? { ok: false as const, reason: 'empty' as const }
    : addTemplate(list, { ...editor.template!, name });
  if (!result.ok) {
    const message = editor.dialog.querySelector<HTMLElement>('.pw-template-error')!;
    const keys = {
      empty: 'production.template-name-empty',
      name: 'production.template-name-taken',
      duplicate: 'production.template-duplicate',
      full: 'production.template-full',
    };
    message.textContent = t(keys[result.reason]);
  } else closeTemplateDialog(root);
  return result;
}
