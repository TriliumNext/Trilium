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

Trilium Notes to darmowa i otwartoźródłowa, wieloplatformowa aplikacja do
tworzenia notatek hierarchicznych, skupiona na budowaniu dużych osobistych baz
wiedzy.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ Pobieranie
- [Ostatnie wydanie](https://github.com/TriliumNext/Trilium/releases/latest) –
  stabilna wersja, polecane dla większości użytkowników.
- [Nightly build](https://github.com/TriliumNext/Trilium/releases/tag/nightly) -
  niestabilna wersja deweloperska, aktualizowana codziennie o najnowsze funkcje
  i poprawki.

## 📚Dokumentacja

**Odwiedź naszą obszerną dokumentację na
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Nasza dokumentacja jest dostępna w wielu formatach:
- **Dokumentacja online**: Przeglądaj pełną dokumentację pod linkiem
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Pomoc w aplikacji**: Naciśnij `F1` w Trilium, aby uzyskać dostęp do tej
  samej dokumentacji bezpośrednio w aplikacji
- **GitHub**: Poruszaj się po [Przewodniku
  Użytkownika](./User%20Guide/User%20Guide/) w tym repozytorium

### Szybkie linki
- [Poradnik dla początkujących](https://docs.triliumnotes.org/)
- [Instrukcja instalacji](https://docs.triliumnotes.org/user-guide/setup)
- [Instalacja
  Dockera](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [Aktualizacja
  TriliumNext](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [Podstawowe koncepcje i
  funkcjonalność](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [Wzorce osobistej Bazy
  Wiedzy](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 Funkcjonalność

* Notatki mogą być zorganizowane w drzewa dowolnej głębokości. Pojedyncza
  notatka może być umieszczona w wielu miejscach w drzewie (patrz
  [klonowanie](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* Bogato wyposażony edytor notatek WYSIWYG, zawierający np. tabele, obrazy i
  [matematykę](https://docs.triliumnotes.org/user-guide/note-types/text) z
  [autoformat](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
  Markdown
* Wsparcie dla edycji [notatki z kodem
  źródłowym](https://docs.triliumnotes.org/user-guide/note-types/code),
  zawierające podkreślanie kodu
* Szybkie i łatwe [poruszanie się po
  notatkach](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation),
  wyszukiwanie po pełnym tekście i[wyróżnienie
  notatki](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* Bezproblemowe [aktualizowanie wersji
  notatki](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* [Atrybuty](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  notatki mogą być użyte dla jej organizacji, wyszukiwania i użycia
  zaawansowanych [skryptów](https://docs.triliumnotes.org/user-guide/scripts)
* Interfejs użytkownika dostępny w językach: angielskim, niemieckim,
  hiszpańskim, francuskim, rumuńskim oraz chińskim (uproszczonym i tradycyjnym)
* Bezpośrednia [integracja OpenID i
  TOTP](https://docs.triliumnotes.org/user-guide/setup/server/mfa) zapewniająca
  bezpieczniejsze logowanie
* [Synchronizacja](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  z samodzielnie hostowanym serwerem synchronizacji
  * Można skorzystać z [usług firm trzecich oferujących hosting serwera
    synchronizacji](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [Udostępnianie](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  i publikowanie notatek w Internecie
* Silne [szyfrowanie
  notatek](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  z możliwością szyfrowania każdej notatki osobno
* Szkicowanie diagramów oparte na [Excalidraw](https://excalidraw.com/) (typ
  notatki „canvas”)
* [Mapy
  relacji](https://docs.triliumnotes.org/user-guide/note-types/relation-map)
  oraz [mapy notatek i
  linków](https://docs.triliumnotes.org/user-guide/note-types/note-map) do
  wizualizacji notatek i ich relacji
* Mapy myśli z wykorzystaniem [Mind Elixir](https://docs.mind-elixir.com/)
* [Mapy
  geograficzne](https://docs.triliumnotes.org/user-guide/collections/geomap) z
  oznaczeniami lokalizacji i trasami GPX
* [Skrypty](https://docs.triliumnotes.org/user-guide/scripts) – patrz
  [zaawansowane
  przykłady](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [REST API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi) do
  automatyzacji
* Dobrze skaluje się pod względem użyteczności i wydajności nawet przy ponad 100
  000 notatek
* Zoptymalizowany pod kątem dotyku [mobilny
  frontend](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend) dla
  smartfonów i tabletów
* Wbudowany [ciemny
  motyw](https://docs.triliumnotes.org/user-guide/concepts/themes) i wsparcie
  dla motywów użytkownika
* [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  oraz [import i eksport
  Markdown](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper) do
  wygodnego zapisywania treści internetowych
* Konfigurowalny interfejs użytkownika (przyciski paska bocznego, widżety
  definiowane przez użytkownika, …)
* [Metryki](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics),
  wraz z panelem Grafana.

✨ Sprawdź poniższe zasoby i społeczności firm trzecich, aby znaleźć więcej
materiałów związanych z TriliumNext:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) — motywy,
  skrypty, wtyczki i inne zasoby od firm trzecich.
- [TriliumRocks!](https://trilium.rocks/) — poradniki, przewodniki i wiele
  więcej.

## ❓Dlaczego TriliumNext?

Pierwotny twórca Trilium ([Zadam](https://github.com/zadam)) uprzejmie przekazał
repozytorium Trilium społecznościowemu projektowi, który jest rozwijany pod
adresem https://github.com/TriliumNext

### ⬆️Przechodzisz z Zadam/Trilium?

Nie ma potrzeby wykonywania żadnych specjalnych kroków migracji podczas
przechodzenia z instancji zadam/Trilium na TriliumNext/Trilium. Po prostu
[zainstaluj TriliumNext/Trilium](#-installation) jak zwykle, a aplikacja
skorzysta z Twojej istniejącej bazy danych.

Wersje do i łącznie z
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) są zgodne
z najnowszą wersją zadam/trilium
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). Każda
późniejsza wersja TriliumNext/Trilium ma inną wersję synchronizacji, co
uniemożliwia migrację bezpośrednią.

## 💬 Porozmawiaj z nami

Zapraszamy do udziału w naszych oficjalnych dyskusjach. Z przyjemnością poznamy
Twoje pomysły, sugestie i problemy!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (do dyskusji w czasie
  rzeczywistym)
  - Pokój Matrix `General` jest również połączony mostem z
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [GitHub Discussions](https://github.com/TriliumNext/Trilium/discussions) (do
  dyskusji niewymagających komunikacji w czasie rzeczywistym)
- [GitHub Issues](https://github.com/TriliumNext/Trilium/issues) (do
  raportowania błędów i zgłaszania propozycji)

## 🏗 Instalacja

### Windows / MacOS

Pobierz binarną wersję aplikacji dla swojej platformy z [najnowszej strony
wydań](https://github.com/TriliumNext/Trilium/releases/latest), rozpakuj
archiwum i uruchom plik wykonywalny `trilium`.

### Linux

Jeśli Twoja dystrybucja znajduje się w poniższej tabeli, skorzystaj z pakietu
przeznaczonego dla tej dystrybucji.

[![Status
pakietów](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

Możesz również pobrać binarną wersję aplikacji dla swojej platformy z
[najnowszej strony
wydań](https://github.com/TriliumNext/Trilium/releases/latest), rozpakować
archiwum i uruchomić plik wykonywalny `trilium`.

Dostępna jest również wersja Flatpak TriliumNext, lecz nie została jeszcze
opublikowana na FlatHub.

### Przeglądarka (dowolny system operacyjny)

W przypadku instalacji serwerowej (patrz niżej) możesz bezpośrednio korzystać z
interfejsu webowego, niemal identycznego z aplikacją desktopową.

Aktualnie wspierane i testowane są tylko najnowsze wersje Chrome i Firefox.

### Urządzenia mobilne

Aby korzystać z TriliumNext na urządzeniu mobilnym, możesz użyć mobilnej
przeglądarki internetowej, aby uzyskać dostęp do mobilnego interfejsu instalacji
serwerowej (zobacz poniżej).

Więcej informacji na temat wsparcia dla aplikacji mobilnej znajdziesz w
zgłoszeniu https://github.com/TriliumNext/Trilium/issues/4962.

Jeśli preferujesz natywną aplikację na Androida, możesz skorzystać z
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Błędy oraz brakujące funkcje zgłaszaj w [ich
repozytorium](https://github.com/FliegendeWurst/TriliumDroid). Uwaga: podczas
korzystania z TriliumDroid najlepiej wyłączyć automatyczne aktualizacje
instalacji serwerowej (zobacz poniżej), ponieważ wersja synchronizacji musi być
zgodna między Trilium i TriliumDroid.

### Serwer

Aby zainstalować TriliumNext na własnym serwerze (w tym za pomocą Dockera z
[Dockerhub](https://hub.docker.com/r/triliumnext/trilium)), postępuj zgodnie z
[dokumentacją instalacji
serwerowej](https://docs.triliumnotes.org/user-guide/setup/server).


## 💻 Dołącz do rozwoju projektu

### Tłumaczenia

Jeśli jesteś rodzimym użytkownikiem danego języka, pomóż nam w tłumaczeniu
Trilium, przechodząc na naszą stronę
[Weblate](https://hosted.weblate.org/engage/trilium/).

Oto aktualny stan tłumaczeń na poszczególne języki:

[![Status
tłumaczeń](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Kod

Pobierz repozytorium, zainstaluj zależności za pomocą `pnpm`, a następnie
uruchom serwer (dostępny pod adresem http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### Dokumentacja

Pobierz repozytorium, zainstaluj zależności za pomocą `pnpm`, a następnie
uruchom środowisko wymagane do edycji dokumentacji:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### Tworzenie pliku wykonywalnego
Pobierz repozytorium, zainstaluj zależności przy użyciu `pnpm`, a następnie
skompiluj aplikację desktopową dla Windows:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

Więcej szczegółów znajdziesz w [dokumentacji
deweloperskiej](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### Dokumentacja Deweloperska

Szczegóły znajdziesz w [przewodniku po
dokumentacji](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md).
W razie dodatkowych pytań możesz skorzystać z linków podanych w sekcji
„Porozmawiaj z nami” powyżej.

## 👏 Podziękowania

* [zadam](https://github.com/zadam) za stworzenie pierwotnej koncepcji i
  implementację aplikacji.
* [Sarah Hussein](https://github.com/Sarah-Hussein) za zaprojektowanie ikony
  aplikacji.
* [nriver](https://github.com/nriver) za prace nad wersjami językowymi.
* [Thomas Frei](https://github.com/thfrei) za pierwotne prace nad Canvas.
* [antoniotejada](https://github.com/nriver) za pierwotny widżet podświetlania
  składni.
* [Dosu](https://dosu.dev/) za stworzenie rozwiązania umożliwiającego
  automatyczne odpowiedzi w GitHub Issues i GitHub Discussions.
* [Tabler Icons](https://tabler.io/icons) za ikony zasobnika systemowego.

Trilium nie byłoby możliwe bez technologii, które za nim stoją:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) — wizualny edytor stojący
  za notatkami tekstowymi. Jesteśmy wdzięczni za udostępnienie nam zestawu
  funkcji premium.
* [CodeMirror](https://github.com/codemirror/CodeMirror) — edytor kodu z obsługą
  ogromnej liczby języków.
* [Excalidraw](https://github.com/excalidraw/excalidraw) — nieskończona tablica
  wykorzystywana w notatkach typu Canvas.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) — biblioteka do
  tworzenia map myśli.
* [Leaflet](https://github.com/Leaflet/Leaflet) — do renderowania map
  geograficznych.
* [Tabulator](https://github.com/olifolkerd/tabulator) — do interaktywnych tabel
  wykorzystywanych w kolekcjach.
* [FancyTree](https://github.com/mar10/fancytree) — bogata w funkcje biblioteka
  drzew, praktycznie bez konkurencji.
* [jsPlumb](https://github.com/jsplumb/jsplumb) — biblioteka do wizualnego
  łączenia elementów. Wykorzystywana w [mapach
  relacji](https://docs.triliumnotes.org/user-guide/note-types/relation-map)
  oraz [mapach
  linków](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 Wsparcie

Trilium powstaje i jest utrzymywane dzięki [setkom godzin
pracy](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Twoje
wsparcie pozwala nam rozwijać projekt open source i pokrywać koszty, takie jak
hosting.

Jeśli chcesz wesprzeć głównego twórcę aplikacji
([eliandoran](https://github.com/eliandoran)), możesz to zrobić poprzez:

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 Licencja

Prawa autorskie 2017–2025 zadam, Elian Doran oraz pozostali współtwórcy

Ten program jest ( open-source ) - możesz go redystrybuować i/lub modyfikować
zgodnie z postanowieniami licencji GNU Affero General Public License,
opublikowanej przez Free Software Foundation, w wersji 3 lub (według uznania)
dowolnej nowszej wersji.
