import { describe, expect, it } from 'vitest';
import { RECOVER_SAID, carryEmail, recoverAnswer, recoverStep } from './recoverForm';

describe('идти ли на сервер за ссылкой сброса', () => {
  it('адрес введён — идём, с очищенным от пробелов', () => {
    expect(recoverStep('  a@b.c ')).toEqual({ kind: 'send', email: 'a@b.c' });
  });

  it('ПУСТОЕ ПОЛЕ — НЕ ЗАПРОС: иначе игрок ушёл бы ждать письмо, которое некуда слать', () => {
    expect(recoverStep('')).toEqual({ kind: 'need-mail', key: 'auth.need-mail' });
  });

  it('одни пробелы — тоже пусто', () => {
    expect(recoverStep('   ')).toEqual({ kind: 'need-mail', key: 'auth.need-mail' });
  });
});

describe('что говорят игроку после попытки', () => {
  it('ОТВЕТ ОДИН И ТОТ ЖЕ: сервер ответил или связи не было — не различить', () => {
    expect(recoverAnswer('answered')).toBe(RECOVER_SAID);
    expect(recoverAnswer('unreachable')).toBe(RECOVER_SAID);
    expect(recoverAnswer('answered')).toBe(recoverAnswer('unreachable'));
  });

  it('это ключ локали, а не готовый текст', () => {
    expect(RECOVER_SAID).toBe('auth.recover.sent');
  });
});

describe('перенос адреса с экрана регистрации', () => {
  it('переносится очищенным — скопированный адрес часто с хвостом', () => {
    expect(carryEmail('  a@b.c  ')).toBe('a@b.c');
  });

  it('на экране регистрации почту не вводили — переносить нечего', () => {
    expect(carryEmail('')).toBe('');
    expect(carryEmail('   ')).toBe('');
  });
});
