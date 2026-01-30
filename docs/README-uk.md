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

![Спонсори GitHub](https://img.shields.io/github/sponsors/eliandoran)
![Користувачі LiberaPay](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Docker Pulls](https://img.shields.io/docker/pulls/triliumnext/trilium)
![Завантаження GitHub (всі ресурси, всі
релізи)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Статус
перекладу](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

<!-- translate:off -->
<!-- LANGUAGE SWITCHER -->
[Chinese (Simplified Han script)](./README-ZH_CN.md) | [Chinese (Traditional Han
script)](./README-ZH_TW.md) | [English](../README.md) | [French](./README-fr.md)
| [German](./README-de.md) | [Greek](./README-el.md) | [Italian](./README-it.md)
| [Japanese](./README-ja.md) | [Romanian](./README-ro.md) |
[Spanish](./README-es.md)
<!-- translate:on -->

Trilium Notes — це безкоштовний кросплатформний ієрархічний додаток для ведення
нотаток з відкритим кодом, орієнтований на створення великих персональних баз
знань.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ Завантажити
- [Latest release](https://github.com/TriliumNext/Trilium/releases/latest) –
  стабільна версія, рекомендована для більшості користувачів.
- [Nightly build](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  нестабільна версія для розробників, щодня оновлюється найновішими функціями та
  виправленнями.

## 📚 Документація

**Відвідайте нашу вичерпну документацію за адресою
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Наша документація доступна в кількох форматах:
- **Онлайн-документація**: Перегляньте повну документацію на сайті
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Довідка в додатку**: Натисніть `F1` у Trilium, щоб отримати доступ до тієї ж
  документації безпосередньо в додатку
- **GitHub**: Перегляд [Посібника користувача](./User%20Guide/User%20Guide/) у
  цьому репозиторії

### Швидкі посилання
- [Посібник із початку роботи](https://docs.triliumnotes.org/)
- [Інструкції з встановлення](https://docs.triliumnotes.org/user-guide/setup)
- [Налаштування
  Docker](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [Оновлення
  TriliumNext](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [Основні поняття та
  функції](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [Шаблони особистої бази
  знань](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 Можливості

* Нотатки можна розташувати в дерево довільної глибини. Одну нотатку можна
  розмістити в кількох місцях дерева (див.
  [клонування](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* Багатий WYSIWYG-редактор нотаток, включаючи, наприклад, таблиці, зображення та
  [математику](https://docs.triliumnotes.org/user-guide/note-types/text) з
  markdown
  [автоформат](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
* Підтримка редагування [нотатки з вихідним
  кодом](https://docs.triliumnotes.org/user-guide/note-types/code), включаючи
  підсвічування синтаксису
* Швидка та проста [навігація між
  нотатками](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation),
  повнотекстовий пошук та [хостінг
  нотаток](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* Безшовне [керування версіями
  нотаток](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* [Атрибути](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  нотатки можна використовувати для організації нотаток, запитів та розширеного
  [сриптінгу](https://docs.triliumnotes.org/user-guide/scripts)
* Інтерфейс користувача доступний англійською, німецькою, іспанською,
  французькою, румунською та китайською (спрощеною та традиційною) мовами
* Пряма [OpenID та TOTP
  інтеграція](https://docs.triliumnotes.org/user-guide/setup/server/mfa) для
  безпечнішого входу
* [Синхронізація](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  із власним сервером синхронізації
  * there are [3rd party services for hosting synchronisation
    server](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [Спільне
  використання](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  (публікація) нотаток у загальнодоступному інтернеті
* Надійне [шифрування
  нотаток](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  з деталізацією для кожної нотатки
* Створення ескізних схем на основі [Excalidraw](https://excalidraw.com/) (тип
  нотатки "полотно")
* [Relation
  maps](https://docs.triliumnotes.org/user-guide/note-types/relation-map) and
  [note/link maps](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  for visualizing notes and their relations
* Інтелект-карти, засновані на [Mind Elixir](https://docs.mind-elixir.com/)
* [Геокарти](https://docs.triliumnotes.org/user-guide/collections/geomap) з
  географічними позначками та GPX-треками
* [Сценарії](https://docs.triliumnotes.org/user-guide/scripts) – див. [Розширені
  демонстрації](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [REST API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi) для
  автоматизації
* Добре масштабується як за зручністю використання, так і за продуктивністю до
  100 000 нотаток
* Оптимізовано для сенсорного керування [мобільний
  інтерфейс](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend) для
  смартфонів і планшетів
* Вбудована [темна
  тема](https://docs.triliumnotes.org/user-guide/concepts/themes), підтримка тем
  користувача
* [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  та [Markdown імпорт &
  експорт](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper) для
  легкого збереження веб-контенту
* Настроюваний інтерфейс користувача (кнопки бічної панелі, віджети, що
  визначаються користувачем, ...)
* [Метрики](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics), а
  також панель інструментів Grafana.

✨ Перегляньте наступні сторонні ресурси/спільноти, щоб дізнатися більше про
TriliumNext:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) для тем,
  скриптів, плагінів тощо від сторонніх розробників.
- [TriliumRocks!](https://trilium.rocks/) для навчальних посібників, інструкцій
  та багато іншого.

## ❓Чому TriliumNext?

Оригінальний розробник Trilium ([Zadam](https://github.com/zadam)) люб'язно
надав репозиторій Trilium спільнотному проекту, який знаходиться за адресою
https://github.com/TriliumNext

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

## Обговоріть це з нами

Не соромтеся приєднуватися до наших офіційних обговорень. Ми будемо раді почути
про ваші функції, пропозиції чи проблеми!

- [Матриця](https://matrix.to/#/#triliumnext:matrix.org) (Для синхронних
  обговорень.)
  - Кімната матриці `Загальні` також підключена до
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [Обговорення на Github](https://github.com/TriliumNext/Trilium/discussions)
  (Для асинхронних обговорень.)
- [Проблеми Github](https://github.com/TriliumNext/Trilium/issues) (Для звітів
  про помилки та запитів на нові функції.)

## 🏗 Встановлення

### Windows / MacOS

Завантажте бінарний реліз для вашої платформи зі сторінки [останнього
релізу](https://github.com/TriliumNext/Trilium/releases/latest), розпакуйте
пакет і запустіть виконуваний файл `trilium`.

### Linux

Якщо ваш дистрибутив зазначено в таблиці нижче, використовуйте пакет вашого
дистрибутива.

[![Packaging
status](https://repology.org/badge/vertical-allrepos/triliumnext.svg)](https://repology.org/project/triliumnext/versions)

Ви також можете завантажити бінарний реліз для вашої платформи зі сторінки
[останнього релізу](https://github.com/TriliumNext/Trilium/releases/latest),
розпакувати пакет і запустити виконуваний файл `trilium`.

TriliumNext також доступний у форматі Flatpak, але ще не опублікований на
FlatHub.

### Браузер (будь-яка ОС)

Якщо ви використовуєте серверну інсталяцію (див. нижче), ви можете отримати
безпосередній доступ до веб-інтерфейсу (який майже ідентичний десктопному
додатку).

Наразі підтримуються (і протестовані) лише найновіші версії Chrome та Firefox.

### Мобільний

Щоб використовувати TriliumNext на мобільному пристрої, ви можете скористатися
мобільним веб-браузером для доступу до мобільного інтерфейсу серверної
інсталяції (див. нижче).

Див. випуск https://github.com/TriliumNext/Trilium/issues/4962 для отримання
додаткової інформації про підтримку мобільних додатків.

Якщо ви надаєте перевагу рідному додатку для Android, ви можете скористатися
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Повідомляйте про помилки та відсутні функції на [їхньому
репозиторії](https://github.com/FliegendeWurst/TriliumDroid). Примітка: Найкраще
вимкнути автоматичні оновлення на вашому сервері (див. нижче) під час
використання TriliumDroid, оскільки версія синхронізації має збігатися між
Trilium та TriliumDroid.

### Сервер

Щоб встановити TriliumNext на власний сервер (зокрема через Docker з
[Dockerhub](https://hub.docker.com/r/triliumnext/trilium)), дотримуйтесь
інструкцій [документації щодо встановлення
сервера](https://docs.triliumnotes.org/user-guide/setup/server).


## 💻 Зробіть свій внесок

### Переклади

Якщо ви носій мови, допоможіть нам перекласти Trilium, перейшовши на нашу
[сторінку Weblate](https://hosted.weblate.org/engage/trilium/).

Ось мовне висвітлення, яке ми маємо наразі:

[![Стан
перекладу](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Код

Завантажте репозиторій, встановіть залежності за допомогою `pnpm`, а потім
запустіть сервер (доступний за адресою http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### Документація

Завантажте репозиторій, встановіть залежності за допомогою `pnpm`, а потім
запустіть середовище, необхідне для редагування документації:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

### Створення виконуваного файлу
Завантажте репозиторій, встановіть залежності за допомогою `pnpm`, а потім
зберіть настільний додаток для Windows:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

Для отримання додаткової інформації див. [документацію
розробника](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### Документація розробника

Please view the [documentation
guide](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
for details. If you have more questions, feel free to reach out via the links
described in the "Discuss with us" section above.

## 👏 Привітання

* [zadam](https://github.com/zadam) за оригінальну концепцію та реалізацію
  застосунку.
* [Sarah Hussein](https://github.com/Sarah-Hussein) за розробку піктограми
  програми.
* [nriver](https://github.com/nriver) за його роботу з інтернаціоналізації.
* [Thomas Frei](https://github.com/thfrei) за його оригінальну роботу на Canvas.
* [antoniotejada](https://github.com/nriver) для оригінального віджета
  підсвічування синтаксису.
* [Dosu](https://dosu.dev/) за надання нам автоматичних відповідей на проблеми
  та обговорення GitHub.
* [Tabler Icons](https://tabler.io/icons) для значків у системному треї.

Trilium був би неможливим без технологій, що лежать в його основі:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) – візуальний редактор
  текстових нотаток. Ми вдячні за те, що нам запропонували набір
  преміум-функцій.
* [CodeMirror](https://github.com/codemirror/CodeMirror) – редактор коду з
  підтримкою величезної кількості мов програмування.
* [Excalidraw](https://github.com/excalidraw/excalidraw) – нескінченна дошка, що
  використовується в нотатках Canvas.
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) – забезпечує
  функціональність карти розуму.
* [Leaflet](https://github.com/Leaflet/Leaflet) – для візуалізації географічних
  карт.
* [Tabulator](https://github.com/olifolkerd/tabulator) – для інтерактивної
  таблиці, що використовується в колекціях.
* [FancyTree](https://github.com/mar10/fancytree) – багатофункціональна
  бібліотека дерев без реальної конкуренції.
* [jsPlumb](https://github.com/jsplumb/jsplumb) – бібліотека візуальної
  зв’язності. Використовується в [картах
  зв’язків](https://docs.triliumnotes.org/user-guide/note-types/relation-map) та
  [картах
  посилань](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 Підтримка

Trilium створено та підтримується [сотнями годин
роботи](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Ваша
підтримка забезпечує його відкритий вихідний код, покращує функції та покриває
витрати, такі як хостинг.

Розгляньте можливість підтримки головного розробника
([eliandoran](https://github.com/eliandoran)) програми через:

- [Спонсори GitHub](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 Ліцензія

Авторське право 2017-2025 належить zadam, Elian Doran та іншим авторам

Ця програма є вільним програмним забезпеченням: ви можете розповсюджувати її
та/або змінювати відповідно до умов Загальної публічної ліцензії GNU Affero,
опублікованої Фондом вільного програмного забезпечення, або версії 3 Ліцензії,
або (на ваш вибір) будь-якої пізнішої версії.
