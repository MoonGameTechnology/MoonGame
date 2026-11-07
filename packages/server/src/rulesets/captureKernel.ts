import type { ActionHandler, GameModule, Kernel, ModuleSetupApi } from '@void/shared-core';

/** Wrap registration, not handlers: old simulation code and module order stay intact. */
export function captureKernel(create: (modules: GameModule[]) => Kernel, modules: readonly GameModule[]): {
  kernel: Kernel; actions: string[];
} {
  const actions = new Set<string>();
  const wrapped = modules.map((original): GameModule => ({ ...original,
    setup(api) {
      const proxy = new Proxy(api, {
        get(target, property, receiver) {
          if (property === 'onAction') return (type: string, handler: ActionHandler) => {
            actions.add(type); target.onAction(type, handler);
          };
          return Reflect.get(target, property, receiver);
        },
      }) as ModuleSetupApi;
      original.setup(proxy);
    },
  }));
  return { kernel: create(wrapped), actions: [...actions].sort() };
}
