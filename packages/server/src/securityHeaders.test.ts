// SE-7.1 — сторож заголовков доставки. Политика проверяется КАК СТРОКА: она уезжает
// браузеру буквально, и опечатка в директиве не роняет ни один тест, зато молча
// выключает защиту (браузер игнорирует неизвестную директиву).
import { describe, expect, it } from 'vitest';
import { apiSecurityHeaders, inlineHashes, securityHeaders } from './securityHeaders';

/** Директива политики по имени — как её прочитает браузер. */
const directive = (csp: string, name: string): string | undefined =>
  csp
    .split(';')
    .map((p) => p.trim())
    .find((p) => p === name || p.startsWith(`${name} `));

describe('inlineHashes — политика считается из того же текста, что уходит игроку', () => {
  it('берёт тело инлайнового скрипта и стиля', () => {
    const h = inlineHashes('<style>body{color:red}</style><script>alert(1)</script>');
    expect(h.styles).toHaveLength(1);
    expect(h.scripts).toHaveLength(1);
    expect(h.scripts[0]).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
  });

  it('РАЗНЫЙ текст — разный хеш: чужой скрипт под сборку не подойдёт', () => {
    const a = inlineHashes('<script>alert(1)</script>').scripts[0];
    const b = inlineHashes('<script>alert(2)</script>').scripts[0];
    expect(a).not.toEqual(b);
  });

  it('атрибуты тега хеш не меняют — хешируется тело, как того требует CSP', () => {
    const plain = inlineHashes('<script>x()</script>').scripts[0];
    const typed = inlineHashes('<script type="module">x()</script>').scripts[0];
    expect(typed).toEqual(plain);
  });

  it('пустой блок пропускается: разрешать пустой скрипт незачем', () => {
    expect(inlineHashes('<script></script><script>  </script>').scripts).toEqual([]);
  });

  it('внешний скрипт хеша не даёт — его в документе игры и не бывает', () => {
    expect(inlineHashes('<script src="x.js"></script>').scripts).toEqual([]);
  });
});

describe('securityHeaders — документ игры', () => {
  const csp = (o = {}): string => securityHeaders(o)['content-security-policy']!;

  it('белый список: всё запрещено по умолчанию (правило 2)', () => {
    expect(directive(csp(), 'default-src')).toBe("default-src 'none'");
    expect(directive(csp(), 'object-src')).toBe("object-src 'none'");
    expect(directive(csp(), 'base-uri')).toBe("base-uri 'none'");
  });

  it('скрипты и стили разрешены ХЕШАМИ, без unsafe-inline (правило 1)', () => {
    const inline = inlineHashes('<style>a{}</style><script>b()</script>');
    const policy = csp({ inline });
    expect(directive(policy, 'script-src')).toBe(`script-src ${inline.scripts[0]}`);
    expect(directive(policy, 'style-src')).toBe(`style-src ${inline.styles[0]}`);
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('без хешей исполнять НЕЧЕГО — политика не пустеет, а запрещает', () => {
    expect(directive(csp(), 'script-src')).toBe("script-src 'none'");
  });

  it('соединения: свой origin и wss, но НЕ плейнтекстный ws (правило 3)', () => {
    expect(directive(csp(), 'connect-src')).toBe("connect-src 'self' wss:");
    expect(directive(csp(), 'connect-src')).not.toContain(' ws:');
  });

  it('встраивание запрещено по умолчанию и перечисляется явно (правило 5)', () => {
    expect(directive(csp(), 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp({ frameAncestors: ['https://portal.example'] }), 'frame-ancestors')).toBe(
      "frame-ancestors https://portal.example",
    );
  });

  // Правило 4: на http://localhost HSTS запомнится браузером для ВСЕГО localhost и
  // сломает разработчику соседние проекты. Признак приходит снаружи, не угадывается.
  it('HSTS только для документа, ушедшего по HTTPS (правило 4)', () => {
    expect(securityHeaders({ https: false })['strict-transport-security']).toBeUndefined();
    expect(securityHeaders({ https: true })['strict-transport-security']).toContain('max-age=');
  });

  it('HSTS не обещает preload — это обязательство, которое снимается месяцами', () => {
    expect(securityHeaders({ https: true })['strict-transport-security']).not.toContain('preload');
  });

  it('COEP не ставится: защищать нечего, а встраивание ломает (правило 6)', () => {
    expect(securityHeaders({ https: true })['cross-origin-embedder-policy']).toBeUndefined();
  });

  it('остальной набор на месте', () => {
    const h = securityHeaders();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['permissions-policy']).toContain('geolocation=()');
    expect(h['cross-origin-resource-policy']).toBe('same-origin');
  });
});

describe('apiSecurityHeaders — JSON-ответам исполнять нечего (правило 7)', () => {
  it('запрещает всё и просит не угадывать тип', () => {
    const h = apiSecurityHeaders();
    expect(h['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(h['x-content-type-options']).toBe('nosniff');
  });

  it('HSTS так же зависит от схемы', () => {
    expect(apiSecurityHeaders(false)['strict-transport-security']).toBeUndefined();
    expect(apiSecurityHeaders(true)['strict-transport-security']).toContain('includeSubDomains');
  });
});
