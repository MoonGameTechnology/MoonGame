import { describe, expect, it, vi } from 'vitest';
import { MapPreparation } from './mapPreparation';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('map preparation lifecycle', () => {
  it('paints first, counts actual completion, and keeps the cover until the host renders', async () => {
    const frame = deferred(),
      image = deferred();
    const loader = new MapPreparation(
      () => frame.promise,
      () => 0,
    );
    const progress = vi.fn(),
      geometry = vi.fn();
    const running = loader.start(
      [
        { label: 'image', run: () => image.promise },
        { label: 'geometry', run: geometry },
      ],
      progress,
    );
    expect(progress.mock.calls).toEqual([[0, 2, 'image']]);
    expect(geometry).not.toHaveBeenCalled();
    frame.resolve();
    await Promise.resolve();
    expect(loader.ready).toBe(false);
    image.resolve();
    await running;
    expect(progress.mock.calls).toEqual([
      [0, 2, 'image'],
      [1, 2, 'geometry'],
      [2, 2, 'geometry'],
    ]);
    expect(loader.ready).toBe(true);
    expect(loader.active).toBe(true);
    loader.cancel();
    expect(loader.active).toBe(false);
  });

  it('yields when a work slice has used its frame budget without a minimum loading delay', async () => {
    let time = 0;
    const nextFrame = vi.fn(async () => {});
    const loader = new MapPreparation(nextFrame, () => time);
    await loader.start(
      Array.from({ length: 5 }, () => ({
        label: 'terrain',
        run: () => {
          time += 3;
        },
      })),
      () => {},
    );
    expect(nextFrame).toHaveBeenCalledTimes(3); // initial paint and two 6 ms slices
    expect(loader.ready).toBe(true);
  });

  it('cancelled pending work cannot run geometry or alter a replacement load', async () => {
    const image = deferred();
    const loader = new MapPreparation(
      async () => {},
      () => 0,
    );
    const oldProgress = vi.fn(),
      oldGeometry = vi.fn(),
      newGeometry = vi.fn();
    const old = loader.start(
      [
        { label: 'old image', run: () => image.promise },
        { label: 'old terrain', run: oldGeometry },
      ],
      oldProgress,
    );
    await Promise.resolve();
    loader.cancel();
    await loader.start([{ label: 'new terrain', run: newGeometry }], () => {});
    image.resolve();
    await old;
    expect(oldGeometry).not.toHaveBeenCalled();
    expect(oldProgress).toHaveBeenCalledTimes(1);
    expect(newGeometry).toHaveBeenCalledOnce();
    expect(loader.active && loader.ready).toBe(true);
  });
});
