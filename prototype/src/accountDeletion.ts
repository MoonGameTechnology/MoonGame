import { t } from '../../localization/runtime';
import { requestAccountDeletion, sessionToken } from './accountSession';

export function mountPrivacyLinks(): void {
  const url = (globalThis as { __BUILD__?: { privacyUrl?: string } }).__BUILD__?.privacyUrl;
  for (const id of ['cl-privacy', 'hub-privacy']) {
    const link = document.getElementById(id) as HTMLAnchorElement | null;
    if (!link) continue;
    if (url === 'privacy.html') {
      link.href = url;
      link.addEventListener('click', event => {
        event.preventDefault();
        const dialog = document.createElement('dialog');
        dialog.setAttribute('aria-label', t('welcome.privacy'));
        dialog.style.cssText = 'width:90%;max-width:50rem;height:85%;padding:1rem';
        const frame = document.createElement('iframe');
        frame.src = url; frame.title = t('welcome.privacy'); frame.setAttribute('sandbox', '');
        frame.style.cssText = 'display:block;width:100%;height:calc(100% - 3rem);border:0';
        const close = document.createElement('button'); close.type = 'button';
        close.textContent = t('privacy.close'); close.style.minHeight = '44px';
        close.addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => dialog.remove());
        dialog.append(frame, close); document.body.append(dialog); dialog.showModal();
      });
    } else link.hidden = true;
  }
}

export function mountAccountDeletion(base: () => string | null, accepted: () => void, allowed: () => boolean = () => true): () => Promise<void> {
  const button = document.getElementById('hub-delete-account');
  let generation = 0;
  const refresh = async (): Promise<void> => {
    const current = ++generation;
    if (button) button.hidden = true;
    const server = base();
    if (!button || !allowed() || !server || !sessionToken(server)) return;
    try {
      const response = await fetch(`${server.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/$/, '')}/auth/status`, { signal: AbortSignal.timeout(5000) });
      const status = response.ok ? await response.json() as { enabled?: unknown; accountDeletion?: unknown } : null;
      if (current === generation && server === base() && sessionToken(server) && allowed())
        button.hidden = !(status?.enabled === true && status.accountDeletion === true);
    } catch { /* Leave hidden until capability can be confirmed. */ }
  };
  if (button) button.hidden = true;
  button?.addEventListener('click', () => {
    if (button.hidden || !allowed()) return;
    const server = base();
    const token = server ? sessionToken(server) : null;
    if (!server || !token) return;
    const current = (): boolean => server === base() && sessionToken(server) === token && allowed();
    const dialog = document.createElement('dialog');
    dialog.style.cssText =
      'max-width:32rem;width:90%;padding:1.5rem;color:inherit;background:var(--panel,#17202b);border:1px solid currentColor';
    const heading = document.createElement('h2');
    heading.id = 'account-delete-heading';
    heading.textContent = t('account.delete.title');
    dialog.setAttribute('aria-labelledby', heading.id);
    const warning = document.createElement('p');
    warning.textContent = t('account.delete.warning');
    const form = document.createElement('form');
    const label = document.createElement('label');
    label.textContent = t('account.delete.password');
    const password = document.createElement('input');
    password.type = 'password';
    password.autocomplete = 'current-password';
    password.required = true;
    label.append(password);
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.textContent = t('auth.password.show');
    eye.addEventListener('click', () => {
      password.type = password.type === 'password' ? 'text' : 'password';
      eye.textContent = t(
        password.type === 'password' ? 'auth.password.show' : 'auth.password.hide',
      );
    });
    const confirmation = document.createElement('label');
    confirmation.style.display = 'block';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.required = true;
    confirmation.append(check, document.createTextNode(t('account.delete.confirm')));
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = t('account.delete.send');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.autofocus = true; // showModal must not focus the password and summon the keyboard.
    cancel.textContent = t('account.delete.cancel');
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      password.value = '';
      dialog.remove();
    });
    form.append(label, eye, confirmation, status, submit, cancel);
    dialog.append(heading, warning, form);
    let busy = false;
    dialog.addEventListener('cancel', (event) => {
      if (busy) event.preventDefault();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !check.checked || !password.value) return;
      // Confirmation is for the account/server that opened this dialog. A login
      // from another tab must never turn it into confirmation for another account.
      if (!current()) {
        dialog.close();
        await refresh();
        return;
      }
      busy = true;
      submit.disabled = true;
      cancel.disabled = true;
      const secret = password.value;
      password.value = '';
      password.type = 'password';
      eye.textContent = t('auth.password.show');
      const result = await requestAccountDeletion(server, secret);
      busy = false;
      submit.disabled = false;
      cancel.disabled = false;
      const sameTarget = server === base() && allowed() &&
        (result === 'pending' ? sessionToken(server) === null : sessionToken(server) === token);
      if (result === 'superseded' || !sameTarget) {
        dialog.close();
        await refresh();
        return;
      }
      if (result === 'pending') {
        dialog.close();
        accepted();
      } else
        status.textContent = t(
          result === 'password'
            ? 'account.delete.password-error'
            : result === 'unavailable'
              ? 'account.delete.unavailable'
              : 'account.delete.failed',
        );
    });
    document.body.append(dialog);
    dialog.showModal();
  });
  return refresh;
}
