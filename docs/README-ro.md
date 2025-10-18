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

![Sponsori prin GitHub](https://img.shields.io/github/sponsors/eliandoran)
![Sponsori prin LiberaPay](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Descărcări pe Docker](https://img.shields.io/docker/pulls/triliumnext/trilium)
![Descărcări pe GitHub (toate variantele, toate
release-urile)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Starea
traducerilor](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

[Engleză](./README.md) | [Chineză (Simplificată)](./docs/README-ZH_CN.md) |
[Chineză (Tradițională)](./docs/README-ZH_TW.md) | [Rusă](./docs/README-ru.md) |
[Japoneză](./docs/README-ja.md) | [Italiană](./docs/README-it.md) |
[Spaniolă](./docs/README-es.md)

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
  matematice](https://triliumnext.github.io/Docs/Wiki/text-notes) cu
  [auto-formatare în stil
  Markdown](https://triliumnext.github.io/Docs/Wiki/text-notes#autoformat)
* Suport for editarea [notițelor de tip cod
  sursă](https://triliumnext.github.io/Docs/Wiki/code-notes), inclusiv cu
  evidențierea sintaxei
* [Navigare rapidă printre
  notițe](https://triliumnext.github.io/Docs/Wiki/note-navigation), căutare în
  conținutul notițelor și [focalizarea
  notițelor](https://triliumnext.github.io/Docs/Wiki/note-hoisting)
* Salvarea transparentă a [reviziilor
  notițelor](https://triliumnext.github.io/Docs/Wiki/note-revisions)
* [Attribute](https://triliumnext.github.io/Docs/Wiki/attributes) pentru
  organizarea și căutarea notițelor, dar și posibilitatea de [script-uri
  avansate](https://triliumnext.github.io/Docs/Wiki/scripts)
* Interfața grafică este disponibilă în mai multe limbi, dintre care și limba
  română
* [Integrare directă cu OpenID and
  TOTP](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/Multi-Factor%20Authentication.md)
  pentru o autentificare mai sigură
* [Sincronizare](https://triliumnext.github.io/Docs/Wiki/synchronization) cu un
  server propriu
  * există și un [serviciu terț pentru
    sincronizare](https://trilium.cc/paid-hosting)
* [Partajarea](https://triliumnext.github.io/Docs/Wiki/sharing) (publicarea)
  notițelor pe Internet
* [Criptare puternică](https://triliumnext.github.io/Docs/Wiki/protected-notes)
  la nivel de notițe
* Desenare liberă, folosind [Excalidraw](https://excalidraw.com/) (notițe de tip
  „schiță”)
* [Hărți de relații](https://triliumnext.github.io/Docs/Wiki/relation-map) and
  [hărți de legături](https://triliumnext.github.io/Docs/Wiki/link-map) pentru
  vizualizarea notițelor și a relațiilor acestora
* Hărți mentale, bazate pe [Mind Elixir](https://docs.mind-elixir.com/)
* [Hărți geografice](./docs/User%20Guide/User%20Guide/Note%20Types/Geo%20Map.md)
  cu marcaje și trasee GPX
* [Scriptare](https://triliumnext.github.io/Docs/Wiki/scripts) - vedeți
  [Prezentare
  avansată](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)
* [API-uri REST](https://triliumnext.github.io/Docs/Wiki/etapi) pentru
  automatizare
* Suportă peste 100 de mii de notițe fără impact de performanță
* [Interfață de mobil optimizată pentru touch
  screen](https://triliumnext.github.io/Docs/Wiki/mobile-frontend) pentru
  telefoane mobile și tablete
* [Temă întunecată](https://triliumnext.github.io/Docs/Wiki/themes) predefinită,
  dar și suport pentru teme personalizate
* Import și export pentru
  [Evernote](https://triliumnext.github.io/Docs/Wiki/evernote-import) și
  [Markdown](https://triliumnext.github.io/Docs/Wiki/markdown)
* [Web Clipper](https://triliumnext.github.io/Docs/Wiki/web-clipper) pentru
  salvarea rapidă a conținutului de pe Internet
* Interfață grafică personalizabilă (butoane, widget-uri definite de utilizator,
  ...)
* [Metrice](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics.md),
  inclusiv un [dashboard
  Grafana](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics/grafana-dashboard.json)

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
împachetare](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

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

Dacă preferați o aplicație nativă de Android, puteți folosi
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Bug-urile și cererile de funcționalități pentru această aplicație trebuie
reportate la [repository-ul
lor](https://github.com/FliegendeWurst/TriliumDroid). Notă: este recomandat să
se dezactiveze update-urile automatizate la server (vedeți mai jos) deoarece
versiunea de sincronizare uneori rămâne în urmă la aplicația de mobil.

### Server

Pentru a instala Trilium pe server (inclusiv prin Docker din
[Dockerhub](https://hub.docker.com/r/triliumnext/trilium)), urmați [documentația
de instalare a
server-ului](https://triliumnext.github.io/Docs/Wiki/server-installation).


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
* [Dosu](https://dosu.dev/) pentru răspunsurile automate la issue-urile de pe
  GitHub și discuții.
* [Tabler Icons](https://tabler.io/icons) pentru iconițele din bara de sistem.

Trilium nu ar fi fost posibil fără tehnologiile pe care este bazat:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - editorul vizual din
  spatele notițelor de tip text. Suntem recunoscători pentru setul de
  funcționalități premium.
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
  relație](https://triliumnext.github.io/Docs/Wiki/relation-map.html) și [hărți
  de legături](https://triliumnext.github.io/Docs/Wiki/note-map.html#link-map)

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
