# Использование Kubernetes
Поскольку Trilium можно запускать в Docker, его также можно развернуть в Kubernetes. Вы можете использовать наш Helm-чарт, неофициальный Helm-чарт от сообщества или создать собственное развёртывание Kubernetes.

Рекомендуемый способ — использовать Helm-чарт.

## Права root

По умолчанию контейнер Trilium запускается от имени root, передаёт каталог данных пользователю и группе с UID и GID `1000:1000`, а затем запускает Trilium с этими пониженными правами, поэтому init-контейнер для исправления прав доступа не требуется. Чтобы использовать другие UID и GID, задайте переменные окружения `USER_UID` и `USER_GID`.

Начиная с версии v0.107.0, контейнер также может запускаться без прав root, что требуется стандартом безопасности подов `restricted` (Pod Security Standard). Задайте пользователя в `securityContext` пода, а также `fsGroup`, чтобы Kubernetes передал том этой группе:

```yaml
securityContext:
  runAsUser: 1000
  runAsGroup: 1000
  runAsNonRoot: true
  fsGroup: 1000
```

В этом режиме `USER_UID` и `USER_GID` игнорируются. Подробнее о требованиях к каталогу данных см. в разделе о запуске от имени обычного пользователя в <a class="reference-link" href="Using%20Docker.md">Использование Docker</a>.

## Helm-чарты

[Официальный Helm-чарт](https://github.com/TriliumNext/helm-charts) от TriliumNext Неофициальный Helm-чарт от [ohdearaugustin](https://github.com/ohdearaugustin): [https://github.com/ohdearaugustin/charts](https://github.com/ohdearaugustin/charts)

## Добавление репозитория Helm

Ниже приведён пример того, как это сделать:

```
helm repo add trilium https://triliumnext.github.io/helm-charts
"trilium" has been added to your repositories
```

## Установка чарта

После изучения файла [`values.yaml`](https://github.com/TriliumNext/helm-charts/blob/main/charts/trilium/values.yaml) из Helm-чарта, внесения необходимых изменений и создания собственного файла выполните:

```
helm install --create-namespace --namespace trilium trilium trilium/trilium -f values.yaml
```

Для получения дополнительной информации об использовании Helm обратитесь к документации Helm или создайте обсуждение (Discussion) в организации TriliumNext на GitHub.