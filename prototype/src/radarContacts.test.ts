import { describe, it, expect } from 'vitest';
import { netContacts } from './radarContacts';

const никогдаНеОпознан = () => false;
describe('радар — серверные сигнатуры', () => {
  it('контакт с неопознанного узла становится отметкой', () => {
    expect(netContacts([{ location: 'C1', size: 'L' }], никогдаНеОпознан)).toEqual([
      { key: 'sig:C1:0', node: 'C1', size: 'L' },
    ]);
  });

  it('ОПОЗНАННЫЙ УЗЕЛ ОТМЕТКОЙ НЕ БЫВАЕТ: флот там виден сам', () => {
    expect(netContacts([{ location: 'C1', size: 'S' }], (id) => id === 'C1')).toEqual([]);
  });

  it('КЛЮЧ РАЗЛИЧАЕТ ДВА КОНТАКТА В ОДНОМ УЗЛЕ: иначе память их склеит', () => {
    const из = netContacts(
      [
        { location: 'C1', size: 'S' },
        { location: 'C1', size: 'L' },
      ],
      никогдаНеОпознан,
    );
    expect(из.map((c) => c.key)).toEqual(['sig:C1:0', 'sig:C1:1']);
  });

  it('размер берётся у сервера, а не пересчитывается', () => {
    expect(netContacts([{ location: 'C9', size: 'S' }], никогдаНеОпознан)[0]?.size).toBe('S');
  });

  it('покрытие серверных контактов не перепроверяется — это уже сделал сервер', () => {
    // radarHas сюда не передаётся вовсе: правило применено на той стороне.
    expect(netContacts([{ location: 'C2', size: 'M' }], никогдаНеОпознан)).toHaveLength(1);
  });
});

it('keeps a moving contact at its observed position rather than at the node', () => {
  const position = { x: 250, y: 12 };
  const contacts = netContacts([{ location: 'C1', size: 'M', position }], () => false);
  expect(contacts[0]?.position).toEqual(position);
  position.x = 900;
  expect(contacts[0]?.position?.x).toBe(250);
});
