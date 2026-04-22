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

Trilium Notes est une application gratuite, open-source et multiplateforme de
prise de notes hiérarchique, conçue pour créer et gérer de vastes bases de
connaissances personnelles.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ Télécharger
- [Dernière version](https://github.com/TriliumNext/Trilium/releases/latest) –
  version stable, recommandée pour la plupart des utilisateurs.
- [Nightly build](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  version de développement instable, mise à jour quotidiennement avec les
  dernières fonctionnalités et corrections.

## 📚 Documentation

**Visitez notre documentation complète sur
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Notre documentation est disponible sous plusieurs formats :
- **Documentation en ligne**: Parcourez la documentation complète sur
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Aide intégrée**: Appuyez sur `F1` dans Trilium pour accéder à la même
  documentation directement dans l'application
- **GitHub**: Naviguer dans le [Guide utilisateur]
  (./User%20Guide/User%20Guide/) dans ce dépôt

### Liens rapides
- [Guide de démarrage](https://docs.triliumnotes.org/)
- [Instructions d'installation](https://docs.triliumnotes.org/user-guide/setup)
- [Configuration
  Docker](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [Mise à jour de TriliumNext]
  (https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [Concepts et fonctionnalités de
  base](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [Modèles de base de connaissances
  personnelles](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 Fonctionnalités

* Les notes peuvent être organisées selon une arborescence de profondeur
  arbitraire. Une même note peut être placée à plusieurs endroits de
  l'arborescence (voir
  [clonage](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* Éditeur de notes WYSIWYG enrichi comprenant par exemple des tableaux, des
  images et [des formules
  mathématiques](https://docs.triliumnotes.org/user-guide/note-types/text) avec
  [formatage automatique en
  Markdown](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
* Prise en charge de l'édition [de notes avec code
  source](https://docs.triliumnotes.org/user-guide/note-types/code), incluant la
  coloration syntaxique
* Navigation rapide et facile entre les
  notes(https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation),
  recherche en texte intégral et [focalisation de
  notes](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* Gestion transparente des [versions de
  notes](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* Les [attributs] de
  note(https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  peuvent être utilisés pour l'organisation, l'interrogation et les [scripts]
  avancés(https://docs.triliumnotes.org/user-guide/scripts)
* Interface utilisateur disponible en anglais, allemand, espagnol, français,
  roumain et chinois (simplifié et traditionnel)
* [Intégration directe d'OpenID et
  TOTP](https://docs.triliumnotes.org/user-guide/setup/server/mfa) pour une
  connexion plus sécurisée
* [Synchronisation](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  avec un serveur de synchronisation auto-hébergé
  * Il existe des [services tiers pour héberger un serveur de
    synchronisation](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [Partage](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  (publication) de notes sur Internet
* [Cryptage de
  note](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  fort avec granularité par note
* Diagrammes d'esquisse, basés sur [Excalidraw](https://excalidraw.com/) (type
  de note "canvas"))
* [Relation
  maps](https://docs.triliumnotes.org/user-guide/note-types/relation-map) et
  [note/link maps](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  pour visualiser les notes et leurs relations
* Cartes mentales, basées sur [Mind Elixir] (https://docs.mind-elixir.com/)
* [Cartes
  géographiques](https://docs.triliumnotes.org/user-guide/collections/geomap)
  avec repères de localisation et pistes GPX
* [Scripting](https://docs.triliumnotes.org/user-guide/scripts) - voir [Vitrines
  avancées](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [API REST](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi) pour
  l'automatisation
* Optimisé en termes d’ergonomie et de performances, même au-delà de 100 000
  notes
* [Interface
  mobile](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend)
  optimisée pour le tactile sur smartphones et tablettes
* [Thème sombre](https://docs.triliumnotes.org/user-guide/concepts/themes)
  intégré, prise en charge des thèmes utilisateur
* [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  et [Importation et exportation
  Markdown](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper) pour
  une sauvegarde facile du contenu web
* Interface utilisateur personnalisable (boutons de la barre latérale, widgets
  définis par l'utilisateur, ...)
* [Statistiques](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics),
  avec un tableau de bord Grafana.

✨ Consultez les ressources/communautés tierces suivantes pour plus de
fonctionnalités liées à TriliumNext :

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) pour des thèmes,
  scripts, plugins et plus encore tiers.
- [TriliumRocks!](https://trilium.rocks/) pour des tutoriels, des guides et bien
  plus encore.

## ❓Pourquoi TriliumNext ?

Le développeur original de Trilium ([Zadam](https://github.com/zadam)) a
gracieusement donné le référentiel Trilium au projet communautaire hébergé sur
https://github.com/TriliumNext

### ⬆️Migration depuis Zadam/Trilium ?

Il n'y a aucune étape de migration spécifique pour migrer d'une instance
zadam/Trilium vers une instance TriliumNext/Trilium. Installez simplement
TriliumNext/Trilium comme d'habitude et votre base de données existante sera
utilisée.

Les versions jusqu'à
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4) incluses
sont compatibles avec la dernière version de zadam/trilium
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). Les versions
ultérieures de TriliumNext/Trilium voient leurs versions synchronisées
incrémentées, ce qui empêche toute migration directe.

## 💬 Discutez avec nous

N'hésitez pas à participer à nos discussions officielles. Nous serions ravis de
connaître vos idées, suggestions ou problèmes !

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (Pour les discussions
  synchrones.)
  - L'espace Matrix `Général` est également reliée à
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [Discussions Github](https://github.com/TriliumNext/Trilium/discussions) (Pour
  les discussions asynchrones.)
- [Problèmes Github](https://github.com/TriliumNext/Trilium/issues) (Pour les
  rapports de bogues et les demandes de fonctionnalités.)

## 🏗 Installation

### Windows / MacOS

Téléchargez la version binaire pour votre plateforme à partir de la [dernière
page de version](https://github.com/TriliumNext/Trilium/releases/latest),
décompressez le package et exécutez l'exécutable `trilium`.

### Linux

Si votre distribution est répertoriée dans le tableau ci-dessous, utilisez le
package de votre distribution.

[![Statut du
Packaging](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

Vous pouvez également télécharger la version binaire pour votre plateforme à
partir de la [dernière page de
version](https://github.com/TriliumNext/Trilium/releases/latest), décompresser
le package et lancer l'exécutable `trilium`.

TriliumNext est également fourni sous forme de Flatpak, mais pas encore publié
sur FlatHub.

### Navigateur (tout système d'exploitation)

Si vous utilisez une installation serveur (voir ci-dessous), vous pouvez accéder
directement à l'interface Web (qui est presque identique à l'application de
bureau).

Actuellement, seules les dernières versions de Chrome & Firefox sont supportées
(et testées).

### Mobile

Pour utiliser TriliumNext sur un appareil mobile, vous pouvez utiliser un
navigateur Web afin d' accéder à l'interface d'une installation serveur (voir
ci-dessous).

Pour plus d’informations sur le support de l’application mobile, consultez le
ticket https://github.com/TriliumNext/Trilium/issues/4962.

Si vous préférez une application Android native, vous pouvez utiliser
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Signalez les bugs et les fonctionnalités manquantes sur [leur
dépôt](https://github.com/FliegendeWurst/TriliumDroid). Remarque : Il est
préférable de désactiver les mises à jour automatiques sur votre serveur (voir
ci-dessous) lorsque vous utilisez TriliumDroid, car les versions doivent rester
synchronisées entre Trilium et TriliumDroid.

### Serveur

Pour installer TriliumNext sur votre propre serveur (y compris via Docker depuis
[Dockerhub](https://hub.docker.com/r/triliumnext/trilium)), suivez [les
documents d'installation du
serveur](https://docs.triliumnotes.org/user-guide/setup/server).


## 💻 Contribuer

### Traductions

Si vous êtes un locuteur natif, aidez-nous à traduire Trilium en vous rendant
sur notre [page Weblate](https://hosted.weblate.org/engage/trilium/).

Voici la couverture linguistique dont nous disposons jusqu'à présent :

[ ![Statut de la
traduction](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Code

Téléchargez le référentiel, installez les dépendances à l'aide de `pnpm` puis
exécutez le serveur (disponible sur http://localhost:8080) :
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### Documentation

Téléchargez le référentiel, installez les dépendances à l'aide de `pnpm`, puis
exécutez l'environnement requis pour modifier la documentation :
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### Générer l'exécutable
Téléchargez le référentiel, installez les dépendances à l'aide de `pnpm`, puis
créez l'application de bureau pour Windows :
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

Pour plus de détails, consultez la [documentation de
développement](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### Documentation du développeur

Veuillez consulter le [guide de
documentation](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
pour plus de détails. Pour toute question, n'hésitez pas à nous contacter via
les liens décrits dans la section "Discuter avec nous" ci-dessus.

## 👏 Dédicaces

* [zadam](https://github.com/zadam) pour le concept original et la mise en œuvre
  de l'application.
* [Sarah Hussein](https://github.com/Sarah-Hussein) pour la conception de
  l'icône de l'application.
* [nriver](https://github.com/nriver) pour son travail sur
  l’internationalisation.
* [Thomas Frei](https://github.com/thfrei) pour son travail original sur le
  Canvas.
* [antoniotejada](https://github.com/nriver) pour le widget de coloration
  syntaxique original.
* [Dosu](https://dosu.dev/) pour nous avoir fourni des réponses automatisées aux
  problèmes et aux discussions sur GitHub.
* [Tabler Icons](https://tabler.io/icons) pour les icônes de la barre d'état
  système.

Trilium ne serait pas possible sans les technologies qui le sous-tendent :

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - est l’éditeur visuel
  utilisé pour les notes textuelles. Nous remercions l’équipe pour la mise à
  disposition d’un ensemble de fonctionnalités premium.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - éditeur de code
  prenant en charge un grand nombre de langages.
* [Excalidraw](https://github.com/excalidraw/excalidraw) - le tableau blanc
  infini utilisé dans les notes Canvas.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - fournit la
  fonctionnalité de carte mentale.
* [Leaflet](https://github.com/Leaflet/Leaflet) - pour le rendu des cartes
  géographiques.
* [Tabulator](https://github.com/olifolkerd/tabulator) - pour le tableau
  interactif utilisé dans les collections.
* [FancyTree](https://github.com/mar10/fancytree) - bibliothèque d'arborescence
  riche en fonctionnalités sans réelle concurrence.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - Bibliothèque de connectivité
  visuelle. Utilisée dans les [cartes de
  relations](https://docs.triliumnotes.org/user-guide/note-types/relation-map)
  et les [cartes de
  liens](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 Support

Trilium est développé et maintenu grâce à [des centaines d'heures de
travail](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Votre
soutien permet son maintien en open-source, d'améliorer ses fonctionnalités et
de couvrir des coûts tels que l'hébergement.

Envisagez de soutenir le développeur principal
([eliandoran](https://github.com/eliandoran)) de l'application via :

- [Sponsors GitHub](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Offrez-moi un café](https://buymeacoffee.com/eliandoran)

## 🔑 License

Copyright 2017-2025 zadam, Elian Doran et autres contributeurs

Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le
modifier selon les termes de la licence publique générale GNU Affero telle que
publiée par la Free Software Foundation, soit la version 3 de la licence, soit
(à votre choix) toute version ultérieure.
