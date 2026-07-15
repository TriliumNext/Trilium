# Trilium Notes

![GitHub Sponsors](https://img.shields.io/github/sponsors/eliandoran)
![LiberaPay patrons](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Docker Pulls](https://img.shields.io/docker/pulls/triliumnext/trilium)
![GitHub Downloads (all assets, all
releases)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![Translation
status](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Arabic](./README-ar.md) | [Chinese (Simplified Han script)](./README-ZH_CN.md)
| [Chinese (Traditional Han script)](./README-ZH_TW.md) |
[Czech](./README-cs.md) | [English (United Kingdom)](./README-en_GB.md) |
[English](../README.md) | [French](./README-fr.md) | [German](./README-de.md) |
[Greek](./README-el.md) | [Indonesian](./README-id.md) | [Irish](./README-ga.md)
| [Italian](./README-it.md) | [Japanese](./README-ja.md) |
[Korean](./README-ko.md) | [Polish](./README-pl.md) | [Romanian](./README-ro.md)
| [Russian](./README-ru.md) | [Spanish](./README-es.md) |
[Ukrainian](./README-uk.md) | [Urdu](./README-ur.md) | [Uyghur](./README-ug.md)
<!-- translate:on -->

Trilium Notes este o aplicație gratuită și open-source pentru notițe structurate
ierarhic cu scopul de a crea o bază de date de cunoștințe personală, de mari
dimensiuni.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ Descarcă
- [Latest release](https://github.com/TriliumNext/Trilium/releases/latest) –
  versiune stabilă, recomandată pentru majoritatea utilizatorilor.
- [Versiune
  periodică](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  versiune pentru dezvoltare și testare, actualizată zilnic și cu ultimele
  funcționalități și buguri reparate.

## 📚 Documentație

**Vizitați documentația noastră detaliată la
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Documentația este disponibilă în mai multe formate:
- **Documentație online**: vizualizați întreaga documentație la
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Ghid în aplicație**: Apăsați `F1` în Trilium pentru a accesa aceeași
  documentație local, direct din aplicație
- **GitHub**: Navigați [ghidul de utilizator](./User%20Guide/User%20Guide/)
  direct din acest repository

### Linkuri rapide
- [Ghid rapid](https://docs.triliumnotes.org/)
- [Instrucțiuni de instalare](https://docs.triliumnotes.org/user-guide/setup)
- [Instalare prin
  Docker](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [Procesul de
  actualizare](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [Concepte de bază și
  funcții](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [Concepte pentru o bază de date de cunoștințe
  personală](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 Funcții

* Notițele pot fi aranjate într-o structură ierarhică cu o adâncime nelimitată.
  O singură notiță poate fi plasată în mai multe locuri în abore (vedeți
  [procesul de
  clonare](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* Editor vizual de notițe cu suport de tabele, imagini și [ecuații
  matematice](https://docs.triliumnotes.org/user-guide/note-types/text) cu
  [auto-formatare în stil
  Markdown](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
* Suport for editarea [notițelor de tip cod
  sursă](https://docs.triliumnotes.org/user-guide/note-types/code), inclusiv cu
  evidențierea sintaxei
* [Navigare rapidă printre
  notițe](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation),
  căutare în conținutul notițelor și [focalizarea
  notițelor](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* Salvarea transparentă a [reviziilor
  notițelor](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* [Attribute](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  pentru organizarea și căutarea notițelor, dar și posibilitatea de [script-uri
  avansate](https://docs.triliumnotes.org/user-guide/scripts)
* Interfața grafică este disponibilă în mai multe limbi, dintre care și limba
  română
* [Integrare directă cu OpenID and
  TOTP](https://docs.triliumnotes.org/user-guide/setup/server/mfa) pentru o
  autentificare mai sigură
* [Sincronizare](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  cu un server propriu
  * există [servicii terțe pentru găzduirea unui server de
    sincronizare](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [Partajarea](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  (publicarea) notițelor pe Internet
* [Criptare
  puternică](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  la nivel de notițe
* Desenare liberă, folosind [Excalidraw](https://excalidraw.com/) (notițe de tip
  „schiță”)
* [Hărți ale
  relaților](https://docs.triliumnotes.org/user-guide/note-types/relation-map)
  și [hărți ale
  notițelor/legăturilor](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  pentru vizualizarea notițelor și relaților acestora
* Hărți mentale, bazate pe [Mind Elixir](https://docs.mind-elixir.com/)
* [Hărți
  geografice](https://docs.triliumnotes.org/user-guide/collections/geomap) cu
  marcaje și trasee GPX
* [Scriptare](https://docs.triliumnotes.org/user-guide/scripts) - vedeți
  [Prezentare
  avansată](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [API-uri REST](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi)
  pentru automatizare
* Suportă peste 100 de mii de notițe fără impact de performanță
* [Interfață de mobil optimizată pentru touch
  screen](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend) pentru
  telefoane mobile și tablete
* [Temă întunecată](https://docs.triliumnotes.org/user-guide/concepts/themes)
  predefinită, dar și suport pentru teme personalizate
* Import și export pentru
  [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  și
  [Markdown](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper)
  pentru salvarea rapidă a conținutului de pe Internet
* Interfață grafică personalizabilă (butoane, widget-uri definite de utilizator,
  ...)
* [Metrice](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics),
  împreună cu un dashboard Grafana.

✨ Consultați următoarele resurse din partea comunității Trilium:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) pentru teme
  adiționale, script-uri, plugin-uri și altele.
- [TriliumRocks!](https://trilium.rocks/) pentru tutoriale, ghiduri și altele.

## ❓De ce TriliumNext?

Primul dezvoltator ([Zadam](https://github.com/zadam)) a oferit repository-ul
original către fork-ul TriliumNext aflat la https://github.com/TriliumNext

### ⬆️ Migrare de la versiunea originală (Zadam/Trilium)?

Nu există pași speciali de a migra de la o instanță de zadam/Trilium. Pur și
simplu [instalați TriliumNext/Trilium](#-installation) în mod obișnuit și va
utiliza baza de date existentă.

Versiunile până la
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) inclusiv
sunt compatibile cu ultima versiune zadam/trilium, anume
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). Toate
versiunile mai noi au versiune de sincronizare mai mare, ce previn migrarea
directă.

## 💬 Discută cu noi

Participați la canalele noastre oficiale. Ne-ar plăcea să știm ce funcții,
sugestii sau probleme aveți!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (pentru discuții în timp
  real.)
  - Camera de chat `General` se partajează și prin
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [Discuții pe GitHub](https://github.com/TriliumNext/Trilium/discussions)
  (pentru discuții de tip forum)
- [GitHub Issues](https://github.com/TriliumNext/Trilium/issues) (pentru
  rapoarte de bug-uri și cereri de funcționalități.)

## 🏗 Procesul de instalare

### Windows / macOS

Descărcați release-ul binar pentru platforma dvs. de pe pagina [ultimului
release](https://github.com/TriliumNext/Trilium/releases/latest), dezarhivați și
rulați executabilul `trilium`.

### Linux

Dacă distribuția dvs. de Linux este listată în tabelul de mai jos, puteți folosi
pachetul specific acelei distribuții.

[![Stare
împachetare](https://repology.org/badge/vertical-allrepos/trilium.svg)](https://repology.org/project/trilium/versions)

De asemenea puteți descărca release-ul binar de pe [pagina ultimului
release](https://github.com/TriliumNext/Trilium/releases/latest), dezarhivați
pachetul și rulați executabilul `trilium`.

Trilium vine și sub formă de Flatpak, dar nu este încă publicată pe FlatHub.

### Navigator web (orice sistem de operare)

Dacă folosiți varianta de server (vedeți mai jos), puteți accesa direct
interfața web (care este aproape identică aplicației desktop).

Doar ultimele versiuni de Chrome și Firefox sunt suportate și testate.

### Mobil

Pentru a putea folosi Trilium pe mobil, puteți folosi un navigator web pentru a
putea accesa interfața de mobil a unei instalări server (vedeți mai jos).

Consultați https://github.com/TriliumNext/Trilium/issues/4962 pentru mai multe
informații despre suportul aplicației de mobil.

#### TriliumDroid

Dacă preferați o aplicație nativă de Android, puteți folosi
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Bug-urile și cererile de funcționalități pentru această aplicație trebuie
reportate la [repository-ul
lor](https://github.com/FliegendeWurst/TriliumDroid). Notă: este recomandat să
se dezactiveze update-urile automatizate la server (vedeți mai jos) deoarece
versiunea de sincronizare uneori rămâne în urmă la aplicația de mobil.

#### Pocket Trilium

If you want a full-featured native Android app, check out [Pocket
Trilium](https://github.com/Nriver/pocket-trilium). It runs a complete Trilium
instance on your phone, supports full offline use, and allows you to sync with
your server.

#### Trinote

If you want a native iOS app, you can use
[Trinote](https://apps.apple.com/us/app/trinote/id6761228249), an open-source
client for your self-hosted Trilium / TriliumNext server. It lets you browse and
organize your note tree, search for notes on the server, read and edit all note
types (text, code, mindmap, spreadsheet, geomap, canvas, etc.), and keeps notes
available and editable offline. Here's the
[repo](https://github.com/StephenArg/Trinote) if you're interested in
contributing and here's the [discord](https://discord.com/invite/ghjJG56EUS)
server if you have any feedback or suggestions you want to discuss.

### Server

Pentru a instala Trilium pe server (inclusiv prin Docker din
[Dockerhub](https://hub.docker.com/r/triliumnext/trilium)), urmați [documentația
de instalare a
server-ului](https://docs.triliumnotes.org/user-guide/setup/server).


## 💻 Moduri de a contribui

### Traduceri

Dacă sunteți un vorbitor experimentat al unei alte limbi, ne puteți ajuta să
traduceți Trilium prin intermediul
[Weblate](https://hosted.weblate.org/engage/trilium/).

Aceasta este acoperirea traducerilor per limbă:

[![Starea
traducerilor](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Cod

Descărcați repository-ul, instalați dependențele folosind `pnpm` și apoi rulați
server-ul (disponibil la http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### Documentație

Descărcați repository-ul, instalați dependințele folosind `pnpm` și apoi rulați
mediul de editare a documentației:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

Alternatively, if you have Nix installed:
```shell
# Run directly
nix run .#edit-docs

# Or install to your profile
nix profile install .#edit-docs
trilium-edit-docs
```


### Compilarea executabilului
Descărcați repository-ul, instalați dependințele utilizând `pnpm` și compilați
aplicația de desktop pentru Windows:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

Pentru mai multe detalii, vedeți [documentația pentru
dezvoltare](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### Documentația pentru dezvoltatori

Urmărți
[documentația](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
pentru mai multe detalii. Dacă aveți întrebări, puteți să ne contactați folosind
legăturile descrise în secțiunea „Discutați cu noi” de mai sus.

## 💖 Sponsors

<table>
  <tr>
    <td align="center" width="25%">
      <a href="https://www.netperfect.fr">
        <img src="https://www.netperfect.fr/sites/default/files/Logo%20NetPerfect%20V4%20250px_0.png" width="64" alt="NetPerfect logo" /><br />
        <b>NetPerfect</b>
      </a>
      <br />EV certificate &amp; Windows CI
    </td>
    <td align="center" width="50%">
      <a href="https://ckeditor.com/ckeditor-5/features/">
        <img src="./logo-ck.svg" width="180" alt="CKEditor logo" /><br />
        <b>CKEditor</b>
      </a>
      <br />Premium editor features
    </td>
    <td align="center" width="25%">
      <a href="https://dosu.dev/">
        <img src="https://dosu.dev/hero-new/dosu-icon.svg" width="64" height="64" alt="Dosu logo" /><br />
        <b>Dosu</b>
      </a>
      <br />Automated GitHub support
    </td>
  </tr>
</table>

## 👏 Mențiuni

* [zadam](https://github.com/zadam) pentru conceptul și implementarea originală
  a aplicației.
* [Sarah Hussein](https://github.com/Sarah-Hussein) pentru proiectarea
  pictogramei aplicației.
* [nriver](https://github.com/nriver) pentru sistemul de internaționalizare.
* [Thomas Frei](https://github.com/thfrei) pentru munca sa originală pentru
  notițele de tip schiță.
* [antoniotejada](https://github.com/nriver) pentru implementarea originală a
  widget-ului de evidențiere al sintaxei.
* [Tabler Icons](https://tabler.io/icons) pentru iconițele din bara de sistem.

Trilium nu ar fi fost posibil fără tehnologiile pe care este bazat:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - the visual editor behind
  text notes.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - editorul de cod cu
  suport pentru foarte multe limbaje de programare.
* [Excalidraw](https://github.com/excalidraw/excalidraw) - tehnologia de
  desenare folosită în notițele de tip schiță.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - pentru
  funcționalitatea de tip hartă mentală.
* [Leaflet](https://github.com/Leaflet/Leaflet) - pentru randarea hărților
  geografice.
* [Tabulator](https://github.com/olifolkerd/tabulator) - pentru tabele
  interactive folosite în colecții.
* [FancyTree](https://github.com/mar10/fancytree) - bibliotecă pentru
  vizualizare de tip arbore.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - bibliotecă de conectivitate
  vizuală. Folosită în [hărți de tip
  relație](https://docs.triliumnotes.org/user-guide/note-types/relation-map) și
  [hărți de
  legături](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 Sprijiniți proiectul

Trilium este construit și menținut prin efortul [a sute de ore de
muncă](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Sprijinul
dvs. permite să-l menținem open-source, să îmbunătățim funcționalitățile și să
acoperim costuri suplimentare precum găzduirea.

Considerați sprijinirea dezvoltatorului principal al aplicației
([eliandoran](https://github.com/eliandoran)) prin intermediul:

- [Sponsori GitHub](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 Licență

Copyright 2017-2025 zadam, Elian Doran și alți contribuitori

Acest program este liber: se poate redistribui și se poate modifica sub termenii
licenței GNU Affero General Public License publicată de către Free Software
Foundation, fie versiunea 3 a licenței sau (în funcție de preferință) orice
versiune ulterioară.
