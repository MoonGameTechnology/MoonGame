/** Field-level feedback for the account forms. Rules remain with each form. */
export interface FormProblem<Field extends string> {
  field: Field;
  key: string;
}

export function initFormFeedback<Field extends string>(
  fields: Record<Field, HTMLInputElement>,
  problems: () => readonly FormProblem<Field>[],
  status: (key: string | null) => void,
  related: Partial<Record<Field, readonly Field[]>> = {},
): {
  validate(): FormProblem<Field> | null;
  reject(field: Field, key: string, dependsOn?: readonly Field[]): void;
  clear(): void;
} {
  const names = Object.keys(fields) as Field[];
  const touched = new Set<Field>();
  const rejected = new Map<Field, { key: string; dependsOn: readonly Field[] }>();
  let showingProblem = false;

  function render(): FormProblem<Field> | null {
    const local = problems().filter((problem) => touched.has(problem.field));
    const errors = [
      ...Array.from(rejected, ([field, { key }]) => ({ field, key })),
      ...local,
    ];
    const invalid = new Set(errors.flatMap(({ field }) => [field, ...(related[field] ?? [])]));
    for (const name of names) fields[name].ariaInvalid = invalid.has(name) ? 'true' : null;
    const first = errors[0] ?? null;
    if (first || showingProblem) status(first?.key ?? null);
    showingProblem = first !== null;
    return first;
  }

  for (const name of names) {
    fields[name].addEventListener('input', () => {
      touched.add(name);
      for (const [field, { dependsOn }] of rejected) {
        if (field === name || dependsOn.includes(name)) rejected.delete(field);
      }
      render();
    });
    fields[name].addEventListener('blur', () => {
      // Opening an empty form or tabbing through it is not a failed submission.
      if (fields[name].value) touched.add(name);
      render();
    });
  }

  return {
    validate: () => {
      for (const name of names) touched.add(name);
      rejected.clear();
      return render();
    },
    reject: (field, key, dependsOn = []) => {
      rejected.set(field, { key, dependsOn });
      render();
    },
    clear: () => {
      touched.clear();
      rejected.clear();
      render();
    },
  };
}
