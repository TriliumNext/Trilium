# Конфигурация обратного прокси
Может быть желательно выставить наружу в интернет только функциональность публикации Trilium, оставив приложение доступным только внутри локальной сети или через VPN.

Для этого требуется обратный прокси.

## Caddy

```
http://domain.com {
  reverse_proxy /share http://localhost:8080/share
}
```

Это для более новых версий, где функциональность публикации изолирована; для более старых версий требуется также включить `/assets`.[<sup>[1]</sup>](#fn2b8mg20aol8)

1.  [**<sup>^</sup>**](#fnref2b8mg20aol8)

    [https://github.com/orgs/TriliumNext/discussions/7341#discussioncomment-14679897](https://github.com/orgs/TriliumNext/discussions/7341#discussioncomment-14679897)
