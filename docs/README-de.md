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

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Chinese (Simplified Han script)](./README-ZH_CN.md) | [Chinese (Traditional Han
script)](./README-ZH_TW.md) | [English](../README.md) | [French](./README-fr.md)
| [German](./README-de.md) | [Greek](./README-el.md) | [Italian](./README-it.md)
| [Japanese](./README-ja.md) | [Romanian](./README-ro.md) |
[Spanish](./README-es.md)
<!-- translate:on -->

Trilium Notes ist eine freie, open-source, plattformfreie, hierarchische
Notiz-Anwendung mit Fokus auf die Erstellung großer persönlicher
Wissenssammlungen.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

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
- **GitHub**: Durchsuche das [Benutzerhandbuch](./User%20Guide/User%20Guide/) in
  diesem Repository

### Schnellzugriff
- [Erste Schritte](https://docs.triliumnotes.org/)
- [Installationsanleitung](https://docs.triliumnotes.org/user-guide/setup)
- [Docker
  Einrichten](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [TriliumNext
  aktualisieren](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [Grundkonzepte und
  Funktionen](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [Muster persönlicher
  Wissensdatenbanken](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 Funktionen

* Notizen lassen sich in beliebig tiefe Baumstrukturen einordnen. Eine einzelne
  Notiz kann an mehreren Stellen im Baum existieren (siehe
  [Klonen](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* Umfangreicher WYSIWYG-Editor für Notizen, z. B. mit Tabellen, Bildern und
  [Mathematik](https://docs.triliumnotes.org/user-guide/note-types/text) mit
  Markdown-Autoformatierung
* Unterstützung für das Bearbeiten von [Notizen mit
  Quellcode](https://docs.triliumnotes.org/user-guide/note-types/code), inkl.
  Syntaxhervorhebung
* Schnelle und einfache [Navigation zwischen
  Notizen](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation),
  Volltextsuche sowie
  [Notizhervorhebung](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* Nahtlose [Versionierung von
  Notizen](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* Notiz
  [Attribute](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  können zur Organisation von Notizen, für Abfragen und erweiterte
  [Skripterstellung](https://docs.triliumnotes.org/user-guide/scripts) verwendet
  werden
* Benutzeroberfläche verfügbar in Englisch, Deutsch, Spanisch, Französisch,
  Rumänisch sowie Chinesisch (vereinfacht und traditionell)
* Direkte [OpenID- und
  TOTP-Integration](https://docs.triliumnotes.org/user-guide/setup/server/mfa)
  für eine sicherere Anmeldung
* [Synchronisierung](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  mit einem selbst gehosteten Synchronisierungsserver
  * there are [3rd party services for hosting synchronisation
    server](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [Freigabe](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  (Veröffentlichung) von Notizen im öffentlichen Internet
* Starke
  [Notizverschlüsselung](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  mit Granularität pro Notiz
* Skizzieren von Diagrammen basierend auf [Excalidraw](https://excalidraw.com/)
  (Notiztyp „Canvas“)
* [Relation
  maps](https://docs.triliumnotes.org/user-guide/note-types/relation-map) and
  [note/link maps](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  for visualizing notes and their relations
* Mindmaps, basierend auf [Mind Elixir](https://docs.mind-elixir.com/)
* [Geokarten](https://docs.triliumnotes.org/user-guide/collections/geomap) mit
  Standortmarkierungen und GPX-Tracks
* [Skripting](https://docs.triliumnotes.org/user-guide/scripts) – siehe
  [Erweiterte
  Showcases](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [REST-API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi) für
  die Automatisierung
* Skalierbar in Bedienbarkeit und Performance — geeignet für über 100.000
  Notizen
* Touch-optimiertes [mobiles
  Frontend](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend) für
  Smartphones und Tablets
* Integriertes [dunkles
  Design](https://docs.triliumnotes.org/user-guide/concepts/themes),
  Unterstützung für benutzerdefinierte Designs
* [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  und [Markdown importieren und
  exportieren](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper) zum
  einfachen Speichern von Webinhalten
* Anpassbare Benutzeroberfläche (Seitenleisten-Schaltflächen, benutzerdefinierte
  Widgets, ...)
* [Metrics](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics),
  along with a Grafana Dashboard.

✨ Weitere Informationen zu TriliumNext findet man in den folgenden
Ressourcen/Communities von Drittanbietern:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) bietet von
  Drittanbietern erstellte Themes, Skripte, Plugins und vieles mehr.
- [TriliumRocks!](https://trilium.rocks/) für Tutorials, Anleitungen und vieles
  mehr.

## ❓ Warum TriliumNext?

Der ursprüngliche Entwickler von Trilium ([Zadam](https://github.com/zadam)) hat
das Trilium-Repository der Gemeinschaft übergeben, die nun unter
https://github.com/TriliumNext agiert

### Migration von Zadam/Trilium?

Es sind keine speziellen Migrationsschritte erforderlich, um von einer
zadam/Trilium-Instanz auf eine TriliumNext/Trilium-Instanz umzustellen.
[Installiere TriliumNext/Trilium](#-installation) einfach wie gewohnt, und die
vorhandene Datenbank wird verwendet.

Versionen bis einschließlich
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) sind
kompatibel mit der letzten zadam/trilium-Version
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). Alle späteren
Versionen von TriliumNext/Trilium haben ihre Sync-Versionen erhöht, was eine
direkte Migration verhindert.

## 💬 Diskussion mit uns

Nehme gerne an den offiziellen Diskussionen teil. Feedback, Funktionsvorschläge
oder Problemberichte sind jederzeit willkommen!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (für
  Echtzeit-Diskussionen.)
  - Der `allgemeine` Matrix-Raum ist zusätzlich mit
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join) verbunden
- [Github Diskussionen](https://github.com/TriliumNext/Trilium/discussions) (für
  asynchrone Diskussionen)
- [Github Issues](https://github.com/TriliumNext/Trilium/issues) (für
  Fehlerberichte und Funktionsanfragen)

## 🏗 Installation

### Windows / MacOS

Lade die Binärversion für deine Plattform von der Seite mit der [neuesten
Version](https://github.com/TriliumNext/Trilium/releases/latest) herunter,
entpacke das Paket und führe die ausführbare Datei `trilium` aus.

### Linux

Wenn deine Distribution in der folgenden Tabelle aufgeführt ist, verwende das
Paket deiner Distribution.

[![Paketierungsstatus](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

Du kannst auch die Binärversion für deine Plattform von der Seite mit der
[neuesten Version](https://github.com/TriliumNext/Trilium/releases/latest)
herunterladen, das Paket entpacken und die ausführbare Datei `trilium`
ausführen.

TriliumNext ist auch als Flatpak verfügbar, jedoch noch nicht auf Flathub
veröffentlicht.

### Browser (beliebiges Betriebssystem)

Bei Verwendung einer Server-Installation (siehe unten) kann direkt auf die
Weboberfläche zugegriffen werden. (die nahezu identisch mit der
Desktop-Anwendung ist).

Derzeit werden ausschließlich die neuesten Versionen von Chrome und Firefox
unterstützt (und getestet).

### Mobilgeräte

Um TriliumNext auf einem mobilen Gerät zu verwenden, kann ein mobiler Webbrowser
genutzt werden, um die mobile Oberfläche einer Server-Installation (siehe unten)
aufzurufen.

Weitere Informationen zur Unterstützung mobiler Apps findest du unter
https://github.com/TriliumNext/Trilium/issues/4962.

Wenn du eine native Android-App bevorzugst, kannst du
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid)
verwenden. Melde Fehler und fehlende Funktionen unter [ihrem
Repository](https://github.com/FliegendeWurst/TriliumDroid). Hinweis: Bei
Verwendung von TriliumDroid solltest du die automatischen Updates auf deinem
Server deaktivieren (siehe unten), da die Synchronisierungsversion zwischen
Trilium und TriliumDroid übereinstimmen muss.

### Server

Um TriliumNext auf deinen eigenen Server zu installieren (einschließlich über
Docker von [Dockerhub](https://hub.docker.com/r/triliumnext/trilium)), befolge
[die
Server-Installationsanweisungen](https://docs.triliumnotes.org/user-guide/setup/server).


## 💻 Mitwirken

### Übersetzungen

Wenn du Trilium in einer weiteren Sprache unterstützen möchtest, kannst du über
unsere [Weblate-Seite](https://hosted.weblate.org/engage/trilium/) an den
Übersetzungen mitwirken.

Hier ist die bisherige Sprachabdeckung:

[![Status der
Übersetzung](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Code

Lade das Repository herunter, die Abhängigkeiten mit `pnpm` installieren und
anschließend den Server starten (verfügbar unter http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### Dokumentation

Das Repository herunterladen, die Abhängigkeiten mit `pnpm` installieren und
anschließend die Umgebung starten, die zum Bearbeiten der Dokumentation benötigt
wird:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### Erstellung der ausführbaren Datei
Das Repository herunterladen, die Abhängigkeiten mit `pnpm` installieren und
anschließend die Desktop-Anwendung für Windows erstellen:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

Weitere Informationen finden sich in der
[Entwicklerdokumentation](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### Entwicklerdokumentation

Die
[Dokumentationsanleitung](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
enthält weitere Details. Bei offenen Fragen kann über die im Abschnitt
„Diskussion mit uns“ genannten Kommunikationskanäle Kontakt aufgenommen werden.

## 👏 Dankeschön

* [zadam](https://github.com/zadam) für das ursprüngliche Konzept und die
  Implementierung der Anwendung.
* [Sarah Hussein](https://github.com/Sarah-Hussein) für die Gestaltung des
  Anwendungssymbols.
* [nriver](https://github.com/nriver) für seine Arbeit zur
  Internationalisierung.
* [Thomas Frei](https://github.com/thfrei) für seine ursprüngliche Arbeit an
  Canvas.
* [antoniotejada](https://github.com/nriver) für das ursprüngliche
  Syntax-Highlighting-Widget.
* [Dosu](https://dosu.dev/) für die Bereitstellung automatisierter Antworten auf
  GitHub-Issues und Diskussionen.
* [Tabler-Icons](https://tabler.io/icons) für die Symbole in der Taskleiste.

Trilium wäre ohne die zugrundeliegenden Technologien nicht möglich:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) – der visuelle Editor
  hinter Textnotizen. Wir sind dankbar dafür, dass uns eine Reihe von
  Premium-Funktionen zur Verfügung gestellt werden.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - Code-Editor mit
  Unterstützung für eine Vielzahl von Sprachen.
* [Excalidraw](https://github.com/excalidraw/excalidraw) – das unendliche
  Whiteboard, verwendet in Canvas-Notizen.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) – bietet die
  Mindmap-Funktionalität.
* [Leaflet](https://github.com/Leaflet/Leaflet) – für die Darstellung
  geografischen Karten.
* [Tabulator](https://github.com/olifolkerd/tabulator) - für die interaktive
  Tabelle in Kollektionen.
* [FancyTree](https://github.com/mar10/fancytree) – funktionsreiche
  Baum-Bibliothek ohne echte Konkurrenz.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - visuelle
  Verbindungsbibliothek. Verwendet in
  [Beziehungskarten](https://docs.triliumnotes.org/user-guide/note-types/relation-map)
  und
  [Verbindungskarten](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 Unterstützung

Trilium wurde mit [Hunderten von
Arbeitsstunden](https://github.com/TriliumNext/Trilium/graphs/commit-activity)
entwickelt und wird auch so weitergeführt. Deine Unterstützung sorgt dafür, dass
es Open Source bleibt, verbessert die Funktionen und deckt Kosten wie das
Hosting.

Bitte unterstütze den Hauptentwickler
([eliandoran](https://github.com/eliandoran)) der Anwendung über:

- [GitHub Unterstützer](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Kauf mir einen Kaffee](https://buymeacoffee.com/eliandoran)

## 🔑 Lizenz

Copyright 2017-2025 zadam, Elian Doran, und andere Unterstützer

Dieses Programm ist freie Software: Sie können es unter den Bedingungen der GNU
Affero General Public License, wie von der Free Software Foundation
veröffentlicht, weitergeben und/oder modifizieren, entweder gemäß Version 3 der
Lizenz oder (nach Ihrer Wahl) jeder späteren Version.
