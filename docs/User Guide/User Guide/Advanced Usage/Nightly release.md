# Nightly release
Nightly releases are versions built every day, containing the latest improvements and bugfixes, directly from the main development branch. These versions are generally useful in preparation for a release, to ensure that there are no significant bugs that need to be addressed first, or they can be used to confirm whether a particular bug is fixed or feature is well implemented.

## Regarding the stability

Despite being on a development branch, generally the main branch is pretty stable since PRs are tested before they are merged. If you notice any issues, feel free to report them either via a ticket or via the Matrix.

## Downloading the nightly release manually

Go to [github.com/TriliumNext/Trilium/releases/tag/nightly](https://github.com/TriliumNext/Trilium/releases/tag/nightly) and look for the artifacts starting with `TriliumNotes-main`. Choose the appropriate one for your platform (e.g. `windows-x64.zip`).

Depending on your use case, you can either test the portable version or even use the installer.

> [!NOTE]
> If you choose the installable version (e.g. the .exe on Windows), it will replace your stable installation.

> [!IMPORTANT]
> By default, the nightly uses the same database as the production version. Generally you could easily downgrade if needed. However, if there are changes to the database or sync version, it will not be possible to downgrade without having to restore from a backup.

## Automatically download and install the latest nightly

This is pretty useful if you are a beta tester that wants to periodically update their version:

## On Ubuntu (Bash)

```sh
#!/usr/bin/env bash

name=TriliumNotes-linux-x64-nightly.deb
rm -f $name*
wget https://github.com/TriliumNext/Trilium/releases/download/nightly/$name
sudo apt-get install ./$name
rm $name
```

## On Windows (PowerShell)

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