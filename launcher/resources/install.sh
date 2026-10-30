#!/bin/sh
# CloudLocal — instalación por usuario en Linux, sin root.
#
# Copia el binario, el icono y la entrada de menú a ~/.local. No toca nada fuera
# del home del usuario y no requiere privilegios de administrador.
#
#   ./install.sh              instalar
#   ./install.sh --uninstall  desinstalar
set -eu

BIN_NAME=cloudlocal-linux-x64
APP_NAME=cloudlocal
DESKTOP_NAME=CloudLocal.desktop
ICON_NAME=cloudlocal.png

SRC_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BIN_DIR="$HOME/.local/bin"
DATA_DIR="$HOME/.local/share/cloudlocal"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"

refresh_menu() {
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
  fi
}

usage() {
  echo "Uso: ./install.sh [--uninstall]" >&2
  exit 1
}

uninstall() {
  rm -f "$BIN_DIR/$APP_NAME" "$DESKTOP_DIR/$DESKTOP_NAME" "$ICON_DIR/$ICON_NAME"
  rm -rf "$DATA_DIR"
  refresh_menu
  echo "CloudLocal eliminado de $HOME/.local"
}

install_app() {
  if [ ! -f "$SRC_DIR/$BIN_NAME" ]; then
    echo "No se encontró $BIN_NAME junto a install.sh." >&2
    echo "Extrae el ZIP completo y ejecuta ./install.sh desde esa carpeta." >&2
    exit 1
  fi

  mkdir -p "$BIN_DIR" "$DATA_DIR" "$DESKTOP_DIR" "$ICON_DIR"
  cp "$SRC_DIR/$BIN_NAME" "$BIN_DIR/$APP_NAME"
  chmod 755 "$BIN_DIR/$APP_NAME"
  cp "$SRC_DIR/$ICON_NAME" "$ICON_DIR/$ICON_NAME"
  chmod 644 "$ICON_DIR/$ICON_NAME"
  cp "$SRC_DIR/$DESKTOP_NAME" "$DESKTOP_DIR/$DESKTOP_NAME"
  chmod 644 "$DESKTOP_DIR/$DESKTOP_NAME"

  for file in README.md RELEASE-NOTES.md LICENSE NODE-LICENSE.txt THIRD-PARTY-NOTICES.txt; do
    if [ -f "$SRC_DIR/$file" ]; then
      cp "$SRC_DIR/$file" "$DATA_DIR/$file"
    fi
  done

  refresh_menu
  echo "CloudLocal instalado:"
  echo "  binario   $BIN_DIR/$APP_NAME"
  echo "  menú      $DESKTOP_DIR/$DESKTOP_NAME"
  echo "  icono     $ICON_DIR/$ICON_NAME"
  echo "  licencias $DATA_DIR"
  echo
  echo "Ejecuta 'cloudlocal' o búscalo en el menú de aplicaciones."
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "Nota: $BIN_DIR no está en PATH; añádelo o ejecuta la ruta completa." ;;
  esac
  echo "Para desinstalar: ./install.sh --uninstall"
}

case "${1:-}" in
  '') install_app ;;
  --uninstall) uninstall ;;
  -h|--help) usage ;;
  *) usage ;;
esac
