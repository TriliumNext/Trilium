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

![Спонсоры GitHub](https://img.shields.io/github/sponsors/eliandoran) ![Меценаты
LiberaPay ](https://img.shields.io/liberapay/patrons/ElianDoran)\
![Загрузок Docker](https://img.shields.io/docker/pulls/triliumnext/trilium)
![Загрузок GitHub (all assets, all
releases)](https://img.shields.io/github/downloads/triliumnext/trilium/total)\
[![RelativeCI](https://badges.relative-ci.com/badges/Di5q7dz9daNDZ9UXi0Bp?branch=develop)](https://app.relative-ci.com/projects/Di5q7dz9daNDZ9UXi0Bp)
[![Процесс
перевода](https://hosted.weblate.org/widget/trilium/svg-badge.svg)](https://hosted.weblate.org/engage/trilium/)

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

Trilium Notes – это приложение для заметок с иерархической структурой,
ориентированное на создание больших персональных баз знаний.

<img src="./app.png" alt="Trilium Screenshot" width="1000">

## ⏬ Загрузка
- [Последний релиз](https://github.com/TriliumNext/Trilium/releases/latest) –
  стабильная версия, подойдёт для большинства пользователей.
- [Ночной билд](https://github.com/TriliumNext/Trilium/releases/tag/nightly) –
  нестабильная разрабатываемая версия, ежедневно получает новые функции и
  исправления.

## 📚 Документация

**Полная документация по адресу
[docs.triliumnotes.org](https://docs.triliumnotes.org/)**

Документация доступна в нескольких форматах:
- **Онлайн Документация**: Полная документация доступна по адресу:
  [docs.triliumnotes.org](https://docs.triliumnotes.org/)
- **Справка в приложении**: Нажмите`F1` в Trilium для доступа к этой
  документации прямо в приложении
- **GitHub**: Ознакомьтесь с [Руководством
  пользователя](./User%20Guide/User%20Guide/) в этом репозитории

### Важные Ссылки
- [Руководство по началу работы](https://docs.triliumnotes.org/)
- [Инструкция по установке](https://docs.triliumnotes.org/user-guide/setup)
- [Установка
  Docker](https://docs.triliumnotes.org/user-guide/setup/server/installation/docker)
- [Обновление
  TriliumNext](https://docs.triliumnotes.org/user-guide/setup/upgrading)
- [Основные идеи и
  возможности](https://docs.triliumnotes.org/user-guide/concepts/notes)
- [Шаблоны Персональный Базы
  Знаний](https://docs.triliumnotes.org/user-guide/misc/patterns-of-personal-knowledge)

## 🎁 Возможности

* Заметки можно расположить в виде дерева произвольной глубины. Отдельную
  заметку можно разместить в нескольких местах дерева (см.
  [клонирование](https://docs.triliumnotes.org/user-guide/concepts/notes/cloning))
* Продвинутый визуальный редактор (WYSIWYG) позволяет работать с таблицами,
  изображениями,
  [формулами](https://docs.triliumnotes.org/user-guide/note-types/text) и
  разметкой markdown, имеет
  [автоформатирование](https://docs.triliumnotes.org/user-guide/note-types/text/markdown-formatting)
* Редактирование [заметок с исходным
  кодом](https://docs.triliumnotes.org/user-guide/note-types/code), включая
  подсветку синтаксиса
* Быстрая и простая [навигация между
  заметками](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-navigation),
  полнотекстовый поиск и [режим фокуса на
  заметке](https://docs.triliumnotes.org/user-guide/concepts/navigation/note-hoisting)
* Бесшовное [версионирование
  заметки](https://docs.triliumnotes.org/user-guide/concepts/notes/note-revisions)
* Специальные
  [атрибуты](https://docs.triliumnotes.org/user-guide/advanced-usage/attributes)
  позволяют гибко организовать структуру, используются для поиска и продвинутого
  [скриптинга](https://docs.triliumnotes.org/user-guide/scripts)
* Интерфейс доступен на Английском, Немецком, Испанском, Французском, Румынском
  и Китайском (упрощённом и традиционном)
* Интеграция [OpenID and TOTP
  integration](https://docs.triliumnotes.org/user-guide/setup/server/mfa) для
  более безопасного входа
* [Синхронизация](https://docs.triliumnotes.org/user-guide/setup/synchronization)
  заметок со своим сервером
  * существуют [сторонние сервисы для хостинга сервера
    синхронизации](https://docs.triliumnotes.org/user-guide/setup/server/cloud-hosting)
* [Публикация](https://docs.triliumnotes.org/user-guide/advanced-usage/sharing)
  заметок в открытом доступе в Интернете
* Надёжное
  [шифрование](https://docs.triliumnotes.org/user-guide/concepts/notes/protected-notes)
  с детализацией по каждой заметке
* Рисование и скетчинг диаграм, при помощи [Excalidraw](https://excalidraw.com/)
  (тип заметки "холст")
* [Карты
  связей](https://docs.triliumnotes.org/user-guide/note-types/relation-map) and
  [карты заметок](https://docs.triliumnotes.org/user-guide/note-types/note-map)
  для визуализации заметок и их связей
* Интеллект-карты на основе [Mind Elixir](https://docs.mind-elixir.com/)
* [Карты](https://docs.triliumnotes.org/user-guide/collections/geomap) с метками
  для мест и треками GPX
* [Скрипты](https://docs.triliumnotes.org/user-guide/scripts) - см. [продвинутые
  примеры](https://docs.triliumnotes.org/user-guide/advanced-usage/advanced-showcases)
* [REST API](https://docs.triliumnotes.org/user-guide/advanced-usage/etapi) для
  автоматизации
* Хорошо масштабируется, как по удобству использования, так и по
  производительности до 100000 заметок
* Оптимизированный [мобильный
  фронтенд](https://docs.triliumnotes.org/user-guide/setup/mobile-frontend)
  смартфонов и планшетов
* [Темная тема](https://docs.triliumnotes.org/user-guide/concepts/themes)
* Импорт и экпорт
  [Evernote](https://docs.triliumnotes.org/user-guide/concepts/import-export/evernote)
  и данных в
  [markdown](https://docs.triliumnotes.org/user-guide/concepts/import-export/markdown)
  формате
* [Web Clipper](https://docs.triliumnotes.org/user-guide/setup/web-clipper) для
  удобного сохранения веб-контента
* Настраиваемый пользовательский интерфейс (кнопки боковой панели,
  пользовательские виджеты и т. д.)
* [Метрики](https://docs.triliumnotes.org/user-guide/advanced-usage/metrics), а
  также панель мониторинга Grafana.

✨ Ознакомьтесь со следующими сторонними ресурсами/сообществами, чтобы найти
больше полезной информации о TriliumNext:

- [awesome-trilium](https://github.com/Nriver/awesome-trilium) - сторонние темы,
  скриптов, плагинов и многого другого.
- [TriliumRocks!](https://trilium.rocks/) — обучающие материалы, руководства и
  многое другое.

## ❓Почему именно TriliumNext?

Оригинальный разработчик Trilium ([Zadam](https://github.com/zadam)) любезно
предоставил репозиторий Trilium проекту сообщества, который находится по адресу
https://github.com/TriliumNext

### ⬆️Переходите с Zadam/Trilium?

Для миграции с экземпляра zadam/Trilium на экземпляр TriliumNext/Trilium не
требуется никаких дополнительных шагов. Просто [установите
TriliumNext/Trilium](#-installation) как обычно, и он будет использовать вашу
существующую базу данных.

Версии до [v0.90.4](https://github.com/TriliumNext/Trilium/releases/tag/v0.90.4)
включительно совместимы с последней версией zadam/trilium
[v0.63.7](https://github.com/zadam/trilium/releases/tag/v0.63.7). В более
поздних версиях TriliumNext/Trilium версии схемы данных отличаются сильнее, что
препятствует прямой миграции.

## 💬 Обсудите с нами

Приглашаем вас присоединиться к нашим официальным обсуждениям. Мы будем рады
узнать о ваших предложениях по улучшению, идеях или проблемах!

- [Матрица](https://matrix.to/#/#triliumnext:matrix.org) (Для оперативной
  коммуникации.)
  - Комната `General` в Matrix также подключена к
    [XMPP](xmpp:discuss@trilium.thisgreat.party?join)
- [Обсуждения на Github](https://github.com/TriliumNext/Trilium/discussions)
  (Для асинхронных обсуждений.)
- [Github Issues](https://github.com/TriliumNext/Trilium/issues) (Для сообщений
  об ошибках и запросов на добавление новых функций.)

## 🏗 Сборки

### Windows / macOS

Загрузите бинарный релиз для вашей платформы с [страницы последнего
релиза](https://github.com/TriliumNext/Trilium/releases/latest), распакуйте
пакет и запустите исполняемый файл `trilium`.

### Linux

Если ваш дистрибутив указан в таблице ниже, используйте пакет, соответствующий
вашему дистрибутиву.

[![Доступность](https://repology.org/badge/vertical-allrepos/trilium.svg)](https://repology.org/project/trilium/versions)

Вы также можете загрузить бинарный релиз для вашей платформы со [страницы
последнего релиза](https://github.com/TriliumNext/Trilium/releases/latest),
распаковать пакет и запустить исполняемый файл `trilium`.

TriliumNext также предоставляется в виде Flatpak-пакета, но пока не опубликован
на FlatHub.

### Браузер (любая ОС)

Если вы используете серверную установку (см. ниже), вы можете получить прямой
доступ к веб-интерфейсу (который практически идентичен настольному приложению).

В настоящее время поддерживаются (и протестированы) только последние версии
Chrome и Firefox.

### Мобильная версия

Для использования TriliumNext на мобильном устройстве вы можете использовать
мобильный веб-браузер для доступа к мобильному интерфейсу сервера (см. ниже).

Дополнительную информацию о поддержке мобильных приложений см. в треде
https://github.com/TriliumNext/Trilium/issues/4962.

Если вы предпочитаете нативное приложение для Android, вы можете использовать
[TriliumDroid](https://apt.izzysoft.de/fdroid/index/apk/eu.fliegendewurst.triliumdroid).
Сообщайте об ошибках и недостающих функциях в [их
репозитории](https://github.com/FliegendeWurst/TriliumDroid). Примечание: при
использовании TriliumDroid лучше отключить автоматические обновления на вашем
сервере (см. ниже), поскольку синхронизированные версии должны совпадать между
Trilium и TriliumDroid.

### Сервер

Чтобы установить TriliumNext на свой собственный сервер (в том числе через
Docker из [Dockerhub](https://hub.docker.com/r/triliumnext/trilium)), следуйте
[документации по установке
сервера](https://docs.triliumnotes.org/user-guide/setup/server).


## 💻 Участвуйте в разработке

### Переводы

Если вы являетесь носителем языка, помогите нам перевести Trilium, перейдя на
нашу [страницу Weblate](https://hosted.weblate.org/engage/trilium/).

Что сделано на данный момент:

[![Статус
перевода](https://hosted.weblate.org/widget/trilium/multi-auto.svg)](https://hosted.weblate.org/engage/trilium/)

### Код

Скачайте репозиторий, установите зависимости с помощью `pnpm`, затем запустите
сервер (доступен по адресу http://localhost:8080):
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run server:start
```

### Документация

Скачайте репозиторий, установите зависимости с помощью `pnpm`, затем запустите
окружение, необходимое для редактирование документации:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm edit-docs:edit-docs
```

Или если у вас установлен Nix:
```shell
# Запуск напрямую
nix run .#edit-docs

# Или запуск в профиле
nix profile install .#edit-docs
trilium-edit-docs
```


### Сборка исполняемого файла
Скачайте репозиторий, установите зависимости с помощью `pnpm`, затем соберите
приложение для Windows:
```shell
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium
pnpm install
pnpm run --filter desktop electron-forge:make --arch=x64 --platform=win32
```

Для получения подробностей, смотрите [документы
разработки](https://github.com/TriliumNext/Trilium/tree/main/docs/Developer%20Guide/Developer%20Guide).

### Документация для разработчиков

Пожалуйста, ознакомьтесь с
[руководством](https://github.com/TriliumNext/Trilium/blob/main/docs/Developer%20Guide/Developer%20Guide/Environment%20Setup.md)
для получения подробной информации. Если у вас возникнут дополнительные вопросы,
вы можете связаться с нами, используя ссылки, указанные в разделе «Обсудите с
нами» выше.

## 💖 Спонсоры

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

## 👏 Благодарности

* [zadam](https://github.com/zadam) за оригинальный концепт и реализацию
  приложения.
* [Sarah Hussein](https://github.com/Sarah-Hussein) за создание иконки
  приложения.
* [nriver](https://github.com/nriver) за работу по интернационализации.
* [Thomas Frei](https://github.com/thfrei) за его оригинальную работу над
  Холстом.
* [antoniotejada](https://github.com/nriver) за оригинальный виджет подсветки
  синтаксиса.
* [Tabler Icons](https://tabler.io/icons) за системные иконки.

Trilium не существовал бы без технологий, лежащих в его основе:

* [CKEditor 5](https://github.com/ckeditor/ckeditor5) - основной текстовый
  редактор.
* [CodeMirror](https://github.com/codemirror/CodeMirror) - редактор кода с
  поддержкой огромного количества языков.
* [Excalidraw](https://github.com/excalidraw/excalidraw) - бесконечная белая
  доска, используемая в заметках типа "Холст".
* [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) - обеспечивает
  функционирование ментальной карты.
* [Leaflet](https://github.com/Leaflet/Leaflet) - отображение географических
  карт.
* [Tabulator](https://github.com/olifolkerd/tabulator) - интерактивные таблицы,
  используемые в коллекциях.
* [FancyTree](https://github.com/mar10/fancytree) - многофункциональная
  библиотека деревьев, не имеющая себе равных.
* [jsPlumb](https://github.com/jsplumb/jsplumb) - библиотека визуальных связей.
  Используется в [картах
  связей](https://docs.triliumnotes.org/user-guide/note-types/relation-map) и
  [картах
  ссылок](https://docs.triliumnotes.org/user-guide/advanced-usage/note-map#link-map)

## 🤝 Поддержка

На создание и поддержку Trilium затрачены [сотни часов
работы](https://github.com/TriliumNext/Trilium/graphs/commit-activity). Ваша
поддержка помогает ему оставаться open-source, улучшает функции и покрывает
расходы, такие как хостинг.

Вы также можете поддержать главного разработчика приложения
([eliandoran](https://github.com/eliandoran)) с помощью:

- [Спонсоры GitHub](https://github.com/sponsors/eliandoran)
- [PayPal](https://paypal.me/eliandoran)
- [Buy Me a Coffee](https://buymeacoffee.com/eliandoran)

## 🔑 Лицензия

Copyright 2017-2025 zadam, Elian Doran и другие авторы

Эта программа является бесплатным программным обеспечением: вы можете
распространять и/или изменять ее в соответствии с условиями GNU Affero General
Public License, опубликованной Free Software Foundation, либо версии 3 Лицензии,
либо (по вашему выбору) любой более поздней версии.
