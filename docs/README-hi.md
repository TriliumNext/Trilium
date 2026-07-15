# ट्रिलियम नोट्स

![GitHub प्रायोजक](https://img.shields.io/github/sponsors/eliandoran)
![LiberaPay संरक्षक](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Docker पुल्स](https://img.shields.io/docker/pulls/triliumnext/trilium)
![GitHub डाउनलोड (सभी संपत्तियां, सभी
रिलीज़)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![अनुवाद की
स्थिति](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

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

ट्रिलियम नोट्स (Trilium Notes) एक मुफ़्त और ओपन-सोर्स, क्रॉस-प्लेटफ़ॉर्म
श्रेणीबद्ध (hierarchical) नोट लेने वाला एप्लिकेशन है, जिसका मुख्य ध्यान बड़े
व्यक्तिगत ज्ञान आधार (knowledge bases) बनाने पर है।

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ डाउनलोड कीजिए
- [लेटेस्ट रिलीज़](https://github.com/TriliumNext/Trilium/releases/latest) –
  स्थिर (stable) वर्ज़न, अधिकांश यूज़र्स के लिए अनुशंसित।
- [नाइटली बिल्ड](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  अनस्टेबल डेवलपमेंट वर्ज़न, जो नए फीचर्स और फिक्सेस के साथ रोज़ अपडेट होता है।

## 📚 डॉक्यूमेंटेशन

**हमारे विस्तृत डॉक्यूमेंटेशन को
[docs.triliumnotes.org](https://docs.triliumnotes.org/) पर देखें**

हमारा डॉक्यूमेंटेशन कई फॉर्मेट्स में उपलब्ध है:
- **ऑनलाइन डॉक्यूमेंटेशन**:
  [docs.triliumnotes.org](https://docs.triliumnotes.org/) पर पूरा डॉक्यूमेंटेशन
  देखें
- **इन-ऐप हेल्प**: उसी डॉक्यूमेंटेशन को सीधे ऐप में एक्सेस करने के लिए ट्रिलियम
  के अंदर `F1` दबाएँ
- **GitHub**: इस रिपॉजिटरी में [यूज़र गाइड](./User%20Guide/User%20Guide/) देखें

### Quick Links
- [Getting Started Guide](https://docs.triliumnotes.org/)
- [Installation Instructions](https://docs.triliumnotes.org/user-guide/setup)
- [डॉकर
  सेटअप](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [TriliumNext को अपग्रेड
  करना](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [बुनियादी कॉन्सेप्ट्स और
  फीचर्स](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [व्यक्तिगत नॉलेज बेस के
  पैटर्न्स](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 खासियतें

* नोट्स को मनचाहे गहरे ट्री (tree) स्ट्रक्चर में व्यवस्थित किया जा सकता है। एक
  ही नोट को ट्री में कई जगहों पर रखा जा सकता है (देखें
  [cloning](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* बेहतरीन WYSIWYG नोट एडिटर, जिसमें टेबल, इमेज और
  [math](https://docs.triliumnotes.org/user-guide/note-types/text) के साथ-साथ
  मार्कडाउन
  [autoformat](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
  की सुविधा शामिल है
* [सोर्स कोड वाले
  नोट्स](https://docs.triliumnotes.org/user-guide/note-types/code) को एडिट करने
  की सुविधा, जिसमें सिंटैक्स हाइलाइटिंग (syntax highlighting) भी शामिल है
* तेज़ और आसान [नोट्स के बीच
  नेविगेशन](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation),
  फुल टेक्स्ट सर्च और [नोट
  होइस्टिंग](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* निर्बाध [नोट
  वर्ज़निंग](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* नोट
  [एट्रीब्यूट्स](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  का उपयोग नोट्स ऑर्गेनाइज़ करने, क्वेरी करने और एडवांस्ड
  [स्क्रिप्टिंग](https://docs.triliumnotes.org/user-guide/scripts) के लिए किया
  जा सकता है
* UI available in English, German, Spanish, French, Romanian, and Chinese
  (simplified and traditional)
* Direct [OpenID and TOTP
  integration](https://docs.triliumnotes.org/user-guide/setup/server/mfa) for
  more secure login
* [Synchronization](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  with self-hosted sync server
  * there are [3rd party services for hosting synchronisation
    server](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* पब्लिक इंटरनेट पर नोट्स की
  [शेयरिंग](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  (पब्लिशिंग)
* प्रति-नोट granularity के साथ मजबूत [नोट
  एन्क्रिप्शन](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
* डायग्राम्स स्केच करना, [एक्सकैलिड्रॉ](https://excalidraw.com/) पर आधारित (नोट
  टाइप "कैनवास")
* [Relation
  maps](https://docs.triliumnotes.org/user-guide/note-types/relation-map) and
  [note/link maps](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  for visualizing notes and their relations
* [Mind Elixir](https://docs.mind-elixir.com/) पर आधारित माइंड मैप्स
* [Geo maps](https://docs.triliumnotes.org/user-guide/collections/geomap) with
  location pins and GPX tracks
* [Scripting](https://docs.triliumnotes.org/user-guide/scripts) - see [Advanced
  showcases](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* ऑटोमेशन के लिए [REST
  API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi)
* Scales well in both usability and performance upwards of 100 000 notes
* Touch optimized [mobile
  frontend](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend) for
  smartphones and tablets
* Built-in [dark
  theme](https://docs.triliumnotes.org/user-guide/concepts/themes), support for
  user themes
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

## 💬 हमारे साथ चर्चा करें

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
status](https://repology.org/badge/vertical-allrepos/trilium.svg)](https://repology.org/project/trilium/versions)

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

#### TriliumDroid

If you prefer a native Android app, you can use
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Report bugs and missing features at [their
repository](https://github.com/FliegendeWurst/TriliumDroid). Note: It is best to
disable automatic updates on your server installation (see below) when using
TriliumDroid since the sync version must match between Trilium and TriliumDroid.

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

Alternatively, if you have Nix installed:
```shell
# Run directly
nix run .#edit-docs

# Or install to your profile
nix profile install .#edit-docs
trilium-edit-docs
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

## 👏 Shoutouts

* [zadam](https://github.com/zadam) for the original concept and implementation
  of the application.
* [Sarah Hussein](https://github.com/Sarah-Hussein) for designing the
  application icon.
* [nriver](https://github.com/nriver) for his work on internationalization.
* [Thomas Frei](https://github.com/thfrei) for his original work on the Canvas.
* [antoniotejada](https://github.com/nriver) for the original syntax highlight
  widget.
* [Tabler Icons](https://tabler.io/icons) for the system tray icons.

Trilium would not be possible without the technologies behind it:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - the visual editor behind
  text notes.
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
