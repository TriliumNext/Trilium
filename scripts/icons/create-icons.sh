#!/usr/bin/env bash

set -e

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
source_icon_dir="$script_dir/../../apps/server/src/assets/images"
desktop_forge_dir="$script_dir/../../apps/desktop/electron-forge"
cd "$desktop_forge_dir/app-icon"
inkscape -w 180 -h 180 "$source_icon_dir/icon-color.svg" -o "./ios/apple-touch-icon.png"

# Build PNGs
inkscape -w 128 -h 128 "$source_icon_dir/icon-color.svg" -o "./png/128x128.png"
inkscape -w 256 -h 256 "$source_icon_dir/icon-color.svg" -o "./png/256x256.png"

# Build dev icons (including tray)
inkscape -w 16 -h 16 "$source_icon_dir/icon-purple.svg" -o "./png/16x16-dev.png"
inkscape -w 32 -h 32 "$source_icon_dir/icon-purple.svg" -o "./png/32x32-dev.png"
inkscape -w 128 -h 128 "$source_icon_dir/icon-purple.svg" -o "./png/128x128-dev.png"
inkscape -w 256 -h 256 "$source_icon_dir/icon-purple.svg" -o "./png/256x256-dev.png"

# Build Mac default .icns
declare -a sizes=("16" "32" "512" "1024")
for size in "${sizes[@]}"; do
  inkscape -w $size -h $size "$source_icon_dir/icon-color.svg" -o "./png/${size}x${size}.png"
done

rm -r mac/*
mkdir -p fakeapp.app
npx iconsur set fakeapp.app -l -i "png/1024x1024.png" -o "mac/1024x1024.png" -s 0.8
declare -a sizes=("16x16" "32x32" "128x128" "512x512")
for size in "${sizes[@]}"; do
  magick "mac/1024x1024.png" -resize "${size}" "mac/${size}.png"
done
icnsutil compose -f "icon.icns" ./mac/*.png

# Build Mac dev .icns
declare -a sizes=("16" "32" "512" "1024")
for size in "${sizes[@]}"; do
  inkscape -w $size -h $size "$source_icon_dir/icon-purple.svg" -o "./png/${size}x${size}-dev.png"
done

npx iconsur set fakeapp.app -l -i "png/1024x1024-dev.png" -o "mac/1024x1024-dev.png" -s 0.8
declare -a sizes=("16x16" "32x32" "128x128" "512x512")
for size in "${sizes[@]}"; do
  magick "mac/1024x1024-dev.png" -resize "${size}" "mac/${size}-dev.png"
done
icnsutil compose -f "icon-dev.icns" ./mac/*-dev.png

# Build Windows icon
magick -background none "$source_icon_dir/icon-color.svg" -define icon:auto-resize=16,32,48,64,128,256 "./icon.ico"
magick -background none "$source_icon_dir/icon-purple.svg" -define icon:auto-resize=16,32,48,64,128,256 "./icon-dev.ico"

# Build Windows setup icon
magick -background none "$source_icon_dir/icon-installer.svg" -define icon:auto-resize=16,32,48,64,128,256 "$desktop_forge_dir/setup-icon/setup.ico"
magick -background none "$source_icon_dir/icon-installer-purple.svg" -define icon:auto-resize=16,32,48,64,128,256 "$desktop_forge_dir/setup-icon/setup-dev.ico"

# Build Squirrel splash image
magick "./png/256x256.png" -background "#ffffff" -gravity center -extent 640x480 "$desktop_forge_dir/setup-icon/setup-banner.gif"
magick "./png/256x256-dev.png" -background "#ffffff" -gravity center -extent 640x480 "$desktop_forge_dir/setup-icon/setup-banner-dev.gif"

# Copy server assets
server_dir="$script_dir/../../apps/server"
cp "$desktop_forge_dir/app-icon/icon.ico" "$server_dir/src/assets/icon.ico"
cp "$desktop_forge_dir/app-icon/icon-dev.ico" "$server_dir/src/assets/icon-dev.ico"

# Build Android mobile icons
# Legacy launcher: 48/72/96/144/192 px. Adaptive foreground: 108dp canvas with
# ~66% safe zone (Android masks the outer ring), scaled per density.
mobile_res_dir="$script_dir/../../apps/mobile/android/app/src/main/res"
background_color="#FAFAFA"

# Circular mask rendered via Inkscape for crisp antialiasing at icon sizes.
circle_mask_svg=$(mktemp --suffix=.svg)
cat > "$circle_mask_svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="50" fill="white"/>
</svg>
EOF
trap 'rm -f "$circle_mask_svg"' EXIT

declare -A launcher_sizes=( [mdpi]=48 [hdpi]=72 [xhdpi]=96 [xxhdpi]=144 [xxxhdpi]=192 )
declare -A foreground_sizes=( [mdpi]=108 [hdpi]=162 [xhdpi]=216 [xxhdpi]=324 [xxxhdpi]=432 )

for density in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  launcher_size=${launcher_sizes[$density]}
  foreground_size=${foreground_sizes[$density]}
  mipmap_dir="$mobile_res_dir/mipmap-$density"
  mkdir -p "$mipmap_dir"

  # Adaptive foreground: logo at 50% of the 108dp canvas. The 72dp (66%) safe
  # zone is the hard clip boundary — any launcher mask (circle, squircle,
  # teardrop) can trim up to it, so we leave extra margin inside.
  fg_logo=$(( foreground_size / 2 ))
  inkscape -w $fg_logo -h $fg_logo "$source_icon_dir/icon-color.svg" -o "$mipmap_dir/_tmp_fg.png"
  magick "$mipmap_dir/_tmp_fg.png" -background none -gravity center \
    -extent ${foreground_size}x${foreground_size} "$mipmap_dir/ic_launcher_foreground.png"
  rm "$mipmap_dir/_tmp_fg.png"

  # Monochrome layer for Android 13+ themed icons. Android ignores RGB and
  # uses only the alpha channel, tinting it with the system theme color.
  inkscape -w $fg_logo -h $fg_logo "$source_icon_dir/icon-black.svg" -o "$mipmap_dir/_tmp_mono.png"
  magick "$mipmap_dir/_tmp_mono.png" -background none -gravity center \
    -extent ${foreground_size}x${foreground_size} "$mipmap_dir/ic_launcher_monochrome.png"
  rm "$mipmap_dir/_tmp_mono.png"

  # Legacy square launcher (logo on solid background)
  sq_logo=$(( launcher_size * 2 / 3 ))
  inkscape -w $sq_logo -h $sq_logo "$source_icon_dir/icon-color.svg" -o "$mipmap_dir/_tmp.png"
  magick "$mipmap_dir/_tmp.png" -background "$background_color" -gravity center \
    -extent ${launcher_size}x${launcher_size} "$mipmap_dir/ic_launcher.png"

  # Legacy round launcher: Inkscape-rendered circle used as alpha mask.
  # Extract the mask's alpha channel (circle=opaque, bg=transparent) and copy
  # it onto the square icon.
  inkscape -w $launcher_size -h $launcher_size "$circle_mask_svg" \
    -o "$mipmap_dir/_tmp_mask.png"
  magick "$mipmap_dir/ic_launcher.png" \
    \( "$mipmap_dir/_tmp_mask.png" -alpha extract \) \
    -compose CopyOpacity -composite "$mipmap_dir/ic_launcher_round.png"
  rm "$mipmap_dir/_tmp.png" "$mipmap_dir/_tmp_mask.png"
done