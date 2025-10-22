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

![Sponsor GitHub](https://img.shields.io/github/sponsors/eliandoran)
![Sostenitori LiberaPay](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Pull Docker](https://img.shields.io/docker/pulls/triliumnext/trilium)
![Download GitHub (tutte le risorse, tutte le
versioni)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Stato della
traduzione](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

[Inglese](./README.md) | [Cinese (semplificato)](./docs/README-ZH_CN.md) |
[Cinese (tradizionale)](./docs/README-ZH_TW.md) | [Russo](./docs/README-ru.md) |
[Giapponese](./docs/README-ja.md) | [Italiano](./docs/README-it.md) |
[Spagnolo](./docs/README-es.md)

Trilium Notes è un'applicazione per appunti ad organizzazione gerarchica,
studiata per la costruzione di archivi di conoscenza personali di grandi
dimensioni.

Vedi [fotografie](https://triliumnext.github.io/Docs/Wiki/screenshot-tour) per
una panoramica veloce:

<a href="https://triliumnext.github.io/Docs/Wiki/screenshot-tour"><img src="./docs/app.png" alt="Trilium Screenshot" width="1000"></a>

## ⏬ Scarica
- [Latest release](https://github.com/TriliumNext/Trilium/releases/latest) –
  versione stabile, consigliata per la maggior parte degli utenti.
- [Nightly build](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  versione di sviluppo instabile, aggiornata quotidianamente con le ultime
  funzionalità e correzioni.

## 📚 Documentazione

**Vedi tutta la documentazione su
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

La nostra documentazione è disponibile in diversi formati:
- **Documentazione online**: consulta la documentazione completa all'indirizzo
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Guida in-app**: premi `F1` all'interno di Trilium per accedere alla stessa
  documentazione direttamente nell'applicazione
- **GitHub**: consulta la [Guida utente](./docs/User%20Guide/User%20Guide/) in
  questo repository

### Collegamenti rapidi
- [Guida introduttiva](https://docs.triliumnotes.org/)
- [Istruzioni per
  l'installazione](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation.md)
- [Configurazione
  Docker](./docs/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md)
- [Aggiornamento di
  TriliumNext](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Upgrading%20TriliumNext.md)
- [Concetti e caratteristiche di
  base](./docs/User%20Guide/User%20Guide/Basic%20Concepts%20and%20Features/Notes.md)
- [Modelli di base di conoscenza
  personale](https://triliumnext.github.io/Docs/Wiki/patterns-of-personal-knowledge)

## 🎁 Caratteristiche

* Le note possono essere organizzate in una struttura ad albero con profondità
  arbitrarie. Una singola nota può essere inserita in più posizioni all'interno
  della struttura (vedi
  [clonazione](https://triliumnext.github.io/Docs/Wiki/cloning-notes))
* Editor di note WYSIWYG avanzato che include, ad esempio, tabelle, immagini e
  [math](https://triliumnext.github.io/Docs/Wiki/text-notes) con markdown
  [autoformat](https://triliumnext.github.io/Docs/Wiki/text-notes#autoformat)
* Supporto per la modifica di [note con codice
  sorgente](https://triliumnext.github.io/Docs/Wiki/code-notes), inclusa
  l'evidenziazione della sintassi
* Navigazione veloce e facile tra le note, ricerca full-text e ancoraggio delle
  note
* Senza soluzione di continuità [nota
  versione](https://triliumnext.github.io/Docs/Wiki/note-revisions)
* Nota [attributi](https://triliumnext.github.io/Docs/Wiki/attributes) può
  essere utilizzato per l'organizzazione delle note, l'esecuzione di query e lo
  [scripting](https://triliumnext.github.io/Docs/Wiki/scripts) avanzato
* Interfaccia utente disponibile in inglese, tedesco, spagnolo, francese, rumeno
  e cinese (semplificato e tradizionale)
* Integrazione diretta [OpenID e
  TOTP](./docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/Multi-Factor%20Authentication.md)
  per un accesso più sicuro
* [Sincronizzazione](https://triliumnext.github.io/Docs/Wiki/synchronization)
  con server di sincronizzazione self-hosted
  * esiste un [servizio di terze parti per l'hosting del server di
    sincronizzazione](https://trilium.cc/paid-hosting)
* [Condivisione](https://triliumnext.github.io/Docs/Wiki/sharing)
  (pubblicazione) di note su Internet pubblicamente
* Crittografia forte
  [note](https://triliumnext.github.io/Docs/Wiki/protected-notes) con
  granularità per singola nota
* Disegnare diagrammi, basati su [Excalidraw](https://excalidraw.com/) (tipo di
  nota “canvas”)
* [Mappe relazionali](https://triliumnext.github.io/Docs/Wiki/relation-map) e
  [mappe di collegamento](https://triliumnext.github.io/Docs/Wiki/link-map) per
  visualizzare le note e le loro relazioni
* Mappe mentali, basate su [Mind Elixir](https://docs.mind-elixir.com/)
* [Mappe
  geografiche](./docs/User%20Guide/User%20Guide/Note%20Types/Geo%20Map.md) con
  indicatori di posizione e tracciati GPX
* [Scripting](https://triliumnext.github.io/Docs/Wiki/scripts) - vedi [Esempi
  avanzati](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)
* [REST API](https://triliumnext.github.io/Docs/Wiki/etapi) per l'automazione
* Ottima scalabilità sia in termini di usabilità che di prestazioni fino a oltre
  100.000 note
* Frontend mobile ottimizzato per il touch [mobile
  frontend](https://triliumnext.github.io/Docs/Wiki/mobile-frontend) per
  smartphone e tablet
* Tema scuro integrato (https://triliumnext.github.io/Docs/Wiki/themes),
  supporto per temi utente
* [Evernote](https://triliumnext.github.io/Docs/Wiki/evernote-import) e
  [Importazione ed esportazione
  Markdown](https://triliumnext.github.io/Docs/Wiki/markdown)
* [Web Clipper](https://triliumnext.github.io/Docs/Wiki/web-clipper) per salvare
  facilmente i contenuti web
* Interfaccia utente personalizzabile (pulsanti della barra laterale, widget
  definiti dall'utente, ...)
* [Metriche](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics.md),
  insieme a una [dashboard
  Grafana](./docs/User%20Guide/User%20Guide/Advanced%20Usage/Metrics/grafana-dashboard.json)

✨ Dai un'occhiata alle seguenti risorse/comunità di terze parti per ulteriori
informazioni su TriliumNext:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) per temi, script,
  plugin e altro di terze parti.
- [TriliumRocks!](https://trilium.rocks/) per tutorial, guide e molto altro
  ancora.

## ❓Perché TriliumNext?

Lo sviluppatore originale di Trilium ([Zadam](https://github.com/zadam)) ha
gentilmente fornito il repository Trilium al progetto comunitario che risiede
all'indirizzo https://github.com/TriliumNext

### ⬆️Migrazione da Zadam/Trilium?

Non sono necessarie procedure di migrazione particolari per passare da
un'istanza zadam/Trilium a un'istanza TriliumNext/Trilium. È sufficiente
[installare TriliumNext/Trilium](#-installation) come di consueto e verrà
utilizzato il database esistente.

Le versioni fino alla
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) inclusa
sono compatibili con l'ultima versione zadam/trilium
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). Tutte le
versioni successive di TriliumNext/Trilium hanno versioni di sincronizzazione
incrementate che impediscono la migrazione diretta.

## 💬 Discuti con noi

Non esitare a partecipare alle nostre conversazioni ufficiali. Ci piacerebbe
conoscere le tue opinioni su funzionalità, suggerimenti o problemi!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (Per discussioni
  sincronizzate.)
  - La stanza Matrix `Generale` è anche collegata a
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [Discussioni su GitHub](https://github.com/TriliumNext/Trilium/discussions)
  (Per discussioni asincrone.)
- [Problemi su GitHub](https://github.com/TriliumNext/Trilium/issues) (Per
  segnalazioni di bug e richieste di funzionalità.)

## 🏗 Installazione

### Windows / MacOS

Scarica la versione binaria per la tua piattaforma dalla [pagina delle ultime
versioni](https://github.com/TriliumNext/Trilium/releases/latest), decomprimi il
pacchetto ed esegui il file eseguibile `trilium`.

### Linux

Se la tua distribuzione è elencata nella tabella sottostante, utilizza il
pacchetto della tua distribuzione.

[![Stato del
Packaging](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

È anche possibile scaricare la versione binaria per la propria piattaforma dalla
[pagina delle ultime
versioni](https://github.com/TriliumNext/Trilium/releases/latest), decomprimere
il pacchetto ed eseguire il file eseguibile `trilium`.

TriliumNext è disponibile anche come Flatpak, ma non è ancora stato pubblicato
su FlatHub.

### Browser (qualsiasi sistema operativo)

Se utilizzi un'installazione server (vedi sotto), puoi accedere direttamente
all'interfaccia web (che è quasi identica all'applicazione desktop).

Attualmente sono supportate (e testate) solo le ultime versioni di Chrome e
Firefox.

### Cellulare

Per utilizzare TriliumNext su un dispositivo mobile, è possibile utilizzare un
browser web mobile per accedere all'interfaccia mobile di un'installazione
server (vedere sotto).

Per ulteriori informazioni sul supporto delle app mobili, consultare il numero
https://github.com/TriliumNext/Trilium/issues/4962.

Se preferisci un'app Android nativa, puoi utilizzare
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Segnala bug e funzionalità mancanti al [loro
repository](https://github.com/FliegendeWurst/TriliumDroid). Nota: quando
utilizzi TriliumDroid, è consigliabile disabilitare gli aggiornamenti automatici
sull'installazione del server (vedi sotto), poiché la versione di
sincronizzazione deve corrispondere tra Trilium e TriliumDroid.

### Server

Per installare TriliumNext sul proprio server (anche tramite Docker da
[Dockerhub](https://hub.docker.com/r/triliumnext/trilium)), seguire [le
istruzioni per l'installazione sul
server](https://triliumnext.github.io/Docs/Wiki/server-installation).


## 💻 Contribuire

### Traduzioni

Se sei un madrelingua, aiutaci a tradurre Trilium visitando la nostra [pagina
Weblate](https://hosted.weblate.org/engage/trilium/).

Ecco le lingue attualmente disponibili:

[![Stato della
traduzione](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Codice

Scarica il repository, installa le dipendenze utilizzando `pnpm` e quindi avvia
il server (disponibile all'indirizzo http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### Documentazione

Scarica il repository, installa le dipendenze utilizzando `pnpm` e quindi esegui
l'ambiente necessario per modificare la documentazione:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### Compilare l'eseguibile
Scarica la repository, installa le dipendenze eseguendo `pnpm` e compila
l'applicazione desktop per Windows:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

Per più dettagli, consulta la [documentazione di
sviluppo](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### Documentazione per sviluppatori

Visualizza la [guida sulla
documentazione](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
per i dettagli. Se hai altre domande, sentiti libero di contattarci tramite i
collegamenti presenti nella precedente sezione "Discuti con noi".

## 👏 Riconoscimenti

* [zadam](https://github.com/zadam) per l'idea originale e l'implementazione
  della applicazione.
* [Sarah Hussein](https://github.com/Sarah-Hussein) per il design della icona
  della applicazione.
* [nriver](https://github.com/nriver) per il suo lavoro
  sull'internazionalizzazione.
* [Thomas Frei](https://github.com/thfrei) per il suo lavoro originale sul
  canvas.
* [antoniotejada](https://github.com/nriver) per lo strumento originale di
  colorazione della sintassi.
* [Dosu](https://dosu.dev/) per averci fornito le risposte automatiche alle
  questioni e alle discussioni su GitHub.
* [Tabler Icons](https://tabler.io/icons) per le icone della barra delle
  applicazioni.

Trilium non sarebbe possibile senza le tecnologie che lo supportano:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - l'editor visivo dietro
  le note di testo. Siamo grati per averci offerto una serie di funzionalità
  premium.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - editor di codice con
  supporto per un'ampia gamma di linguaggi.
* [Excalidraw](https://github.com/excalidraw/excalidraw) - la lavagna infinita
  utilizzata nelle note di Canvas.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - fornendo la
  funzionalità di mappa mentale.
* [Leaflet](https://github.com/Leaflet/Leaflet) - per la rappresentazione di
  mappe geografiche.
* [Tabulator](https://github.com/olifolkerd/tabulator) - per la tabella
  interattiva utilizzata nelle raccolte.
* [FancyTree](https://github.com/mar10/fancytree) - libreria ad albero ricca di
  funzionalità senza reale concorrenza.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - libreria di connettività
  visiva. Utilizzata in [relation
  maps](https://triliumnext.github.io/Docs/Wiki/relation-map.html) e [link
  maps](https://triliumnext.github.io/Docs/Wiki/note-map.html#link-map)

## 🤝 Supporto

Trilium è realizzato e gestito con [hundreds of hours of
work](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Il tuo
sostegno contribuisce a mantenerlo open source, a migliorarne le funzionalità e
a coprire i costi, come quelli di hosting.

Considera la possibilità di sostenere lo sviluppatore principale
([eliandoran](https://github.com/eliandoran)) dell'applicazione tramite:

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 Licenza

Copyright 2017-2025 zadam, Elian Doran, e altri collaboratori

Questo programma è software libero: è possibile redistribuirlo e/o modificarlo
nei termini della GNU Affero General Public License come pubblicata dalla Free
Software Foundation, sia la versione 3 della Licenza, o (a propria scelta)
qualsiasi versione successiva.
