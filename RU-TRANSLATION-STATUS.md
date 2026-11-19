# Статус русского перевода Trilium (форк Nikitamce/Trilium)

Дата: 2026-11-19

## Что уже сделано

### 1. Механизм многоязычной загрузки демо-заметок

- Добавлен `apps/server/src/services/demo_archive.ts` — выбор архива `demo-<locale>.zip`
  с откатом на английский `demo.zip`.
- `packages/trilium-core/src/services/sql_init.ts` — `initDemoArchive` теперь принимает
  локаль, выбранную при установке, и передаёт её провайдеру архива.
- `apps/server/src/core_init.ts`, `apps/desktop/src/main.ts` — используют `readDemoArchive`.
- `apps/standalone/src/local-server-worker.ts` — загружает `demo-<locale>.zip` через fetch
  с откатом на английский архив.
- Добавлен готовый переведённый архив `apps/server/src/assets/db/demo-ru.zip`
  и его исходники в `apps/edit-docs/demo-ru/` (переведены заголовки, содержимое заметок
  и `navigation.html`; пути файлов оставлены английскими — импортёр Trilium берёт
  заголовки из `!!!meta.json`).

### 2. Механизм многоязычной встроенной справки (User Guide внутри приложения)

- `packages/trilium-core/src/services/in_app_help.ts` — активная локаль (`i18next.language`)
  передаётся провайдеру справки; добавлен параметр `locale` в `getHelpHiddenSubtreeData`,
  `getHelpContent` и `getHelpPageAssets`.
- `apps/server/src/in_app_help_provider.ts` — кэширование дерева и контента справки
  **по локали**; предпочитает `help_meta.<locale>.json` / `help_content.<locale>.json`,
  откат на английские файлы, когда перевода нет.
- `apps/standalone/src/lightweight/in_app_help_provider.ts` — загружает все языки,
  перечисленные в `help_locales.json`, с откатом на английский.
- `apps/edit-docs/src/docs_pipeline.ts` — новая опция конфигурации `helpLocales`:
  для каждого языка собираются `help_meta.<locale>.json` и `help_content.<locale>.json`
  из каталога перевода, плюс пишется индекс `help_locales.json`.
- `edit-docs-config.yaml` — добавлен русский язык справки:
  `docs/User Guide/ru` → `help_meta.ru.json` / `help_content.ru.json`.

### 3. Полный перевод руководства пользователя на русский

- Дерево `docs/User Guide/ru/` полностью переведено: **291 из 291** не-автогенерируемых
  markdown-файлов (все разделы: `Basic Concepts and Features`, `Installation & Setup`,
  `Note Types`, `Collections`, `AI`, `Advanced Usage`, `Scripting`, `Theme development`,
  `Troubleshooting`, `Miscellaneous`, корневые страницы).
- Переведены заголовки (`"title"`) в `docs/User Guide/ru/!!!meta.json` (285 узлов,
  синхронизировано с русскими H1-заголовками и названиями разделов).
- Сохранена вся разметка Markdown/HTML, пути к изображениям, `href` внутренних ссылок
  `<a class="reference-link">`, блоки кода, идентификаторы API и атрибуты.

### 4. Автогенерируемые страницы (намеренно НЕ переведены)

Эти 5 файлов перезаписываются при каждой сборке (`edit-docs` генерирует их из
OpenAPI/TypeDoc), перевод будет потерян:

- `Advanced Usage/Internal API/API Reference.md`
- `Advanced Usage/ETAPI (REST API)/API Reference.md`
- `Scripting/Script API/Backend API.md`
- `Scripting/Script API/Frontend API.md`
- `Scripting/Script API/Electron API.md`

Для их перевода нужен отдельный шаг в конвейере сборки (машинный перевод артефактов
после генерации).

## Осталось сделать

1. **Собрать артефакты справки**: в окружении с установленным `pnpm` (`pnpm install`)
   выполнить `edit-docs`/build-docs, чтобы сгенерировать
   `apps/server/src/assets/help/help_meta.ru.json`, `help_content.ru.json` и
   `help_locales.json` из `docs/User Guide/ru`.
2. **Прогнать тесты/сборку** (`packages/trilium-core` spec'и на `in_app_help` и
   `sql_init`, спеки standalone-провайдера) и поправить их при необходимости.
3. (Опционально) Машинный перевод автогенерируемых API-справок на этапе сборки.
