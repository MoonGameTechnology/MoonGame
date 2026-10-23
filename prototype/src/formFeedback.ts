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
  let activeField: Field | null = null;

  function render(): FormProblem<Field> | null {
    const local = problems().filter((problem) => touched.has(problem.field));
    const errors = [
      ...Array.from(rejected, ([field, { key }]) => ({ field, key })),
      ...local,
    ];
    const byField = new Map<Field, string>();
    for (const { field, key } of errors) {
      for (const name of [field, ...(related[field] ?? [])]) {
        if (!byField.has(name)) byField.set(name, key);
      }
    }
    const activeKey = activeField === null ? undefined : byField.get(activeField);
    const first = activeField !== null && activeKey ? { field: activeField, key: activeKey } : errors[0] ?? null;
    for (const name of names) {
      const key = byField.get(name);
      fields[name].ariaInvalid = key ? 'true' : null;
      // The shared status must never describe another field's error. Focusing
      // an invalid field selects its own text before exposing the association.
      if (key && key === first?.key) fields[name].setAttribute('aria-errormessage', 'cstatus');
      else fields[name].removeAttribute('aria-errormessage');
    }
    if (first || showingProblem) status(first?.key ?? null);
    showingProblem = first !== null;
    return first;
  }

  for (const name of names) {
    fields[name].addEventListener('focus', () => {
      activeField = name;
      render();
    });
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
      activeField = null;
      for (const name of names) touched.add(name);
      rejected.clear();
      return render();
    },
    reject: (field, key, dependsOn = []) => {
      activeField = field;
      rejected.set(field, { key, dependsOn });
      render();
    },
    clear: () => {
      activeField = null;
      touched.clear();
      rejected.clear();
      render();
    },
  };
}
