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
  a [import & export
  Markdown](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Webový výstřižek](https://docs.triliumnotes.org/user-guide/setup/web-clipper)
  pro snadné ukládání webového obsahu
* Přizpůsobitelné UI (tlačítka bočního panelu, uživatelsky definované widgety,
  ...)
* [Metriky](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics)
  spolu s Grafana Dashboard.

✨ Podívejte se na následující externí zdroje/komunity pro další vychytávky
související s TriliumNext:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) pro externí
  motivy, skripty, pluginy a další.
- [TriliumRocks!](https://trilium.rocks/) pro návody, průvodce a mnohem více.

## ❓Proč TriliumNext?

Původní vývojář Trilium ([Zadam](https://github.com/zadam)) štědře předal
repozitář Trilium komunitnímu projektu, který sídlí na
https://github.com/TriliumNext

### ⬆️Migrujete ze Zadam/Trilium?

Neexistují žádné speciální kroky pro migraci z instance zadam/Trilium na
instanci TriliumNext/Trilium. Jednoduše si [ nainstalujte
TriliumNext/Trilium](#-installation) jako obvykle a použije vaši stávající
databázi.

Verze až do
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) včetně
jsou kompatibilní s nejnovější verzí zadam/trilium
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). Jakékoli
pozdější verze TriliumNext/Trilium mají zvýšené verze synchronizace, což brání
přímé migraci.

## 💬 Diskutujte s námi

Nebojte se připojit k našim oficiálním konverzationím. Rádi uslyšíme vaše nápady
na funkce, návrhy nebo problémy!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (Pro synchronní
  diskuse.)
  - Pokoj Matrix `General` je také propojen s
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [Github Discussions](https://github.com/TriliumNext/Trilium/discussions) (Pro
  asynchronní diskuse.)
- [Github Issues](https://github.com/TriliumNext/Trilium/issues) (Pro hlášení
  chyb a požadavky na funkce.)

## 🏗 Instalace

### Windows / MacOS

Stáhněte si binární verzi pro svou platformu z [stránky s nejnovější
verzí](https://github.com/TriliumNext/Trilium/releases/latest), rozbalte balíček
a spusťte spustitelný soubor `trilium`.

### Linux

Pokud je vaše distribuce uvedena v níže uvedené tabulce, použijte balíček pro
vaši distribuci.

[![Stav
balení](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

Můžete si také stáhnout binární verzi pro svou platformu ze [stránky s
nejnovější verzí](https://github.com/TriliumNext/Trilium/releases/latest),
rozbalit balíček a spustit spustitelný soubor `trilium`.

TriliumNext je k dispozici také jako Flatpak, ale ještě není zveřejněn na
FlatHub.

### Prohlížeč (jakýkoli OS)

Pokud používáte serverovou instalaci (viz níže), můžete přistupovat přímo k
webovému rozhraní (které je téměř identické s desktopovou aplikací).

Momentálně jsou podporovány (a testovány) pouze nejnovější verze Chrome &
Firefox.

### Mobilní zařízení

Chcete-li používat TriliumNext na mobilním zařízení, můžete použít mobilní
webový prohlížeč k přístupu k mobilnímu rozhraní instalace serveru (viz níže).

Více informací o podpoře mobilní aplikace naleznete v issue
https://github.com/TriliumNext/Trilium/issues/4962.

Pokud preferujete nativní aplikaci pro Android, můžete použít
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Chyby a chybějící funkce hlaste v [jejím
repozitáři](https://github.com/FliegendeWurst/TriliumDroid). Poznámka: Při
používání TriliumDroid je nejlepší zakázat automatické aktualizace na vaší
instalaci serveru (viz níže), protože verze pro synchronizaci musí mezi Trilium
a TriliumDroid souhlasit.

### Server

Chcete-li nainstalovat TriliumNext na svůj vlastní server (včetně pomocí Docker
z [Dockerhub](https://hub.docker.com/r/triliumnext/trilium)), postupujte podle
[dokumentace k instalaci
serveru](https://docs.triliumnotes.org/user-guide/setup/server).


## 💻 Přispějte

### Překlady

Pokud jste rodilý mluvčí, pomozte nám s překladem Trilium tím, že navštívíte
naši [stránku Weblate](https://hosted.weblate.org/engage/trilium/).

Zde je aktuální pokrytí jazyky:

[![Stav
překladu](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Kód

Stáhněte si repozitář, nainstalujte závislosti pomocí `pnpm` a poté spusťte
server (dostupný na http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### Dokumentace

Stáhněte si repozitář, nainstalujte závislosti pomocí `pnpm` a poté spusťte
prostředí vyžadované pro úpravu dokumentace:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### Kompilace spustitelného souboru
Stáhněte si repozitář, nainstalujte závislosti pomocí `pnpm` a poté sestavte
desktopovou aplikaci pro Windows:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

Pro více podrobností navštivte [vývojovou
dokumentaci](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### Vývojářská dokumentace

Podrobnosti naleznete v [průvodci
dokumentací](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md).
Pokud máte další dotazy, neváhejte nás kontaktovat prostřednictím odkazů
uvedených v sekci „Diskuse s námi“ výše.

## 👏 Poděkování

* [zadam](https://github.com/zadam) za původní koncept a implementaci aplikace.
* [Sarah Hussein](https://github.com/Sarah-Hussein) za návrh ikony aplikace.
* [nriver](https://github.com/nriver) za jeho práci na internacionalizaci.
* [Thomas Frei](https://github.com/thfrei) za jeho původní práci na Plátně.
* [antoniotejada](https://github.com/nriver) za původní widget pro zvýrazňování
  syntaxe.
* [Dosu](https://dosu.dev/) za poskytnutí automatických odpovědí na GitHub
  issues a diskuse.
* [Tabler Icons](https://tabler.io/icons) za ikony v systémové oblasti.

Trilium by nebyl možný bez technologií, které za ním stojí:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - vizuální editor pro
  textové poznámky. Jsme vděční za nabídku sady prémiových funkcí.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - editor kódu s
  podporou obrovského množství jazyků.
* [Excalidraw](https://github.com/excalidraw/excalidraw) - nekonečná bílá tabule
  používaná v poznámkách typu Canvas.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - poskytuje
  funkcionalitu myšlenkových map.
* [Leaflet](https://github.com/Leaflet/Leaflet) - pro vykreslování geografických
  map.
* [Tabulator](https://github.com/olifolkerd/tabulator) - pro interaktivní
  tabulku používanou v kolekcích.
* [FancyTree](https://github.com/mar10/fancytree) - bohatá knihovna pro stromové
  struktury bez skutečné konkurence.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - knihovna pro vizuální
  propojení. Používá se v [mapách
  vazeb](https://docs.triliumnotes.org/user-guide/note-types/relation-map) a
  [mapách
  odkazů](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 Podpora

Trilium je vyvíjen a udržován s [úsilím stovek hodin
práce](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Vaše
podpora pomáhá udržovat projekt jako open-source, vylepšuje funkce a pokrývá
náklady, jako je hosting.

Zvažte podporu hlavního vývojáře ([eliandoran](https://github.com/eliandoran))
aplikace prostřednictvím:

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 Licence

Copyright 2017-2025 zadam, Elian Doran a ostatní přispěvatelé

Tento program je volný software: můžete jej redistribuovat a/nebo upravovat za
podmínek GNU Affero General Public License, jak jej vydala Free Software
Foundation, buď ve verzi 3 této licence, nebo (volitelně) jakoukoli pozdější
verzi.
