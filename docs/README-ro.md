# Trilium Notes

![GitHub Sponsors](https://img.shields.io/github/sponsors/eliandoran) ![Donatori
pe LiberaPay](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Descărcări pe Docker](https://img.shields.io/docker/pulls/triliumnext/trilium)
![Descărcări pe GitHub (toate variantele, toate
release-urile)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Starea
traducerilor](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

[English](./README.md) | [Chinese (Simplified)](./docs/README-ZH_CN.md) |
[Chinese (Traditional)](./docs/README-ZH_TW.md) | [Russian](./docs/README-ru.md)
| [Japanese](./docs/README-ja.md) | [Italian](./docs/README-it.md) |
[Spanish](./docs/README-es.md)

Trilium Notes este o aplicație gratuită și open-source pentru notițe structurate
ierarhic cu scopul de a crea o bază de date de cunoștințe personală, de mari
dimensiuni.

Prezentare generală prin [capturi de
ecran](https://triliumnext.github.io/Docs/Wiki/screenshot-tour):

<a href="https://triliumnext.github.io/Docs/Wiki/screenshot-tour"><img src="./docs/app.png" alt="Trilium Screenshot" width="1000"></a>

## 📚 Documentație

**Vizitați documentația noastră detaliată la
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Documentația este disponibilă în mai multe formate:
- **Documentație online**: vizualizați întreaga documentație la
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Ghid în aplicație**: Apăsați `F1` în Trilium pentru a accesa aceeași
  documentație local, direct din aplicație
- **GitHub**: Navigați [ghidul de utilizator](./docs/User%20Guide/User%20Guide/)
  direct din acest repository

### Linkuri rapide
- [Ghid rapid](https://docs.triliumnotes.org/)
- [Instrucțiuni de
  instalare](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation.md)
- [Instalare prin
  Docker](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md)
- [Procesul de
  actualizare](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Upgrading%20TriliumNext.md)
- [Concepte de bază și
  funcții](./docs/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Notes.md)
- [Concepte pentru o bază de date de cunoștințe
  personală](https://triliumnext.github.io/Docs/Wiki/patterns-of-personal-knowledge)

## 🎁 Funcții

* Notițele pot fi aranjate într-o structură ierarhică cu o adâncime nelimitată.
  O singură notiță poate fi plasată în mai multe locuri în abore (vedeți
  [procesul de clonare](https://triliumnext.github.io/Docs/Wiki/cloning-notes))
* Editor vizual de notițe cu suport de tabele, imagini și [ecuații
  matematice](https://triliumnext.github.io/Docs/Wiki/text-notes) și
  [autoformatare în stil
  Markdown](https://triliumnext.github.io/Docs/Wiki/text-notes#autoformat)
* Suport pentru editarea [notițelor de tip cod
  sursă](https://triliumnext.github.io/Docs/Wiki/code-notes), inclusiv cu
  evidențierea sintaxei
* [Navigare rapidă printre
  notițe](https://triliumnext.github.io/Docs/Wiki/note-navigation), căutare în
  conținutul notițelor și [focalizarea
  notițelor](https://triliumnext.github.io/Docs/Wiki/note-hoisting)
* Salvarea transparentă a [reviziilor
  notițelor](https://triliumnext.github.io/Docs/Wiki/note-revisions)
* [Atribute](https://triliumnext.github.io/Docs/Wiki/attributes) pentru
  organizarea și căutarea notițelor, dar și posibilitatea
  [script-uri](https://triliumnext.github.io/Docs/Wiki/scripts) avansate
* Interfața grafică este disponibilă în mai multe limbi, dintre care și limba
  română
* Direct [OpenID and TOTP
  integration](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/Multi-Factor%20Authentication.md)
  for more secure login
* [Synchronization](https://triliumnext.github.io/Docs/Wiki/synchronization)
  with self-hosted sync server
  * there's a [3rd party service for hosting synchronisation
    server](https://trilium.cc/paid-hosting)
* [Sharing](https://triliumnext.github.io/Docs/Wiki/sharing) (publishing) notes
  to public internet
* Strong [note
  encryption](https://triliumnext.github.io/Docs/Wiki/protected-notes) with
  per-note granularity
* Sketching diagrams, based on [Excalidraw](https://excalidraw.com/) (note type
  "canvas")
* [Relation maps](https://triliumnext.github.io/Docs/Wiki/relation-map) and
  [link maps](https://triliumnext.github.io/Docs/Wiki/link-map) for visualizing
  notes and their relations
* Mind maps, based on [Mind Elixir](https://docs.mind-elixir.com/)
* [Geo maps](./docs/User%20Guide/User%20Guide/Note%20Types/Geo%20Map.md) with
  location pins and GPX tracks
* [Scripting](https://triliumnext.github.io/Docs/Wiki/scripts) - see [Advanced
  showcases](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)
* [REST API](https://triliumnext.github.io/Docs/Wiki/etapi) for automation
* Scales well in both usability and performance upwards of 100 000 notes
* Touch optimized [mobile
  frontend](https://triliumnext.github.io/Docs/Wiki/mobile-frontend) for
  smartphones and tablets
* Built-in [dark theme](https://triliumnext.github.io/Docs/Wiki/themes), support
  for user themes
* [Evernote](https://triliumnext.github.io/Docs/Wiki/evernote-import) and
  [Markdown import & export](https://triliumnext.github.io/Docs/Wiki/markdown)
* [Web Clipper](https://triliumnext.github.io/Docs/Wiki/web-clipper) for easy
  saving of web content
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

## 🏗 Installation

### Windows / MacOS

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


## 💻 Contribute

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

## 👏 Shoutouts

* [zadam](https://github.com/zadam) for the original concept and implementation
  of the application.
* [Larsa](https://github.com/LarsaSara) for designing the application icon.
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

## 🔑 License

Copyright 2017-2025 zadam, Elian Doran, and other contributors

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.
