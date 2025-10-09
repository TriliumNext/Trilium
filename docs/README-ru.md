# Trilium Notes

![GitHub Sponsors](https://img.shields.io/github/sponsors/eliandoran)
![LiberaPay patrons](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Docker Pulls](https://img.shields.io/docker/pulls/triliumnext/trilium)
![GitHub Downloads (all assets, all
releases)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Translation
status](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

[English](./README.md) | [Chinese (Simplified)](./docs/README-ZH_CN.md) |
[Chinese (Traditional)](./docs/README-ZH_TW.md) | [Russian](./docs/README-ru.md)
| [Japanese](./docs/README-ja.md) | [Italian](./docs/README-it.md) |
[Spanish](./docs/README-es.md)

Trilium Notes – это приложение для заметок с иерархической структурой,
ориентированное на создание больших персональных баз знаний.

Для быстрого ознакомления посмотрите
[скриншот-тур](https://triliumnext.github.io/Docs/Wiki/screenshot-tour)

<a href="https://triliumnext.github.io/Docs/Wiki/screenshot-tour"><img src="./docs/app.png" alt="Trilium Screenshot" width="1000"></a>

## 📚 Документация

**Visit our comprehensive documentation at
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Our documentation is available in multiple formats:
- **Online Documentation**: Browse the full documentation at
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **In-App Help**: Press `F1` within Trilium to access the same documentation
  directly in the application
- **GitHub**: Navigate through the [User
  Guide](./docs/User%20Guide/User%20Guide/) in this repository

### Quick Links
- [Getting Started Guide](https://docs.triliumnotes.org/)
- [Installation
  Instructions](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation.md)
- [Docker
  Setup](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md)
- [Upgrading
  TriliumNext](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Upgrading%20TriliumNext.md)
- [Basic Concepts and
  Features](./docs/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Notes.md)
- [Patterns of Personal Knowledge
  Base](https://triliumnext.github.io/Docs/Wiki/patterns-of-personal-knowledge)

## 🎁 Возможности

* Заметки можно расположить в виде дерева произвольной глубины. Отдельную
  заметку можно разместить в нескольких местах дерева (см.
  [клонирование](https://triliumnext.github.io/Docs/Wiki/cloning-notes))
* Продвинутый визуальный редактор (WYSIWYG) позволяет работать с таблицами,
  изображениями, [формулами](https://triliumnext.github.io/Docs/Wiki/text-notes)
  и разметкой markdown, имеет
  [автоформатирование](https://triliumnext.github.io/Docs/Wiki/text-notes#autoformat)
* Редактирование [заметок с исходным
  кодом](https://triliumnext.github.io/Docs/Wiki/code-notes), включая подсветку
  синтаксиса
* Быстрая и простая [навигация между
  заметками](https://triliumnext.github.io/Docs/Wiki/note-navigation),
  полнотекстовый поиск и [выделение
  заметок](https://triliumnext.github.io/Docs/Wiki/note-hoisting) в отдельный
  блок
* Бесшовное [версионирование
  заметки](https://triliumnext.github.io/Docs/Wiki/note-revisions)
* Специальные [атрибуты](https://triliumnext.github.io/Docs/Wiki/attributes)
  позволяют гибко организовать структуру, используются для поиска и продвинутого
  [скриптинга](https://triliumnext.github.io/Docs/Wiki/scripts)
* UI available in English, German, Spanish, French, Romanian, and Chinese
  (simplified and traditional)
* Direct [OpenID and TOTP
  integration](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/Multi-Factor%20Authentication.md)
  for more secure login
* [Синхронизация](https://triliumnext.github.io/Docs/Wiki/synchronization)
  заметок со своим сервером
  * there's a [3rd party service for hosting synchronisation
    server](https://trilium.cc/paid-hosting)
* [Sharing](https://triliumnext.github.io/Docs/Wiki/sharing) (publishing) notes
  to public internet
* Надёжное [шифрование](https://triliumnext.github.io/Docs/Wiki/protected-notes)
  с детализацией по каждой заметке
* Sketching diagrams, based on [Excalidraw](https://excalidraw.com/) (note type
  "canvas")
* [Карты связей](https://triliumnext.github.io/Docs/Wiki/relation-map) и [карты
  ссылок](https://triliumnext.github.io/Docs/Wiki/link-map) для визуализации их
  взяимосвязей
* Mind maps, based on [Mind Elixir](https://docs.mind-elixir.com/)
* [Geo maps](./docs/User%20Guide/User%20Guide/Note%20Types/Geo%20Map.md) with
  location pins and GPX tracks
* [Скрипты](https://triliumnext.github.io/Docs/Wiki/scripts) - см. [продвинутые
  примеры](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)
* [REST API](https://triliumnext.github.io/Docs/Wiki/etapi) for automation
* Хорошо масштабируется, как по удобству использования, так и по
  производительности до 100000 заметок
* Оптимизированный [мобильный
  фронтенд](https://triliumnext.github.io/Docs/Wiki/mobile-frontend) смартфонов
  и планшетов
* [Темная тема](https://triliumnext.github.io/Docs/Wiki/themes)
* Импорт и экпорт
  [Evernote](https://triliumnext.github.io/Docs/Wiki/evernote-import) и данных в
  [markdown](https://triliumnext.github.io/Docs/Wiki/markdown) формате
* [Web Clipper](https://triliumnext.github.io/Docs/Wiki/web-clipper) для
  удобного сохранения веб-контента
* Customizable UI (sidebar buttons, user-defined widgets, ...)
* [Metrics](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics.md), along
  with a [Grafana
  Dashboard](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics/grafana-dashboard.json)

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
installation docs](https://triliumnext.github.io/Docs/Wiki/server-installation).


## 💻 Участвуйте в разработке

### Translations

If you are a native speaker, help us translate Trilium by heading over to our
[Weblate page](https://hosted.weblate.org/engage/trilium/).

Here's the language coverage we have so far:

[![Translation
status](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Code

Download the repository, install dependencies using `pnpm` and then run the
server (available at http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### Documentation

Download the repository, install dependencies using `pnpm` and then run the
environment required to edit the documentation:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### Building the Executable
Download the repository, install dependencies using `pnpm` and then build the
desktop app for Windows:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

For more details, see the [development
docs](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### Developer Documentation

Please view the [documentation
guide](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
for details. If you have more questions, feel free to reach out via the links
described in the "Discuss with us" section above.

## 👏 Благодарности

* [zadam](https://github.com/zadam) for the original concept and implementation
  of the application.
* [Sarah Hussein](https://github.com/Sarah-Hussein) for designing the
  application icon.
* [nriver](https://github.com/nriver) for his work on internationalization.
* [Thomas Frei](https://github.com/thfrei) for his original work on the Canvas.
* [antoniotejada](https://github.com/nriver) for the original syntax highlight
  widget.
* [Dosu](https://dosu.dev/) for providing us with the automated responses to
  GitHub issues and discussions.
* [Tabler Icons](https://tabler.io/icons) for the system tray icons.

Trilium would not be possible without the technologies behind it:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - the visual editor behind
  text notes. We are grateful for being offered a set of the premium features.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - code editor with
  support for huge amount of languages.
* [Excalidraw](https://github.com/excalidraw/excalidraw) - the infinite
  whiteboard used in Canvas notes.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - providing the
  mind map functionality.
* [Leaflet](https://github.com/Leaflet/Leaflet) - for rendering geographical
  maps.
* [Tabulator](https://github.com/olifolkerd/tabulator) - for the interactive
  table used in collections.
* [FancyTree](https://github.com/mar10/fancytree) - feature-rich tree library
  without real competition.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - visual connectivity library.
  Used in [relation
  maps](https://triliumnext.github.io/Docs/Wiki/relation-map.html) and [link
  maps](https://triliumnext.github.io/Docs/Wiki/note-map.html#link-map)

## 🤝 Support

Trilium is built and maintained with [hundreds of hours of
work](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Your
support keeps it open-source, improves features, and covers costs such as
hosting.

Consider supporting the main developer
([eliandoran](https://github.com/eliandoran)) of the application via:

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 Лицензия

Copyright 2017-2025 zadam, Elian Doran и другие авторы

Эта программа является бесплатным программным обеспечением: вы можете
распространять и/или изменять ее в соответствии с условиями GNU Affero General
Public License, опубликованной Free Software Foundation, либо версии 3 Лицензии,
либо (по вашему выбору) любой более поздней версии.
