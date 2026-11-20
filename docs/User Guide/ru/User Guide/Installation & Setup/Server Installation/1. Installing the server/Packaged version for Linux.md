# Готовая сборка для Linux
По сути, это исходный код Trilium + модули node + среда выполнения node.js, упакованные в один архив.

## Шаги установки

*   Подключитесь к вашему серверу по SSH.
*   Используйте `wget` (или `curl`), чтобы загрузить последнюю версию `TriliumNotes-Server-[VERSION]-linux-x64.tar.xz` (скопируйте ссылку со [страницы релизов](https://github.com/TriliumNext/Trilium/releases), обратите внимание на суффикс `-Server`) на ваш сервер.
*   Распакуйте архив, например с помощью `tar -xf -d TriliumNotes-Server-[VERSION]-linux-x64.tar.xz`.
*   `cd trilium-linux-x64-server`
*   `./trilium.sh`
*   Откройте в браузере http://\[your-server-hostname\]:8080 — вы должны увидеть страницу инициализации Trilium.
*   В консоли также выводятся адреса, по которым доступен сервер, так что вы можете скопировать один из них оттуда.

Проблема описанного выше способа в том, что после закрытия SSH-соединения или терминала процесс Trilium завершается. Как правило, лучший способ избежать этого — настроить systemd для автоматического запуска Trilium в фоновом режиме при каждой загрузке системы, как описано в следующем разделе. Это также обеспечит автоматический перезапуск Trilium при неожиданном сбое.

Чтобы оставить Trilium работать без настройки службы, остановите его (нажав <kbd>Ctrl</kbd>+<kbd>C</kbd>) и запустите снова, отсоединив от терминала:

*   `setsid -f ./trilium.sh > trilium.out 2>&1` запускает Trilium в новом сеансе, поэтому закрытие терминала его не затрагивает. Вывод записывается в файл `trilium.out`.
*   В качестве альтернативы в Bash или Zsh команда `./trilium.sh > trilium.out 2>&1 & disown` запускает процесс в фоне и удаляет его из списка заданий оболочки, чтобы она не останавливала его при выходе.

> [!WARNING]
> Команда `nohup ./trilium.sh &` не сохраняет работу Trilium. Node.js сбрасывает обработчики сигналов при запуске, поэтому перестаёт игнорировать сигнал разрыва соединения (`SIGHUP`), установленный `nohup`, и Trilium останавливается сразу после закрытия терминала.

## Настройка автозапуска Trilium при загрузке с помощью systemd

*   После загрузки распакуйте и переместите Trilium:

```
tar -xvf TriliumNotes-Server-[VERSION]-linux-x64.tar.xz
sudo mv trilium-linux-x64-server /opt/trilium
```

*   Создайте файл службы:

```
sudo nano /etc/systemd/system/trilium.service
```

*   Вставьте в файл следующее содержимое (укажите нужных пользователя и группу):

```
[Unit]
Description=Trilium Daemon
After=syslog.target network.target

[Service]
User=xxx
Group=xxx
Type=simple
ExecStart=/opt/trilium/trilium.sh
WorkingDirectory=/opt/trilium/

TimeoutStopSec=20
# KillMode=process leads to error, according to https://www.freedesktop.org/software/systemd/man/systemd.kill.html
Restart=always

[Install]
WantedBy=multi-user.target
```

*   Сохраните файл (CTRL-S) и выйдите (CTRL-X).
*   Включите и запустите службу:

```
sudo systemctl enable --now -q trilium
```

*   Теперь вы можете открыть в браузере http://\[your-server-hostname\]:8080 и увидеть страницу инициализации Trilium.

## Простое автообновление сервера

Скрипт доступен по ссылке <a class="reference-link" href="Packaged%20version%20for%20Linux/Simple%20auto-update%20for%20server.dat">Simple auto-update for server</a>.

*   Запускайте от имени того же пользователя, от которого работает Trilium.
    
    *   Если вы запускаете от `root`, удалите `sudo` из команд.
*   Требуется `jq`:
    
    ```sh
    apt install jq
    ```

Скрипт остановит указанную выше службу, перезапишет все файлы (предполагая отсутствие `config.ini`) и снова запустит службу. Он также создаёт файл версии в каталоге Trilium, чтобы обновление выполнялось только при выходе более новой версии.

## Частые проблемы

### Устаревшая версия glibc

```
Error: /usr/lib64/libstdc++.so.6: version `GLIBCXX_3.4.21' not found (required by /var/www/virtual/.../node_modules/@mlink/scrypt/build/Release/scrypt.node)
    at Object.Module._extensions..node (module.js:681:18)
    at Module.load (module.js:565:32)
    at tryModuleLoad (module.js:505:12)
```

Если вы столкнулись с такой ошибкой, необходимо либо обновить glibc (обычно путём обновления дистрибутива до актуальной версии), либо воспользоваться другим способом [установки сервера](../../Server%20Installation.md).

## TLS

Не забудьте [настроить TLS](../HTTPS%20\(TLS\).md) — это необходимо для безопасной работы!
