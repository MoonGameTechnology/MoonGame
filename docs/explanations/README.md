# docs/explanations/ — библиотека решений (ADR)

> Architecture Decision Records: **почему так, а не иначе**. Не что делает код (это в
> `CODE-MAP.md` и `docs/architecture.md`), а какие альтернативы рассматривались и
> почему выбрано именно это. Узкий скоп: только неочевидные решения с альтернативами —
> не для каждой фичи.

## Формат

Каждый ADR — один файл вида NN-kebab-case-title (например, `01-determinism-vs-server-authority.md`):

```
# NN. <короткое название>

**Дата:** YYYY-MM-DD
**Статус:** accepted | superseded by NN | deprecated

## Контекст
Какая проблема. Какие ограничения. Какие альтернативы рассматривались.

## Решение
Что выбрали. Ключевые аргументы.

## Последствия
Что это даёт. Какую цену платим. С чем совместимо/несовместимо.
```

## Правила

- **Сверять с кодом** (`CLAUDE.md`: «verify docs against reality»). ADR описывает
  решение, которое **реально легло** в код — не намерение. Если код изменился, ADR
  помечается `superseded by NN` или `deprecated`, не удаляется (история решений
  ценна).
- **Один источник истины.** Принципы «surgical changes» и «тесты как страховка» уже
  в `CLAUDE.md` — здесь их не дублируем, только ссылаемся.
- **Узкий скоп.** Не для каждой фичи — только решения, где были осмысленные
  альтернативы и выбор не очевиден из кода. Проект уже перегружен доками (60+ в
  `docs/`); этот слой не должен разрастаться без необходимости.
- **Code first, docs after.** ADR пишется **после** реализации (или параллельно с
>  ней, сверяя с кодом), не до.

## Индекс

| # | ADR | Тема |
|---|---|---|
| 01 | [01-determinism-vs-server-authority.md](01-determinism-vs-server-authority.md) | Почему ядро — чистая функция, а AI — на сервере |
| 02 | [02-module-bus-not-imports.md](02-module-bus-not-imports.md) | Почему модули не импортируют друг друга |
| 03 | [03-data-driven-content.md](03-data-driven-content.md) | Почему контент в JSON, а не в коде |
| 04 | [04-fail-secure-rejection.md](04-fail-secure-rejection.md) | Почему ошибки → rejection, не silent pass |
| 05 | [05-pve-ai-placement.md](05-pve-ai-placement.md) | Почему PvE AI на сервере, а спавн волн — в ядре |
| 06 | [06-pve-wave-spawn-via-schedule.md](06-pve-wave-spawn-via-schedule.md) | Почему спавн волн через `schedule()`, а тактика NPC — нет |