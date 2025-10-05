# Trilium Notes

[English](../README.md) | [Chinese](./README-ZH_CN.md) | [Russian](./README-ru.md) | [Japanese](./README-ja.md) | [Italian](./README-it.md) | [Spanish](./README-es.md)

Trilium Notes è un'applicazione per appunti ad organizzazione gerarchica, studiata per la costruzione di archivi di conoscenza personali di grandi dimensioni.

Vedi [fotografie](https://triliumnext.github.io/Docs/Wiki/screenshot-tour) per una panoramica veloce:

<a href="https://triliumnext.github.io/Docs/Wiki/screenshot-tour"><img src="./app.png" alt="Trilium Screenshot" width="1000"></a>

## ⚠️ Perchè TriliumNext?
[Il progetto originale Trilium è in modalità di manutenzione](https://github.com/zadam/trilium/issues/4620)

## 🗭 Discuti con noi
Sentiti libero di unirti alle nostre discussioni ufficiali e alla nostra comunità. Siamo concentrati sullo sviluppo di Trilium e ci piacerebbe sapere quali funzioni, suggerimenti o eventuali problemi hai!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (Per discussioni sincrone)
- [Discussioni Github](https://github.com/TriliumNext/Trilium/discussions) (Per discussioni asincrone)
- [Wiki](https://triliumnext.github.io/Docs/) (Per le domande più comuni e le guide per l'utente)

Le due stanze linkate sopra sono connesse e contengono gli stessi messaggi, quindi puoi usare XMPP o Matrix da qualsiasi client tu preferisca, praticamente su qualsiasi piattaforma!
### Comunità non ufficiali

[Trilium Rocks](https://discord.gg/aqdX9mXX4r)
## 🎁 Funzionalità

* Gli appunti possono essere organizzati in un albero di profondità arbitraria. Un singolo appunto può essere collocato in più posti nell'albero (vedi [clonazione](https://triliumnext.github.io/Docs/Wiki/cloning-notes))
* Ricco editor visuale (WYSIWYG), con supporto -tra l'altro- per tabelle, immagini ed [espressioni matematiche](https://triliumnext.github.io/Docs/Wiki/text-notes#math-support) e con [formattazione automatica](https://triliumnext.github.io/Docs/Wiki/text-notes#autoformat) per markdown
* Supporto per la modifica di [appunti con codice sorgente](https://triliumnext.github.io/Docs/Wiki/code-notes), con evidenziazione della sintassi
* [Navigazione veloce](https://triliumnext.github.io/Docs/Wiki/note-navigation) tra gli appunti, ricerca testuale completa e [fissaggio degli appunti](https://triliumnext.github.io/Docs/Wiki/note-hoisting)
* Supporto integrato ed automatico per le [revisioni degli appunti](https://triliumnext.github.io/Docs/Wiki/note-revisions)
* Gli [attributi](https://triliumnext.github.io/Docs/Wiki/attributes) degli appunti possono essere utilizzati per l'organizzazione, per l'interrogazione e per lo scripting avanzato (prorgrammazione).
* [Sincronizzazione](https://triliumnext.github.io/Docs/Wiki/synchronization) con un server di sincronizzazione auto-ospitato
  * c'è un [servizio di terze parti per ospitare server di sincronizzazione](https://trilium.cc/paid-hosting)
* [Condivisione](https://triliumnext.github.io/Docs/Wiki/sharing)  (pubblicazione) di appunti sull'internet pubblico
* Robusta [crittografia](https://triliumnext.github.io/Docs/Wiki/protected-notes) configurabile singolarmente per ogni appunto
* Disegno di diagrammi con Excalidraw (tipo di appunto "canvas")
* [Mappe relazionali](https://triliumnext.github.io/Docs/Wiki/relation-map) e [mappe di collegamenti](https://triliumnext.github.io/Docs/Wiki/link-map) per visualizzare gli appunti e le loro relazioni
* [Scripting](https://triliumnext.github.io/Docs/Wiki/scripts) - vedi [Esempi avanzati](https://triliumnext.github.io/Docs/Wiki/advanced-showcases)
* [API REST](https://triliumnext.github.io/Docs/Wiki/etapi) per l'automazione
* Si adatta bene sia in termini di usabilità che di prestazioni fino ad oltre 100 000 appunti
* Interfaccia utente ottimizzata per il [mobile](https://triliumnext.github.io/Docs/Wiki/mobile-frontend) (smartphone e tablet)
* [Tema Notturno](https://triliumnext.github.io/Docs/Wiki/themes)
* Supporto per importazione ed esportazione da e per [Evernote](https://triliumnext.github.io/Docs/Wiki/evernote-import) e [Markdown import](https://triliumnext.github.io/Docs/Wiki/markdown)
* [Web Clipper](https://triliumnext.github.io/Docs/Wiki/web-clipper) per il salvataggio facile di contenuti web

✨ Dai un'occhiata alle seguenti risorse di terze parti per scoprire altre bellezze legate a TriliumNext:

-[awesome-trilium](https://github.com/Nriver/awesome-trilium) per temi, script, plugin e altro di terze parti.
- [TriliumRocks!](https://trilium.rocks/) per tutorial, guide e molto altro.
## 🏗 Rilasci


Trilium è fornito come applicazione desktop (Linux e Windows) o come applicazione web ospitata sul tuo server (Linux). La versione desktop per Mac OS è disponibile, ma [non è supportata](https://triliumnext.github.io/Docs/Wiki/faq#mac-os-support).

* Se vuoi usare Trilium sul tuo desktop, scarica il rilascio binario per la tua piattaforma dall'[ultimo rilascio](https://github.com/TriliumNext/Trilium/releases/latest), decomprimi l'archivio e avvia l'eseguibile ```trilium```.
* Se vuoi installare Trilium su un server, segui [questa pagina](https://triliumnext.github.io/Docs/Wiki/server-installation).
  * Per ora solo Chrome e Firefox sono i browser supportati (testati).

TriliumNext sarà fornito anche come Flatpak:

<img width="240" src="https://flathub.org/assets/badges/flathub-badge-en.png">

## 📝 Documentazione

[Vedi la wiki per una lista completa delle pagine di documentazione.](https://triliumnext.github.io/Docs/)

Puoi anche leggere ["Patterns of personal knowledge base"](https://triliumnext.github.io/Docs/Wiki/patterns-of-personal-knowledge) per avere un'ispirazione su come potresti utilizzare Trilium.

## 💻 Contribuire

Clona localmente ed esegui

```shell
npm install
npm run server:start
```

## 👏 Riconoscimenti

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - miglior editor visuale (WYSIWYG) sul mercato, squadra di sviluppo attenta e reattiva
* [FancyTree](https://github.com/mar10/fancytree) -  libreria per alberi molto ricca di funzionalità, senza pari. Trilium Notes non sarebbe lo stesso senza di essa.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - editor di codice con supporto per un'enorme quantità di linguaggi.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - libreria per la  connettività visuale senza pari. Utilizzata per [mappe relazionali](https://triliumnext.github.io/Docs/Wiki/relation-map) e [mappe di collegamenti](https://triliumnext.github.io/Docs/Wiki/link-map).

## 🤝 Supporto

Puoi sostenere lo sviluppatore originale di Trilium utilizzando gli sponsor di GitHub, [PayPal](https://paypal.me/za4am) o Bitcoin (bitcoin:bc1qv3svjn40v89mnkre5vyvs2xw6y8phaltl385d2).
Il supporto all'organizzazione TriliumNext sarà possibile nel prossimo futuro.

## 🔑 Licenza

Questo programma è software libero: è possibile redistribuirlo e/o modificarlo nei termini della GNU Affero General Public License come pubblicata dalla Free Software Foundation, sia la versione 3 della Licenza, o (a propria scelta) qualsiasi versione successiva.
