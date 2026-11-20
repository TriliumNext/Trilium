# Каталог данных
Каталог данных содержит:

*   `document.db` — [базу данных](../Advanced%20Usage/Database.md)
*   `config.ini` — настройки уровня экземпляра, такие как порт, на котором запускается приложение Trilium
*   `backup` — содержит автоматические [резервные копии](Backup.md) документов
*   `log` — содержит файлы журнала приложения

## Расположение каталога данных

Простой способ узнать, какой каталог данных использует Trilium, — посмотреть диалог «О Trilium Notes» (из «Меню» в левом верхнем углу):

![](Data%20directory_image.jpg)

Вот как определяется расположение:

Каталог данных обычно называется `trilium-data` и хранится в:

*   `/home/[user]/.local/share` для Linux
*   `/home/[user]/.var/app/org.triliumnotes.Trilium/data` для версии Flathub на Linux
*   `C:\Users\[user]\AppData\Roaming` для Windows Vista и новее
*   `/Users/[user]/Library/Application Support` для Mac OS
*   домашний каталог пользователя — запасной вариант, если некоторые из путей выше не существуют
*   домашний каталог пользователя также является настройкой по умолчанию для \[\[docker|Docker-установки сервера\]\]

Если вы хотите сделать резервную копию ваших данных Trilium, просто скопируйте этот единственный каталог — он содержит всё необходимое.

### Изменение расположения каталога данных

Если вы хотите использовать другое расположение для каталога данных, отличное от значения по умолчанию, можно изменить его через переменную окружения `TRILIUM_DATA_DIR`:

=== "<span class="tn-icon bx bxl-windows"></span> Windows"

    1.  Нажмите клавишу <span class="tn-icon bx bxl-windows"></span> на клавиатуре.
    2.  Найдите и выберите _Изменить системные переменные среды_.
    3.  Нажмите кнопку _Переменные среды…_ в правом нижнем углу вновь открытого экрана.
    4.  В верхнем разделе (_Переменные среды пользователя \[user\]_) нажмите кнопку _Создать…_.
    5.  В поле _Имя переменной_ введите `TRILIUM_DATA_DIR`.
    6.  Нажмите кнопку _Обзор каталога…_ и выберите новый каталог для хранения базы данных.
    7.  Закройте все окна, нажимая кнопку _ОК_ в каждом из них.

=== "<span class="tn-icon bx bxl-tux"></span> Linux"

    Trilium читает `TRILIUM_DATA_DIR` при запуске, поэтому переменная должна быть задана в окружении, которое его запускает.

    > [!NOTE]
    > Установка переменной не перемещает существующие заметки. Чтобы их сохранить, закройте Trilium и сначала скопируйте старый каталог данных в новое место. Trilium создаёт последнюю папку пути, если её нет, но не её родительские папки.

    **Десктопное приложение (.deb, .rpm, AppImage или .zip)**

    Чтобы использовать новое расположение независимо от того, как запускается Trilium (из меню приложений, ярлыка на рабочем столе, при входе или из терминала), задайте переменную для всей сессии:

    1.  Создайте файл `~/.config/environment.d/trilium.conf` со следующим содержимым, используя полный путь (`~` в этом файле не раскрывается):

        ```
        TRILIUM_DATA_DIR=/home/myuser/data/my-trilium-data
        ```
    2.  Выйдите из системы и войдите снова.

    Это работает на рабочих столах, запускаемых через `systemd`, что охватывает большинство дистрибутивов с GNOME или KDE Plasma. На других системах добавьте следующую строку в `~/.profile` вместо этого, затем выйдите из системы и войдите снова:

    ```sh
    export TRILIUM_DATA_DIR="$HOME/data/my-trilium-data"
    ```

    Та же строка в `~/.bashrc` (или эквиваленте вашей оболочки) применяется, только когда Trilium запускается из терминала, а не из меню приложений.

    **Flatpak (Flathub)**

    Версия из Flathub работает в песочнице, которая не видит остальную файловую систему, поэтому ей нужен доступ к папке, а также переменная:

    ```sh
    flatpak override --user \
        --env=TRILIUM_DATA_DIR=/home/myuser/data/my-trilium-data \
        --filesystem=/home/myuser/data/my-trilium-data:create \
        org.triliumnotes.Trilium
    ```

    Чтобы вернуться к расположению по умолчанию, выполните `flatpak override --user --reset org.triliumnotes.Trilium`. Это также удалит любые другие переопределения, заданные для Trilium.

    **Сервер, работающий как служба systemd**

    Добавьте строку `Environment=` в секцию `[Service]` unit-файла, описанного в <a class="reference-link" href="Server%20Installation/1.%20Installing%20the%20server/Packaged%20version%20for%20Linux.md">Пакетной версии для Linux</a>:

    ```
    [Service]
    Environment=TRILIUM_DATA_DIR=/var/lib/trilium-data
    ```

    Затем перезагрузите и перезапустите службу:

    ```sh
    sudo systemctl daemon-reload
    sudo systemctl restart trilium
    ```

    Пользователь, заданный в `User=`, должен иметь возможность записи в папку. Для Docker см. вместо этого <a class="reference-link" href="Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md">Использование Docker</a>.

