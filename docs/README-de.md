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

![GitHub Sponsors](https://img.shields.io/github/sponsors/eliandoran)
![LiberaPay patrons](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Docker Pulls](https://img.shields.io/docker/pulls/triliumnext/trilium)
![GitHub Downloads (all assets, all
releases)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Translation
status](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

[Englisch](./README.md) | [Chinesisch (Vereinfacht)](./docs/README-ZH_CN.md) |
[Chinesisch (Traditionell)](./docs/README-ZH_TW.md) |
[Russisch](./docs/README-ru.md) | [Japanisch](./docs/README-ja.md) |
[Italienisch](./docs/README-it.md) | [Spanisch](./docs/README-es.md)

Trilium Notes ist eine freie, open-source, plattformfreie, hierarchische
Notiz-Anwendung mit Fokus auf die Erstellung großer persönlicher
Wissenssammlungen.

Siehe [screenshots](https://triliumnext.github.io/Docs/Wiki/screenshot-tour) für
einen schnellen Überblick:

<a href="https://triliumnext.github.io/Docs/Wiki/screenshot-tour"><img src="./docs/app.png" alt="Trilium Screenshot" width="1000"></a>

## ⏬ Download
- [Neueste Version](https://github.com/TriliumNext/Trilium/releases/latest) –
  stabile Version, für die meisten Benutzer empfohlen.
- [Nightly build](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  instabile Entwicklungsversion, die täglich mit den neuesten Funktionen und
  Fehlerbehebungen aktualisiert wird.

## 📚 Dokumentation

**Besuche unsere umfassende Dokumentation unter
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Unsere Dokumentation ist verfügbar in mehreren Formaten:
- **Online-Dokumentation**: Die vollständige Dokumentation finden man unter
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **In-App-Hilfe**: drücke `F1` in Trilium, um dieselbe Dokumentation direkt in
  der Anwendung aufzurufen
- **GitHub**: Durchsuche das
  [Benutzerhandbuch](./docs/User%20Guide/User%20Guide/) in diesem Repository

### Schnellzugriff
- [Erste Schritte](https://docs.triliumnotes.org/)
- [Installationsanleitung](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation.md)
- [Docker
  Einrichten](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md)
- [TriliumNext
  aktualisieren](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Upgrading%20TriliumNext.md)
- [Grundkonzepte und
  Funktionen](./docs/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Notes.md)
- [Muster persönlicher
  Wissensdatenbanken](https://triliumnext.github.io/Docs/Wiki/patterns-of-personal-knowledge)

## 🎁 Funktionen

* Notizen lassen sich in beliebig tiefe Baumstrukturen einordnen. Eine einzelne
  Notiz kann an mehreren Stellen im Baum existieren (siehe
  [Klonen](https://triliumnext.github.io/Docs/Wiki/cloning-notes))
* Umfangreicher WYSIWYG-Editor für Notizen, z. B. mit Tabellen, Bildern und
  [Mathematik](https://triliumnext.github.io/Docs/Wiki/text-notes) mit
  Markdown-Autoformatierung
* Unterstützung für das Bearbeiten von [Notizen mit
  Quellcode](https://triliumnext.github.io/Docs/Wiki/code-notes), inkl.
  Syntaxhervorhebung
* Schnelle und einfache [Navigation zwischen
  Notizen](https://triliumnext.github.io/Docs/Wiki/note-navigation),
  Volltextsuche sowie
  [Notizhervorhebung](https://triliumnext.github.io/Docs/Wiki/note-hoisting)
* Nahtlose [Versionierung von
  Notizen](https://triliumnext.github.io/Docs/Wiki/note-revisions)
* Notiz [Attribute](https://triliumnext.github.io/Docs/Wiki/attributes) können
  zur Organisation von Notizen, für Abfragen und erweiterte
  [Skripterstellung](https://triliumnext.github.io/Docs/Wiki/scripts) verwendet
  werden
* Benutzeroberfläche verfügbar in Englisch, Deutsch, Spanisch, Französisch,
  Rumänisch sowie Chinesisch (vereinfacht und traditionell)
* Direkte [OpenID- und
  TOTP-Integration](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/Multi-Factor%20Authentication.md)
  für eine sicherere Anmeldung
* [Synchronisierung](https://triliumnext.github.io/Docs/Wiki/synchronization)
  mit einem selbst gehosteten Synchronisierungsserver
  * Es gibt einen [Drittanbieter-Dienst für das Hosten von
    Synchronisationsservern](https://trilium.cc/paid-hosting)
* [Freigabe](https://triliumnext.github.io/Docs/Wiki/sharing) (Veröffentlichung)
  von Notizen im öffentlichen Internet
* Starke
  [Notizverschlüsselung](https://triliumnext.github.io/Docs/Wiki/protected-notes)
  mit Granularität pro Notiz
* Skizzieren von Diagrammen basierend auf [Excalidraw](https://excalidraw.com/)
  (Notiztyp „Canvas“)
* [Beziehungskarten](https://triliumnext.github.io/Docs/Wiki/relation-map) and
  [Verknüpfungskarten](https://triliumnext.github.io/Docs/Wiki/link-map) zur
  Visualisierung von Notizen und deren Beziehungen
* Mindmaps, basierend auf [Mind Elixir](https://docs.mind-elixir.com/)
* [Geokarten](./docs/User%20Guide/User%20Guide/Note%20Types/Geo%20Map.md) mit
  Standortmarkierungen und GPX-Tracks
* [Skripting](https://triliumnext.github.io/Docs/Wiki/scripts) – siehe
  [Erweiterte
  Showcases](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)
* [REST-API](https://triliumnext.github.io/Docs/Wiki/etapi) für die
  Automatisierung
* Skalierbar in Bedienbarkeit und Performance — geeignet für über 100.000
  Notizen
* Touch-optimiertes [mobiles
  Frontend](https://triliumnext.github.io/Docs/Wiki/mobile-frontend) für
  Smartphones und Tablets
* Integriertes [dunkles Design](https://triliumnext.github.io/Docs/Wiki/themes),
  Unterstützung für benutzerdefinierte Designs
* [Evernote](https://triliumnext.github.io/Docs/Wiki/evernote-import) und
  [Markdown importieren und
  exportieren](https://triliumnext.github.io/Docs/Wiki/markdown)
* [Web Clipper](https://triliumnext.github.io/Docs/Wiki/web-clipper) zum
  einfachen Speichern von Webinhalten
* Anpassbare Benutzeroberfläche (Seitenleisten-Schaltflächen, benutzerdefinierte
  Widgets, ...)
* [Metriken](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics.md),
  zusammen mit einem
  [Grafana-Dashboard](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics/grafana-dashboard.json)

✨ Weitere Informationen zu TriliumNext findet man in den folgenden
Ressourcen/Communities von Drittanbietern:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) bietet von
  Drittanbietern erstellte Themes, Skripte, Plugins und vieles mehr
- [TriliumRocks!](https://trilium.rocks/) für Tutorials, Anleitungen und vieles
  mehr.

## ❓ Warum TriliumNext?

Der ursprüngliche Entwickler von Trilium ([Zadam](https://github.com/zadam)) hat
das Trilium-Repository der Gemeinschaft übergeben, die nun unter
https://github.com/TriliumNext agiert

### Migration von Zadam/Trilium?

Es sind keine speziellen Migrationsschritte erforderlich, um von einer
zadam/Trilium-Instanz auf eine TriliumNext/Trilium-Instanz umzustellen. Man
[Installieret TriliumNext/Trilium](#-installation) einfach wie gewohnt, und die
vorhandene Datenbank wird verwendet.

Versionen bis einschließlich
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) sind
kompatibel mit der letzten zadam/trilium-Version
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). Alle späteren
Versionen von TriliumNext/Trilium haben ihre Sync-Versionen erhöht, was eine
direkte Migration verhindert

## 💬 Diskussion mit uns

Nehme gerne an den offiziellen Diskussionen teil. Feedback, Funktionsvorschläge
oder Problemberichte sind jederzeit willkommen!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (für
  Echtzeit-Diskussionen.)
  - Der `allgemeine` Matrix-Raum ist zusätzlich mit
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join) verbunden
- (Github Diskussionen)(https://github.com/TriliumNext/Trilium/discussions) (für
  asynchrone Diskussionen)
- [Github-Probleme](https://github.com/TriliumNext/Trilium/issues) (für
  Fehlerberichte und Funktionsanfragen)

## 🏗 Installation

### Windows / MacOS

Lade die Binärversion für deine Plattform von der Seite mit den [neuesten
Versionen](https://github.com/TriliumNext/Trilium/releases/latest) herunter,
entpacke das Paket und führe die ausführbare Datei `trilium` aus.

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

[![Status der
Übersetzung](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

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

- [GitHub Unterstützer](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 Lizenz

Copyright 2017-2025 zadam, Elian Doran, und andere Unterstützer

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.
