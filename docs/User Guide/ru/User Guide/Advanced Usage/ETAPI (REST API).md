# ETAPI (REST API)
> [!TIP]
> Для быстрого старта обратитесь к <a class="reference-link" href="ETAPI%20(REST%20API)/API%20Reference.md">Справочнику API</a>.

ETAPI — публичный/внешний REST API Trilium. Доступен начиная с Trilium v0.50.

## Клиенты API

Как альтернативу прямым вызовам API существуют клиентские библиотеки, упрощающие эту задачу:

*   [trilium-py](https://github.com/Nriver/trilium-py) — можно использовать Python для взаимодействия с Trilium.

## Получение токена

Все операции с REST API должны аутентифицироваться токеном. Получить этот токен можно либо в <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройках</a> → _ETAPI_, либо программно через REST-вызов `/auth/login` (см. [спецификацию](https://github.com/TriliumNext/Trilium/blob/main/apps/server/src/assets/etapi.openapi.yaml)). При включённой [многофакторной аутентификации](../Installation%20%26%20Setup/Server%20Installation/Multi-factor%20authentication%20with%20TOTP.md) `/auth/login` также требует одноразовый пароль или код восстановления в `totpToken`.

Токен остаётся действительным, пока он не удалён в <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Настройках</a> → _ETAPI_ или через `/auth/logout`. Смена пароля не отзывает его, включая токен, полученный через `/auth/login`, поэтому скрипт продолжает работать после смены пароля.

## Аутентификация

### Через заголовок `Authorization`

```
GET https://myserver.com/etapi/app-info
Authorization: ETAPITOKEN
```

где `ETAPITOKEN` — токен, полученный на предыдущем шаге.

Для совместимости с различными инструментами также можно указывать значение заголовка `Authorization` в формате `Bearer ETAPITOKEN` (начиная с 0.93.0).

### Базовая аутентификация

Начиная с v0.56 можно также использовать формат basic auth:

```
GET https://myserver.com/etapi/app-info
Authorization: Basic BATOKEN
```

*   Где `BATOKEN = BASE64(username + ':' + password)` — это стандартная сериализация Basic Auth
*   Где `username` — «etapi»
*   А `password` — сгенерированный ETAPI-токен, описанный выше.

Basic Auth предназначен для инструментов, поддерживающих только basic auth.

## Взаимодействие через Bash-скрипты

Можно писать простые Bash-скрипты для взаимодействия с Trilium. В качестве примера вот как получить HTML-содержимое заметки:

```
#!/usr/bin/env bash

# Конфигурация
TOKEN=z1vA4fkGxjOR_ZXLrZeqHEFOv65yV3882iFCRtNIK9k9iWrHliITNSLQ=
SERVER=http://localhost:8080

# Скачивание заметки по ID
NOTE_ID="i6ra4ZshJhgN"
curl "$SERVER/etapi/notes/$NOTE_ID/content" -H "Authorization: $TOKEN" 
```

Обязательно замените значения:

*   `TOKEN` на ваш ETAPI-токен.
*   `SERVER` на корректные протокол, имя хоста и порт вашего экземпляра Trilium.
*   `NOTE_ID` на существующий ID заметки для скачивания.

Как другой пример, чтобы получить .zip-экспорт заметки и поместить его в каталог `out`, просто замените последний оператор в скрипте на:

```
curl -H "Authorization: $TOKEN" \
	-X GET "$SERVER/etapi/notes/$NOTE_ID/export" \
    --output "out/$NOTE_ID.zip"
```

## Загрузка бинарного содержимого

Тело JSON-запроса может нести только текст, поэтому поле `content` запроса `POST /etapi/attachments` сохраняет ровно ту строку, которую получает. Чтобы загрузить изображение, PDF или любой другой бинарный файл, отправьте сырые байты на endpoint содержимого с типом содержимого `application/octet-stream`. То же относится к содержимому заметки (`PUT /etapi/notes/{noteId}/content`).

Чтобы прикрепить файл к заметке, создайте вложение без содержимого, затем загрузите в него файл:

```
ATTACHMENT_ID=$(curl -s -X POST "$SERVER/etapi/attachments" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"ownerId\": \"$NOTE_ID\", \"role\": \"file\", \"mime\": \"application/pdf\", \"title\": \"report.pdf\", \"position\": 10}" \
    | jq -r .attachmentId)

curl -X PUT "$SERVER/etapi/attachments/$ATTACHMENT_ID/content" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary @report.pdf
```

Используйте `--data-binary`, а не `-d`, который удаляет из файла разрывы строк. Для изображения задайте `role` равным `image`, а `mime` — типом изображения, например `image/png`.
