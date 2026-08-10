import { describe, it, expect } from 'vitest';
import { netContacts, soloContacts, type ContactFleet, type SigSize } from './radarContacts';

const никогдаНеОпознан = () => false;
const всёПодРадаром = () => true;
const размер = (): SigSize => 'M';

interface Флот extends ContactFleet {
  node: string | null;
}
const узел = (f: Флот) => f.node;

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

describe('радар — отбор в соло', () => {
  const чужой: Флот = { id: 'p2-1', owner: 'p2', node: 'C3' };

  it('чужой флот на неопознанном узле под радаром — отметка', () => {
    expect(soloContacts([чужой], 'p1', узел, никогдаНеОпознан, всёПодРадаром, размер)).toEqual([
      { key: 'p2-1', node: 'C3', size: 'M' },
    ]);
  });

  it('СВОЙ ФЛОТ ОТМЕТКОЙ НЕ БЫВАЕТ: он и так виден', () => {
    const свой: Флот = { id: 'p1-1', owner: 'p1', node: 'C3' };
    expect(soloContacts([свой], 'p1', узел, никогдаНеОпознан, всёПодРадаром, размер)).toEqual([]);
  });

  it('опознанный узел отметкой не бывает и в соло', () => {
    expect(soloContacts([чужой], 'p1', узел, (id) => id === 'C3', всёПодРадаром, размер)).toEqual(
      [],
    );
  });

  it('ВНЕ РАДАРА ОТМЕТКИ НЕТ: засекать нечем', () => {
    expect(soloContacts([чужой], 'p1', узел, никогдаНеОпознан, () => false, размер)).toEqual([]);
  });

  it('флот без узла (в пути мимо графа) отметкой не становится', () => {
    const вникуда: Флот = { id: 'p2-2', owner: 'p2', node: null };
    expect(soloContacts([вникуда], 'p1', узел, никогдаНеОпознан, всёПодРадаром, размер)).toEqual(
      [],
    );
  });

  it('ключом в соло служит сам флот, а не узел — два флота в одном узле различимы', () => {
    const второй: Флот = { id: 'p2-9', owner: 'p2', node: 'C3' };
    const из = soloContacts([чужой, второй], 'p1', узел, никогдаНеОпознан, всёПодРадаром, размер);
    expect(из.map((c) => c.key)).toEqual(['p2-1', 'p2-9']);
  });

  it('ОТБОР В СОЛО НЕ СЛАБЕЕ СЕТЕВОГО: свой, опознанный и «вне радара» отсеиваются разом', () => {
    const флоты: Флот[] = [
      { id: 'p1-1', owner: 'p1', node: 'C1' }, // свой
      { id: 'p2-1', owner: 'p2', node: 'C2' }, // узел опознан
      { id: 'p2-2', owner: 'p2', node: 'C3' }, // вне радара
      { id: 'p2-3', owner: 'p2', node: 'C4' }, // единственная настоящая засечка
    ];
    const из = soloContacts(
      флоты,
      'p1',
      узел,
      (id) => id === 'C2',
      (id) => id !== 'C3',
      размер,
    );
    expect(из).toEqual([{ key: 'p2-3', node: 'C4', size: 'M' }]);
  });

  it('ничейный флот своим не считается', () => {
    const ничей: Флот = { id: 'x-1', owner: null, node: 'C5' };
    expect(soloContacts([ничей], 'p1', узел, никогдаНеОпознан, всёПодРадаром, размер)).toHaveLength(
      1,
    );
  });
});
