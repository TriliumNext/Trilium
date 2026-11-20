# Ручная установка
> [!WARNING]
> На этой странице описана ручная установка Trilium на сервер. **Обратите внимание, что этот способ установки плохо поддерживается, могут возникнуть проблемы, а приведённая здесь информация существенно устарела. Рекомендуется использовать либо** <a class="reference-link" href="Using%20Docker.md">установку сервера через Docker</a>, **либо** <a class="reference-link" href="Packaged%20version%20for%20Linux.md">готовую сборку для Linux</a>**.**

## Требования

Trilium — это приложение на базе node.js. Поддерживаемые (протестированные) версии node.js — последние 14.X.X и 16.X.X. Trilium может работать и с более старыми версиями.

Вы можете проверить свою версию node следующей командой (node.js должен быть установлен):

```
node --version
```

Если в вашем дистрибутиве Linux доступна только устаревшая версия node.js, ознакомьтесь с инструкцией по установке на сайте node.js, где описаны большинство популярных дистрибутивов.

### Зависимости

Требуются некоторые системные зависимости. Ниже приведена команда для Debian и производных дистрибутивов (например, Ubuntu):

```
sudo apt install libpng16-16 libpng-dev pkg-config autoconf libtool build-essential nasm libx11-dev libxkbfile-dev
```

## Установка

### Загрузка

Вы можете скачать архив zip/tar с исходным кодом со страницы [https://github.com/TriliumNext/Trilium/releases/latest](https://github.com/TriliumNext/Trilium/releases/latest).

Чтобы получить последнюю версию, включая бета-сборки, клонируйте Git-репозиторий **из ветки** `main`:

```
git clone -b main https://github.com/triliumnext/trilium.git
```

## Сборка и установка

```
cd trilium

# download all node dependencies
npm install

# make sure the better-sqlite3 binary is there
npm rebuild

# bundles & minifies frontend JavaScript
npm run webpack
```

## Запуск

```
cd trilium

# using nohup to make sure trilium keeps running after user logs out
nohup TRILIUM_ENV=dev node src/www &
```

По умолчанию приложение запускается на порту 8080, поэтому вы можете открыть браузер и перейти по адресу [http://localhost:8080](http://localhost:8080) для доступа к Trilium (замените «localhost» на имя вашего хоста).

После запуска сервера в консоли будут выведены адреса, по которым он доступен, включая адреса для других устройств в вашей сети.

## TLS

Не забудьте [настроить TLS](../HTTPS%20\(TLS\).md) — это необходимо для безопасной работы!
