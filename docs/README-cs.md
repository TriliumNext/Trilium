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

![Sponzoři GitHubu](https://img.shields.io/github/sponsors/eliandoran) ![Patroni
LiberaPay](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Docker Pulls](https://img.shields.io/docker/pulls/triliumnext/trilium)
![Stahování GitHubu (všechny soubory, všechna
vydání)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Stav
překladu](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Chinese (Simplified Han script)](./README-ZH_CN.md) | [Chinese (Traditional Han
script)](./README-ZH_TW.md) | [English](../README.md) | [French](./README-fr.md)
| [German](./README-de.md) | [Greek](./README-el.md) | [Italian](./README-it.md)
| [Japanese](./README-ja.md) | [Romanian](./README-ro.md) |
[Spanish](./README-es.md)
<!-- translate:on -->

Trilium Notes je open-source, cross-platform aplikace pro hierarchiální psaní
poznámek.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ Stáhnout
- [Nejnovější verze](https://github.com/TriliumNext/Trilium/releases/latest) –
  stabilní verze, doporučena pro většinu uživatelů.
- [Nightly build](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  nestabilní vývojová verze, denně aktualizovaná o nejnovější funkce a opravy.

## 📚 Dokumentace

**Navštivte naši rozsáhlou dokumentaci na
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Naše dokumenatce je dostupná ve vícero formátech:
- **Online dokumentace**: Prohlédněte si kompletní dokumentaci na
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Pomoc v aplikaci**: V Trilium stiskněte `F1`, pro přístup k stejné
  dokumentaci přímo v aplikaci
- **GitHub**: Projděte si [Uživatelskou příručku](./User%20Guide/User%20Guide/)
  v tomto repozitáři

### Rychlé odkazy
- [Návod pro začátečníky](https://docs.triliumnotes.org/)
- [Pokyny pro instalaci](https://docs.triliumnotes.org/user-guide/setup)
- [Nastavení
  Dockeru](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [Aktualizování
  TriliumNext](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [Základní pojmy a
  funkce](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [Vzory osobní znalostní
  báze](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 Funkce

* Poznámky lze uspořádat do libovolně hlubokého stromu. Jedna poznámka může být
  umístěna na více místech ve stromu (viz
  [klonování](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* Bohatý editor poznámek WYSIWYG zahrnující např. tabulky, obrázky a
  [math](https://docs.triliumnotes.org/user-guide/note-types/text) s
  automatickým formátováním
  [autoformat](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
* Podpora pro úpravy [poznámek se zdrojovým
  kódem](https://docs.triliumnotes.org/user-guide/note-types/code), včetně
  zvýraznění syntaxe
* Rychlá a snadná [navigace mezi
  poznámkami](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation),
  vyhledávání v plném textu a [zvedání
  poznámek](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* Bezproblémová [poznámka k
  verzím](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* Poznámka
  [atributy](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  lze použít pro organizaci poznámek, dotazování a pokročilé
  [skriptování](https://docs.triliumnotes.org/user-guide/scripts)
* Uživatelské rozhraní je k dispozici v angličtině, češtině, němčině,
  španělštině, francouzštině, rumunštině a čínštině (zjednodušené a tradiční)
* Přímá integrace [OpenID a
  TOTP](https://docs.triliumnotes.org/user-guide/setup/server/mfa) pro
  bezpečnější přihlášení
* [Synchronizace](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  s vlastním synchronizačním serverem
  * existují [služby třetích stran pro hostování synchronizačních
    serverů](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [Sdílení](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  (zveřejňování) poznámek na veřejném internetu
* Silné [šifrování
  poznámek](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  s granularitou na úrovni jednotlivých poznámek
* Náčrt diagramů na základě [Excalidraw](https://excalidraw.com/) (poznámka typu
  „plátno“)
* [Mapy vazeb](https://docs.triliumnotes.org/user-guide/note-types/relation-map)
  a [Poznámka/mapa
  odkazů](https://docs.triliumnotes.org/user-guide/note-types/note-map) pro
  vizualizaci poznámek a jejich vazeb
* Myšlenkové mapy založené na [Mind Elixir](https://docs.mind-elixir.com/)
* [Geo mapy](https://docs.triliumnotes.org/user-guide/collections/geomap) s
  lokalizačními značkami a trasami GPX
* [Skriptování](https://docs.triliumnotes.org/user-guide/scripts) – viz
  [Pokročilé
  ukázky](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [REST API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi) pro
  automatizaci
* Dobře škálovatelný jak z hlediska použitelnosti, tak výkonu až do 100 000
  poznámek
* Optimalizované pro dotykové ovládání [mobilní
  rozhraní](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend) pro
  smartphony a tablety
* Vestavěný [tmavý
  motiv](https://docs.triliumnotes.org/user-guide/concepts/themes), podpora
  uživatelských motivů
* [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  and [Markdown import &
  export](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper) for
  easy saving of web content
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
installation docs](https://docs.triliumnotes.org/user-guide/setup/server).


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
  maps](https://docs.triliumnotes.org/user-guide/note-types/relation-map) and
  [link
  maps](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

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
