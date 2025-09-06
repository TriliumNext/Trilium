# Using Kubernetes
As Trilium can be run in Docker it also can be deployed in Kubernetes. You can either use our Helm chart, a community Helm chart, or roll your own Kubernetes deployment.

The recommended way is to use a Helm chart.

## Root privileges

> [!NOTE]
> The Trilium container at this time needs to be run with root privileges. It will swap to UID and GID `1000:1000` to run the `node` process after execution though, so the main process doesn't run with root privileges.

The Trilium docker container needs to be run with root privileges. The node process inside the container will be started with reduced privileges (uid:gid 1000:1000) after some initialization logic. Please make sure that you don't use a security context (PodSecurityContext) which changes the user ID. To use a different uid:gid for file storage and the application, please use the `USER_UID` & `USER_GID` environment variables.

The docker image will also fix the permissions of `/home/node` so you don't have to use an init container.

## Helm Charts

[Official Helm chart](https://github.com/TriliumNext/helm-charts) from TriliumNext Unofficial helm chart by [ohdearaugustin](https://github.com/ohdearaugustin): [https://github.com/ohdearaugustin/charts](https://github.com/ohdearaugustin/charts)

## Adding a Helm repository

Below is an example of how

```
helm repo add trilium https://triliumnext.github.io/helm-charts
"trilium" has been added to your repositories
```

## How to install a chart

After reviewing the [`values.yaml`](https://github.com/TriliumNext/helm-charts/blob/main/charts/trilium/values.yaml) from the Helm chart, modifying as required and then creating your own:

```
helm install --create-namespace --namespace trilium trilium trilium/trilium -f values.yaml
```

For more information on using Helm, please refer to the Helm documentation, or create a Discussion in the TriliumNext GitHub Organization.