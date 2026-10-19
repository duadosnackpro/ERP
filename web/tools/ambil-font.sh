#!/bin/sh
# Mengunduh font Baloo 2 (subset latin) ke folder fonts/ agar aplikasi tidak bergantung pada Google Fonts.
# Jalankan SEKALI dari folder web/ (butuh internet): sh tools/ambil-font.sh
# Lalu commit folder fonts/ ke GitHub dan naikkan VERSION di sw.js dan js/config.js.
set -e
mkdir -p fonts
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
curl -fsSA "$UA" 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;800&display=swap' -o /tmp/baloo2.css
awk '/\/\* latin \*\//{f=1} f&&/font-weight/{w=$2; gsub(/;/,"",w)} f&&/src:/{match($0,/https:[^)]+/); print w, substr($0,RSTART,RLENGTH); f=0}' /tmp/baloo2.css | while read w url; do
  echo "Mengunduh bobot $w"; curl -fsSA "$UA" "$url" -o "fonts/baloo2-$w.woff2"
done
ls -l fonts
