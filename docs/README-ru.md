<div align="center">
	<sup>Special thanks to:</sup><br />
	<a href="https://go.warp.dev/Trilium" target="_blank">		
		<img alt="Warp sponsorship" width="400" src="https://github.com/warpdotdev/brand-assets/blob/main/Github/Sponsor/Warp-Github-LG-03.png"><br />
		Warp, built for coding with multiple AI agents<br />
	</a>
  <sup>Available for macOS, Linux and Windows</sup>
</div>

<hr />

# Trilium Notes

![Спонсоры GitHub](https://img.shields.io/github/sponsors/eliandoran) ![Меценаты
LiberaPay ](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Загрузок Docker](https://img.shields.io/docker/pulls/triliumnext/trilium)
![Загрузок GitHub (all assets, all
releases)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Процесс
перевода](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Chinese (Simplified Han script)](./README-ZH_CN.md) | [Chinese (Traditional Han
script)](./README-ZH_TW.md) | [English](../README.md) | [French](./README-fr.md)
| [German](./README-de.md) | [Greek](./README-el.md) | [Italian](./README-it.md)
| [Japanese](./README-ja.md) | [Romanian](./README-ro.md) |
[Spanish](./README-es.md)
<!-- translate:on -->

Trilium Notes – это приложение для заметок с иерархической структурой,
ориентированное на создание больших персональных баз знаний.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ Загрузка
- [Последний релиз](https://github.com/TriliumNext/Trilium/releases/latest) –
  стабильная версия, подойдёт для большинства пользователей.
- [Ночной билд](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  нестабильная разрабатываемая версия, ежедневно получает новые функции и
  исправления.

## 📚 Документация

**Полная документация по адресу
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Документация доступна в нескольких форматах:
- **Онлайн Документация**: Полная документация доступна по адресу:
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Справка в приложении**: Нажмите`F1` в Trilium для доступа к этой
  документации прямо в приложении
- **GitHub**: Navigate through the [User Guide](./User%20Guide/User%20Guide/) in
  this repository

### Важные Ссылки
- [Руководство по началу работы](https://docs.triliumnotes.org/)
- [Инструкция по установке](https://docs.triliumnotes.org/user-guide/setup)
- [Установка
  Docker](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [Обновление
  TriliumNext](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [Основные идеи и
  возможности](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [Шаблоны Персональный Базы
  Знаний](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 Возможности

* Заметки можно расположить в виде дерева произвольной глубины. Отдельную
  заметку можно разместить в нескольких местах дерева (см.
  [клонирование](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* Продвинутый визуальный редактор (WYSIWYG) позволяет работать с таблицами,
  изображениями,
  [формулами](https://docs.triliumnotes.org/user-guide/note-types/text) и
  разметкой markdown, имеет
  [автоформатирование](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
* Редактирование [заметок с исходным
  кодом](https://docs.triliumnotes.org/user-guide/note-types/code), включая
  подсветку синтаксиса
* Быстрая и простая [навигация между
  заметками](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation),
  полнотекстовый поиск и [выделение
  заметок](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
  в отдельный блок
* Бесшовное [версионирование
  заметки](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* Специальные
  [атрибуты](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  позволяют гибко организовать структуру, используются для поиска и продвинутого
  [скриптинга](https://docs.triliumnotes.org/user-guide/scripts)
* Интерфейс доступен на Английском, Немецком, Испанском, Французском, Румынском
  и Китайском (упрощённом и традиционном)
* Интеграция [OpenID and TOTP
  integration](https://docs.triliumnotes.org/user-guide/setup/server/mfa) для
  более безопасного входа
* [Синхронизация](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  заметок со своим сервером
  * there are [3rd party services for hosting synchronisation
    server](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [Sharing](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  (publishing) notes to public internet
* Надёжное
  [шифрование](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  с детализацией по каждой заметке
* Sketching diagrams, based on [Excalidraw](https://excalidraw.com/) (note type
  "canvas")
* [Relation
  maps](https://docs.triliumnotes.org/user-guide/note-types/relation-map) and
  [note/link maps](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  for visualizing notes and their relations
* Mind maps, based on [Mind Elixir](https://docs.mind-elixir.com/)
* [Geo maps](https://docs.triliumnotes.org/user-guide/collections/geomap) with
  location pins and GPX tracks
* [Скрипты](https://docs.triliumnotes.org/user-guide/scripts) - см. [продвинутые
  примеры](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [REST API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi) for
  automation
* Хорошо масштабируется, как по удобству использования, так и по
  производительности до 100000 заметок
* Оптимизированный [мобильный
  фронтенд](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend)
  смартфонов и планшетов
* [Темная тема](https://docs.triliumnotes.org/user-guide/concepts/themes)
* Импорт и экпорт
  [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  и данных в
  [markdown](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
  формате
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper) для
  удобного сохранения веб-контента
* Customizable UI (sidebar buttons, user-defined widgets, ...)
* [Metrics](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics),
  along with a Grafana Dashboard.

✨ Check out the following third-party resources/communities for more TriliumNext
related goodies:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) for 3rd party
  themes, scripts, plugins and more.
- [TriliumRocks!](https://trilium.rocks/) for tutorials, guides, and much more.

## ❓Why TriliumNext?

The original Trilium developer ([Zadam](https://github.com/zadam)) has
graciously given the Trilium repository to the community project which resides
at https://github.com/TriliumNext

### ⬆️Migrating from Zadam/Trilium?

There are no special migration steps to migrate from a zadam/Trilium instance to
a TriliumNext/Trilium instance. Simply [install
TriliumNext/Trilium](#-installation) as usual and it will use your existing
database.

Versions up to and including
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) are
compatible with the latest zadam/trilium version of
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). Any later
versions of TriliumNext/Trilium have their sync versions incremented which
prevents direct migration.

## 💬 Discuss with us

Feel free to join our official conversations. We would love to hear what
features, suggestions, or issues you may have!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (For synchronous
  discussions.)
  - The `General` Matrix room is also bridged to
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [Github Discussions](https://github.com/TriliumNext/Trilium/discussions) (For
  asynchronous discussions.)
- [Github Issues](https://github.com/TriliumNext/Trilium/issues) (For bug
  reports and feature requests.)

## 🏗 Сборки

### Windows / macOS

Download the binary release for your platform from the [latest release
page](https://github.com/TriliumNext/Trilium/releases/latest), unzip the package
and run the `trilium` executable.

### Linux

If your distribution is listed in the table below, use your distribution's
package.

[![Packaging
status](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

You may also download the binary release for your platform from the [latest
release page](https://github.com/TriliumNext/Trilium/releases/latest), unzip the
package and run the `trilium` executable.

TriliumNext is also provided as a Flatpak, but not yet published on FlatHub.

### Browser (any OS)

If you use a server installation (see below), you can directly access the web
interface (which is almost identical to the desktop app).

Currently only the latest versions of Chrome & Firefox are supported (and
tested).

### Mobile

To use TriliumNext on a mobile device, you can use a mobile web browser to
access the mobile interface of a server installation (see below).

See issue https://github.com/TriliumNext/Trilium/issues/4962 for more
information on mobile app support.

If you prefer a native Android app, you can use
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Report bugs and missing features at [their
repository](https://github.com/FliegendeWurst/TriliumDroid). Note: It is best to
disable automatic updates on your server installation (see below) when using
TriliumDroid since the sync version must match between Trilium and TriliumDroid.

### Server

To install TriliumNext on your own server (including via Docker from
[Dockerhub](https://hub.docker.com/r/triliumnext/trilium)) follow [the server
installation docs](https://docs.triliumnotes.org/user-guide/setup/server).


## 💻 Участвуйте в разработке

### Переводы

Если вы являетесь носителем языка, помогите нам перевести Trilium, перейдя на
нашу [страницу Weblate](https://hosted.weblate.org/engage/trilium/).

Что сделано на данный момент:

[![Статус
перевода](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Код

Скачайте репозиторий, установите зависимости с помощью `pnpm`, затем запустите
сервер (доступен по адресу http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### Документация

Скачайте репозиторий, установите зависимости с помощью `pnpm`, затем запустите
окружение, необходимое для редактирование документации:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### Сборка исполняемого файла
Скачайте репозиторий, установите зависимости с помощью `pnpm`, затем соберите
приложение для Windows:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

Для получения подробностей, смотрите [документы
разработки](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### Документация для разработчиков

Please view the [documentation
guide](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
for details. If you have more questions, feel free to reach out via the links
described in the "Discuss with us" section above.

## 👏 Благодарности

* [zadam](https://github.com/zadam) за оригинальный концепт и реализацию
  приложения.
* [Sarah Hussein](https://github.com/Sarah-Hussein) за создание иконки
  приложения.
* [nriver](https://github.com/nriver) за работу по интернационализации.
* [Thomas Frei](https://github.com/thfrei) for his original work on the Canvas.
* [antoniotejada](https://github.com/nriver) за оригинальный виджет подсветки
  синтаксиса.
* [Dosu](https://dosu.dev/) за обеспечение автоматических ответов на вопросы и
  обсуждения GitHub.
* [Tabler Icons](https://tabler.io/icons) за системные иконки.

Trilium не существовал бы без технологий, лежащих в его основе:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - визуальный редактор
  текстовых заметок. Мы благодарны за предоставленный нам набор дополнительный
  функций.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - редактор кода с
  поддержкой огромного количества языков.
* [Excalidraw](https://github.com/excalidraw/excalidraw) - бесконечная белая
  доска, используемая в заметках Canvas.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - обеспечивает
  функционирование ментальной карты.
* [Leaflet](https://github.com/Leaflet/Leaflet) - отображение географических
  карт.
* [Tabulator](https://github.com/olifolkerd/tabulator) - интерактивные таблицы,
  используемые в коллекциях.
* [FancyTree](https://github.com/mar10/fancytree) - многофункциональная
  библиотека деревьев, не имеющая себе равных.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - библиотека визуальных связей.
  Используется в [картах
  связей](https://docs.triliumnotes.org/user-guide/note-types/relation-map) и
  [картах
  ссылок](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 Поддержка

На создание и поддержку Trilium затрачены [сотни часов
работы](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Ваша
поддержка помогает ему оставаться open-source, улучшает функции и покрывает
расходы, такие как хостинг.

Вы также можете поддержать главного разработчика приложения
([eliandoran](https://github.com/eliandoran)) с помощью:

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 Лицензия

Copyright 2017-2025 zadam, Elian Doran и другие авторы

Эта программа является бесплатным программным обеспечением: вы можете
распространять и/или изменять ее в соответствии с условиями GNU Affero General
Public License, опубликованной Free Software Foundation, либо версии 3 Лицензии,
либо (по вашему выбору) любой более поздней версии.
