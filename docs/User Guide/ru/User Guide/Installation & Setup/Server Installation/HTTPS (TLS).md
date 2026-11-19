# HTTPS (TLS)
Настройка TLS крайне важна для [установки сервера](../Server%20Installation.md) Trilium. В этом руководстве описаны шаги по настройке TLS непосредственно в самом Trilium.

> [!TIP]
> Хотя Trilium поддерживает HTTPS самостоятельно, обычно рекомендуется использовать [обратный прокси](2.%20Reverse%20proxy.md) с терминацией TLS. Вы можете воспользоваться [подобным руководством](https://www.digitalocean.com/community/tutorials/how-to-secure-nginx-with-let-s-encrypt-on-ubuntu-20-04) для такой настройки.

## Получение сертификата TLS

У вас есть два варианта получения сертификата TLS:

*   **Рекомендуется**: получить сертификат TLS, подписанный корневым центром сертификации. Для личного использования отличным выбором является [Let's Encrypt](https://letsencrypt.org) — он бесплатный, автоматизированный и простой в настройке. Утилита Certbot поможет автоматизировать настройку TLS.
*   Сгенерировать самоподписанный сертификат. Этот вариант не рекомендуется из-за дополнительной сложности, связанной с импортом сертификата на все устройства, подключающиеся к серверу.

## Изменение `config.ini`

После получения сертификата отредактируйте файл `config.ini` в [каталоге данных](../Data%20directory.md), чтобы настроить Trilium на его использование:

```
[Network]
port=8080
# Set to true for TLS/SSL/HTTPS (secure), false for HTTP (insecure).
https=true
# Path to the certificate (run "bash bin/generate-cert.sh" to generate a self-signed certificate).
# Relevant only if https=true
certPath=/[username]/.acme.sh/[hostname]/fullchain.cer
keyPath=/[username]/.acme.sh/[hostname]/example.com.key
```

Вы также можете ознакомиться с разделом [конфигурации](../../Advanced%20Usage/Configuration%20\(config.ini%20or%20environment%20variables\).md), чтобы передавать все значения `config.ini` через переменные окружения. Например, TLS можно настроить с помощью переменных окружения:

```
export TRILIUM_NETWORK_HTTPS=true
export TRILIUM_NETWORK_CERTPATH=/path/to/cert.pem
export TRILIUM_NETWORK_KEYPATH=/path/to/key.pem
```

В примере выше показано, как это настраивается в среде, где сертификат был сгенерирован с помощью утилиты ACME от Let's Encrypt. Ваши пути могут отличаться. Для установок в Docker убедитесь, что эти пути находятся внутри тома или другого каталога, доступного контейнеру Docker, например `/home/node/trilium-data/[DIR IN DATA DIRECTORY]`.

После настройки `config.ini` перезапустите Trilium и откройте сервер по протоколу `https`.

## Самоподписанный сертификат

Если вы решите использовать самоподписанный сертификат для серверного экземпляра, учтите, что настольное приложение по умолчанию не будет ему доверять.

Чтобы обойти это, отключите проверку сертификатов, задав следующую переменную окружения (для Linux):

```
export NODE_TLS_REJECT_UNAUTHORIZED=0
trilium
```

В Trilium предусмотрены скрипты для запуска в этом режиме, например `trilium-no-cert-check.bat` для Windows.

**Предупреждение**: отключение проверки сертификатов TLS небезопасно. Используйте этот способ, только если вы полностью понимаете последствия.