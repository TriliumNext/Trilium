#!/usr/bin/env bash

if ! command -v magick &> /dev/null; then
  echo "This tool requires ImageMagick to be installed in order to create the icons."
  exit 1
fi

if ! command -v inkscape &> /dev/null; then
  echo "This tool requires Inkscape to be render sharper SVGs than ImageMagick."
  exit 1
fi

if ! command -v icnsutil &> /dev/null; then
  echo "This tool requires icnsutil to be installed in order to generate macOS icons."
  exit 1
fi

script_dir=$(realpath $(dirname $0))
cd "${script_dir}/../images/app-icons"
inkscape -w 180 -h 180 "../icon-color.svg" -o "./ios/apple-touch-icon.png"

# Build PNGs
inkscape -w 128 -h 128 "../icon-color.svg" -o "./png/128x128.png"
inkscape -w 256 -h 256 "../icon-color.svg" -o "./png/256x256.png"

# Build dev icons (including tray)
inkscape -w 16 -h 16 "../icon-purple.svg" -o "./png/16x16-dev.png"
inkscape -w 32 -h 32 "../icon-purple.svg" -o "./png/32x32-dev.png"
inkscape -w 256 -h 256 "../icon-purple.svg" -o "./png/256x256-dev.png"

# Build Mac .icns
declare -a sizes=("16" "32" "512" "1024")
for size in "${sizes[@]}"; do
  inkscape -w $size -h $size "../icon-color.svg" -o "./png/${size}x${size}.png"
done

mkdir -p fakeapp.app
npx iconsur set fakeapp.app -l -i "png/1024x1024.png" -o "mac/1024x1024.png" -s 0.8
declare -a sizes=("16x16" "32x32" "128x128" "512x512")
for size in "${sizes[@]}"; do
  magick "mac/1024x1024.png" -resize "${size}" "mac/${size}.png"
done
icnsutil compose -f "mac/icon.icns" ./mac/*.png

# Build Windows icon
magick -background none "../icon-color.svg" -define icon:auto-resize=16,32,48,64,128,256 "./icon.ico"

# Build Windows setup icon
magick -background none "../icon-installer.svg" -define icon:auto-resize=16,32,48,64,128,256 "./win/setup.ico"

# Build Squirrel splash image
magick "./png/256x256.png" -background "#ffffff" -gravity center -extent 640x480 "./win/setup-banner.gif"