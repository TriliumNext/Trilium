# Ночные сборки
Ночные сборки — это версии, собираемые каждый день и содержащие последние улучшения и исправления ошибок прямо из основной ветки разработки. Эти версии обычно полезны в подготовке к релизу, чтобы убедиться, что нет значительных ошибок, которые нужно сначала устранить, или чтобы проверить, исправлена ли конкретная ошибка или хорошо ли реализована возможность.

## О стабильности

Несмотря на то что это ветка разработки, основная ветка в целом довольно стабильна, так как PR тестируются перед слиянием. Если вы заметите какие-либо проблемы, не стесняйтесь сообщать о них через тикет или через Matrix.

## Ручная загрузка ночной сборки

Перейдите на [github.com/TriliumNext/Trilium/releases/tag/nightly](https://github.com/TriliumNext/Trilium/releases/tag/nightly) и найдите артефакты, начинающиеся с `TriliumNotes-main`. Выберите подходящий для вашей платформы (например, `windows-x64.zip`).

В зависимости от вашего случая вы можете либо протестировать портативную версию, либо даже использовать установщик.

> [!NOTE]
> Если вы выберете устанавливаемую версию (например, .exe на Windows), она заменит вашу стабильную установку.

> [!IMPORTANT]
> По умолчанию ночная сборка использует ту же базу данных, что и производственная версия. Как правило, при необходимости вы легко можете откатиться. Однако если есть изменения в версии базы данных или синхронизации, откатиться будет невозможно без восстановления из резервной копии.

## Автоматическая загрузка и установка последней ночной сборки

Это довольно полезно, если вы бета-тестер, который хочет периодически обновлять свою версию:

=== "<span class="tn-icon bx bxl-tux"></span> Ubuntu (Bash)"

    ```sh
    #!/usr/bin/env bash

    name=TriliumNotes-linux-x64-nightly.deb
    rm -f $name*
    wget https://github.com/TriliumNext/Trilium/releases/download/nightly/$name
    sudo apt-get install ./$name
    rm $name
    ```

=== "<span class="tn-icon bx bxl-windows"></span> Windows (PowerShell)"

    ```powershell
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
      $arch = "arm64";
    } else {
      $arch = "x64";
    }

    $exeUrl = "https://github.com/TriliumNext/Trilium/releases/download/nightly/TriliumNotes-main-windows-$($arch).exe";
    Write-Host "Downloading $($exeUrl)"

    # Generate a unique path in the temp dir
    $guid = [guid]::NewGuid().ToString()
    $destination = Join-Path -Path $env:TEMP -ChildPath "$guid.exe"

    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $exeUrl -OutFile $destination
        $process = Start-Process -FilePath $destination
    } catch {
        Write-Error "An error occurred: $_"
    } finally {
        # Clean up
        if (Test-Path $destination) {
            Remove-Item -Path $destination -Force
        }
    }
    ```
