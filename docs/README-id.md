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
[![Translation
status](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Arabic](./README-ar.md) | [Chinese (Simplified Han script)](./README-ZH_CN.md)
| [Chinese (Traditional Han script)](./README-ZH_TW.md) |
[Czech](./README-cs.md) | [English (United Kingdom)](./README-en_GB.md) |
[English](../README.md) | [French](./README-fr.md) | [German](./README-de.md) |
[Greek](./README-el.md) | [Irish](./README-ga.md) | [Italian](./README-it.md) |
[Japanese](./README-ja.md) | [Korean](./README-ko.md) | [Polish](./README-pl.md)
| [Romanian](./README-ro.md) | [Russian](./README-ru.md) |
[Spanish](./README-es.md) | [Ukrainian](./README-uk.md) |
[Uyghur](./README-ug.md)
<!-- translate:on -->

Trilium Notes adalah aplikasi pencatatan hierarkis lintas platform yang gratis
dan open-source dengan fokus pada pembangunan basis pengetahuan pribadi berskala
besar.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ Unduh
- [Latest release](https://github.com/TriliumNext/Trilium/releases/latest) –
  versi stabil, direkomendasikan untuk sebagian besar pengguna.
- [Nightly build](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  versi pengembangan yang tidak stabil, diperbarui setiap hari dengan fitur dan
  perbaikan terbaru.

## 📚 Dokumentasi

**Kunjungi dokumentasi lengkap kami di
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Dokumentasi kami tersedia dalam beberapa format:
- **Dokumentasi Online**: Jelajahi dokumentasi lengkap di
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Bantuan Dalam Aplikasi**: Tekan `F1` di dalam Trilium untuk mengakses
  dokumentasi yang sama langsung di aplikasi
- **GitHub**: Telusuri [Panduan Pengguna](./User%20Guide/User%20Guide/) di
  repositori ini

### Tautan Cepat
- [Panduan Memulai](https://docs.triliumnotes.org/)
- [Instruksi Instalasi](https://docs.triliumnotes.org/user-guide/setup)
- [Pengaturan
  Docker](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [Upgrade
  TriliumNext](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [Konsep dan Fitur
  Dasar](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [Pola Basis Pengetahuan
  Pribadi](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 Fitur

* Catatan dapat disusun dalam struktur pohon dengan kedalaman tak terbatas. Satu
  catatan dapat ditempatkan di beberapa lokasi dalam pohon (lihat
  [cloning](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* Editor catatan WYSIWYG yang kaya, termasuk tabel, gambar, dan
  [math](https://docs.triliumnotes.org/user-guide/note-types/text) dengan
  [autoformat](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
  markdown
* Dukungan untuk mengedit [catatan dengan source
  code](https://docs.triliumnotes.org/user-guide/note-types/code), termasuk
  syntax highlighting
* [Navigasi antar
  catatan](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation)
  yang cepat dan mudah, pencarian teks penuh, dan [note
  hoisting](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* [Versioning
  catatan](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
  yang mulus
* [Atribut
  catatan](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  dapat digunakan untuk organisasi catatan, query, dan
  [scripting](https://docs.triliumnotes.org/user-guide/scripts) lanjutan
* UI tersedia dalam bahasa Inggris, Jerman, Spanyol, Prancis, Rumania, dan
  Mandarin (sederhana dan tradisional)
* Integrasi langsung [OpenID dan
  TOTP](https://docs.triliumnotes.org/user-guide/setup/server/mfa) untuk login
  yang lebih aman
* [Synchronization](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  dengan server sinkronisasi self-hosted
  * tersedia [layanan pihak ketiga untuk hosting server
    sinkronisasi](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [Sharing](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  (publikasi) catatan ke internet publik
* [Enkripsi
  catatan](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  yang kuat dengan granularitas per catatan
* Menggambar diagram berbasis [Excalidraw](https://excalidraw.com/) (tipe
  catatan "canvas")
* [Relation
  maps](https://docs.triliumnotes.org/user-guide/note-types/relation-map) dan
  [note/link maps](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  untuk memvisualisasikan catatan dan relasinya
* Mind map berbasis [Mind Elixir](https://docs.mind-elixir.com/)
* [Geo maps](https://docs.triliumnotes.org/user-guide/collections/geomap) dengan
  pin lokasi dan jalur GPX
* [Scripting](https://docs.triliumnotes.org/user-guide/scripts) - lihat
  [Advanced
  showcases](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [REST API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi)
  untuk otomatisasi
* Mampu menangani hingga lebih dari 100.000 catatan dengan baik dari sisi
  kegunaan dan performa
* [Frontend
  mobile](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend) yang
  dioptimalkan untuk sentuhan pada smartphone dan tablet
* [Tema gelap](https://docs.triliumnotes.org/user-guide/concepts/themes) bawaan,
  dukungan untuk tema pengguna
* Impor & ekspor
  [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  dan
  [Markdown](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper)
  untuk menyimpan konten web dengan mudah
* UI yang dapat dikustomisasi (tombol sidebar, widget buatan pengguna, dll.)
* [Metrics](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics),
  beserta Dashboard Grafana.

✨ Lihat sumber daya/komunitas pihak ketiga berikut untuk hal menarik terkait
TriliumNext:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) untuk tema,
  script, plugin pihak ketiga, dan lainnya.
- [TriliumRocks!](https://trilium.rocks/) untuk tutorial, panduan, dan banyak
  lagi.

## ❓Mengapa TriliumNext?

Pengembang asli Trilium ([Zadam](https://github.com/zadam)) telah dengan baik
hati menyerahkan repositori Trilium kepada proyek komunitas yang berada di
[https://github.com/TriliumNext](https://github.com/TriliumNext)

### ⬆️ Migrasi dari Zadam/Trilium?

Tidak ada langkah migrasi khusus untuk berpindah dari instance zadam/Trilium ke
TriliumNext/Trilium. Cukup [instal TriliumNext/Trilium](#-installation) seperti
biasa dan aplikasi akan menggunakan database yang sudah ada.

Versi hingga dan termasuk
[v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4)
kompatibel dengan versi zadam/trilium terbaru yaitu
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). Versi
TriliumNext/Trilium setelah itu memiliki versi sinkronisasi yang ditingkatkan
sehingga mencegah migrasi langsung.

## 💬 Diskusi bersama kami

Silakan bergabung dalam percakapan resmi kami. Kami sangat ingin mendengar
fitur, saran, atau masalah yang Anda miliki!

- [Matrix](https://matrix.to/#/#triliumnext:matrix.org) (Untuk diskusi sinkron.)
  - Ruang Matrix `General` juga terhubung ke
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [GitHub Discussions](https://github.com/TriliumNext/Trilium/discussions)
  (Untuk diskusi asinkron.)
- [GitHub Issues](https://github.com/TriliumNext/Trilium/issues) (Untuk laporan
  bug dan permintaan fitur.)

## 🏗 Instalasi

### Windows / MacOS

Unduh rilis biner untuk platform Anda dari [halaman rilis
terbaru](https://github.com/TriliumNext/Trilium/releases/latest), ekstrak paket,
lalu jalankan executable `trilium`.

### Linux

Jika distribusi Anda tercantum pada tabel di bawah, gunakan paket dari
distribusi tersebut.

[![Packaging
status](https://repology.org/badge/vertical-allrepos/trilium.svg)](https://repology.org/project/trilium/versions)

Anda juga dapat mengunduh rilis biner untuk platform Anda dari [halaman rilis
terbaru](https://github.com/TriliumNext/Trilium/releases/latest), ekstrak paket,
lalu jalankan executable `trilium`.

TriliumNext juga tersedia sebagai Flatpak, tetapi belum dipublikasikan di
FlatHub.

### Browser (semua OS)

Jika Anda menggunakan instalasi server (lihat di bawah), Anda dapat langsung
mengakses antarmuka web (yang hampir identik dengan aplikasi desktop).

Saat ini hanya versi terbaru Chrome dan Firefox yang didukung (dan diuji).

### Mobile

Untuk menggunakan TriliumNext di perangkat mobile, Anda dapat menggunakan
browser web mobile untuk mengakses antarmuka mobile dari instalasi server (lihat
di bawah).

Lihat issue
[https://github.com/TriliumNext/Trilium/issues/4962](https://github.com/TriliumNext/Trilium/issues/4962)
untuk informasi lebih lanjut tentang dukungan aplikasi mobile.

Jika Anda lebih memilih aplikasi Android native, Anda dapat menggunakan
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Laporkan bug dan fitur yang belum tersedia di [repositori
mereka](https://github.com/FliegendeWurst/TriliumDroid). Catatan: Sebaiknya
nonaktifkan pembaruan otomatis pada instalasi server Anda (lihat di bawah) saat
menggunakan TriliumDroid karena versi sinkronisasi harus cocok antara Trilium
dan TriliumDroid.

### Server

Untuk menginstal TriliumNext di server Anda sendiri (termasuk melalui Docker
dari [Dockerhub](https://hub.docker.com/r/triliumnext/trilium)), ikuti
[dokumentasi instalasi
server](https://docs.triliumnotes.org/user-guide/setup/server).


## 💻 Berkontribusi

### Terjemahan

Jika Anda penutur asli, bantu kami menerjemahkan Trilium dengan mengunjungi
[halaman Weblate](https://hosted.weblate.org/engage/trilium/).

Berikut cakupan bahasa yang kami miliki sejauh ini:

[![Translation
status](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Kode

Unduh repositori, instal dependensi menggunakan `pnpm`, lalu jalankan server
(tersedia di http://localhost:8080):
```shell
git clone [https://github.com/TriliumNext/Trilium.git](https://github.com/TriliumNext/Trilium.git)
cd Trilium
pnpm install
pnpm run server:start
```

### Dokumentasi

Unduh repositori, instal dependensi menggunakan `pnpm`, lalu jalankan lingkungan
yang diperlukan untuk mengedit dokumentasi:
```shell
git clone [https://github.com/TriliumNext/Trilium.git](https://github.com/TriliumNext/Trilium.git)
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

Sebagai alternatif, jika Anda telah menginstal Nix:
```shell
# Jalankan langsung
nix run .#edit-docs

# Atau instal ke profil Anda
nix profile install .#edit-docs
trilium-edit-docs
```


### Membangun Executable
Unduh repositori, instal dependensi menggunakan `pnpm`, lalu bangun aplikasi
desktop untuk Windows:
```shell
git clone [https://github.com/TriliumNext/Trilium.git](https://github.com/TriliumNext/Trilium.git)
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

Untuk detail lebih lanjut, lihat [dokumentasi
pengembangan](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### Dokumentasi Developer

Silakan lihat [panduan
dokumentasi](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
untuk detailnya. Jika Anda memiliki pertanyaan lebih lanjut, silakan hubungi
melalui tautan yang dijelaskan pada bagian "Diskusi bersama kami" di atas.

## 💖 Sponsor

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

## 👏 Ucapan Terima Kasih

* [zadam](https://github.com/zadam) untuk konsep dan implementasi awal aplikasi.
* [Sarah Hussein](https://github.com/Sarah-Hussein) untuk desain ikon aplikasi.
* [nriver](https://github.com/nriver) untuk kontribusinya dalam
  internasionalisasi.
* [Thomas Frei](https://github.com/thfrei) atas karya awalnya pada Canvas.
* [antoniotejada](https://github.com/nriver) atas widget syntax highlighting
  asli.
* [Tabler Icons](https://tabler.io/icons) untuk ikon system tray.

Trilium tidak akan mungkin ada tanpa teknologi yang mendukungnya:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - editor visual di balik
  catatan teks.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - editor kode dengan
  dukungan untuk banyak bahasa.
* [Excalidraw](https://github.com/excalidraw/excalidraw) - papan tulis tak
  terbatas yang digunakan dalam catatan Canvas.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - menyediakan
  fungsi mind map.
* [Leaflet](https://github.com/Leaflet/Leaflet) - untuk merender peta geografis.
* [Tabulator](https://github.com/olifolkerd/tabulator) - untuk tabel interaktif
  yang digunakan dalam koleksi.
* [FancyTree](https://github.com/mar10/fancytree) - library tree kaya fitur
  tanpa pesaing nyata.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - library konektivitas visual.
  Digunakan dalam [relation
  maps](https://docs.triliumnotes.org/user-guide/note-types/relation-map) dan
  [link
  maps](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 Dukungan

Trilium dibangun dan dipelihara dengan [ratusan jam
kerja](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Dukungan
Anda menjaga proyek ini tetap open-source, meningkatkan fitur, dan menutup biaya
seperti hosting.

Pertimbangkan untuk mendukung pengembang utama
([eliandoran](https://github.com/eliandoran)) melalui:

- [GitHub Sponsors](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 Lisensi

Hak Cipta 2017-2025 zadam, Elian Doran, dan kontributor lainnya

Program ini adalah perangkat lunak bebas: Anda dapat mendistribusikan ulang
dan/atau memodifikasinya di bawah ketentuan GNU Affero General Public License
sebagaimana diterbitkan oleh Free Software Foundation, baik versi 3 dari
Lisensi, atau (sesuai pilihan Anda) versi yang lebih baru.