=== "<span class="tn-icon bx bxl-apple"></span> macOS"

    Нужно создать `.plist`-файл в `~/Library/LaunchAgents`, чтобы он корректно загружался при каждом входе.

    Чтобы загрузить его вручную, нужно использовать `launchctl setenv TRILIUM_DATA_DIR <ваш_путь>`

    Вот предопределённый шаблон, в который нужно только добавить свой путь:

    ```xml
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
        <key>Label</key>
        <string>set.trilium.env</string>
        <key>RunAtLoad</key>
        <true/>
        <key>ProgramArguments</key>
        <array>
            <string>/bin/launchctl</string>
            <string>setenv</string>
            <string>TRILIUM_DATA_DIR</string>
            <string>/Users/YourUserName/Library/Application Support/trilium-data</string>
        </array>
    </dict>
    </plist>

    ```

### Создание скрипта для запуска с конкретным каталогом данных

Альтернатива глобальной установке переменной окружения — запускать только Trilium Notes с этой переменной окружения. Это позволяет разные стили настройки, такие как два экземпляра [базы данных](../Advanced%20Usage/Database.md) или «портативная» установка.

Чтобы сделать это в системах на базе Unix, просто запустите `trilium` так:

```
TRILIUM_DATA_DIR=/home/myuser/data/my-trilium-data trilium
```

Затем можно сохранить приведённую выше команду как shell-скрипт в вашем PATH для удобства.

## Каталог пользовательских данных Electron (только десктоп)

При запуске десктопного приложения Electron хранит внутренние данные (кэши, словари проверки орфографии, хранилище сессии и т.д.) отдельно от каталога данных Trilium. По умолчанию это происходит в системную папку данных приложения (например, `%APPDATA%` в Windows), что может быть нежелательно в корпоративных средах с перемещаемыми профилями или при работе в портативном режиме.

Чтобы держать данные Electron вне системного перемещаемого профиля, задайте переменную окружения `TRILIUM_ELECTRON_DATA_DIR` в явный путь. Скрипт `trilium-portable` делает это автоматически, указывая на `trilium-electron-data/` рядом с приложением.

## Точная настройка расположения каталогов/путей

Помимо каталога данных, некоторые его подкаталоги можно переместить в другое место, изменив переменную окружения:

| Переменная окружения | Значение по умолчанию | Описание |
| --- | --- | --- |
| `TRILIUM_DOCUMENT_PATH` | `${TRILIUM_DATA_DIR}/document.db` | Путь к [Базе данных](../Advanced%20Usage/Database.md) (хранящей все заметки и метаданные). |
| `TRILIUM_BACKUP_DIR` | `${TRILIUM_DATA_DIR}/backup` | Каталог, где хранятся автоматические резервные копии [Резервного копирования](Backup.md). |
| `TRILIUM_LOG_DIR` | `${TRILIUM_DATA_DIR}/log` | Каталог, где хранятся ежедневные [Журналы сервера](../Troubleshooting/Error%20logs/Backend%20(server)%20logs.md). |
| `TRILIUM_TMP_DIR` | `${TRILIUM_DATA_DIR}/tmp` | Каталог, где хранятся временные файлы (например, при открытии во внешнем приложении). |
| `TRILIUM_ANONYMIZED_DB_DIR` | `${TRILIUM_DATA_DIR}/anonymized-db` | Каталог, где хранится [Анонимизированная база данных](../Troubleshooting/Anonymized%20Database.md). |
| `TRILIUM_RESOURCES_DIR` | `${TRILIUM_DATA_DIR}/resources` | Каталог, где хранятся <a class="reference-link" href="Downloaded%20resources.md">Загруженные ресурсы</a>, такие как модели распознавания речи. |
| `TRILIUM_CONFIG_INI_PATH` | `${TRILIUM_DATA_DIR}/config.ini` | Путь к файлу [Конфигурации (config.ini или переменные окружения)](../Advanced%20Usage/Configuration%20(config.ini%20or%20environment%20variables).md). |
| `TRILIUM_ELECTRON_DATA_DIR` | Системный appData | Каталог для внутренних данных Electron (кэши, словари проверки орфографии и т.д.). Задайте это в портативном режиме, чтобы не писать в системный профиль (только десктоп). |
