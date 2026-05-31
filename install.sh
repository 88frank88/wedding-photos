#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/wedding-photos"
REPO_URL="${REPO_URL:-https://github.com/USER/wedding-photos.git}"

RED='\033[0;31m'
GREEN='\033[0;32m'
GOLD='\033[0;33m'
ROSA='\033[0;35m'
NC='\033[0m'

print_header() {
  echo ""
  echo -e "${ROSA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${ROSA}  Wedding Photos — Irina & Alexander${NC}"
  echo -e "${ROSA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

print_step() {
  echo -e "${GOLD}▶ $1${NC}"
}

print_ok() {
  echo -e "${GREEN}  ✓ $1${NC}"
}

print_error() {
  echo -e "${RED}  ✗ $1${NC}"
}

generate_password() {
  tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c 16 || openssl rand -hex 8
}

print_header

if [[ "$EUID" -ne 0 ]]; then
  print_error "Dieses Skript muss als root ausgeführt werden."
  echo "  Benutze: sudo bash install.sh"
  exit 1
fi

print_step "System wird aktualisiert..."
apt-get update -qq
apt-get upgrade -y -qq
print_ok "System aktualisiert"

print_step "Node.js 20 LTS wird installiert..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
NODE_VERSION=$(node -v 2>/dev/null || echo "n/a")
print_ok "Node.js ${NODE_VERSION} installiert"

print_step "Git wird installiert..."
if ! command -v git &>/dev/null; then
  apt-get install -y git
fi
print_ok "Git installiert"

print_step "Repository wird geklont..."
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  cd "${INSTALL_DIR}"
  git pull || true
  print_ok "Repository aktualisiert"
else
  rm -rf "${INSTALL_DIR}" 2>/dev/null || true
  git clone "${REPO_URL}" "${INSTALL_DIR}"
  cd "${INSTALL_DIR}"
  print_ok "Repository geklont"
fi

print_step "npm-Abhängigkeiten werden installiert..."
cd "${INSTALL_DIR}/backend"
npm install --production
print_ok "Abhängigkeiten installiert"

print_step "Konfiguration wird erstellt..."
if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  ADMIN_PASS=$(generate_password)
  cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
  sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=${ADMIN_PASS}/" "${INSTALL_DIR}/.env"
  print_ok ".env erstellt mit generiertem Admin-Passwort"
else
  ADMIN_PASS=$(grep '^ADMIN_PASSWORD=' "${INSTALL_DIR}/.env" | cut -d'=' -f2)
  print_ok ".env bereits vorhanden"
fi

print_step "Upload-Ordner wird erstellt..."
mkdir -p "${INSTALL_DIR}/backend/uploads"
chmod 755 "${INSTALL_DIR}/backend/uploads"
chown -R www-data:www-data "${INSTALL_DIR}/backend/uploads"
print_ok "Upload-Ordner bereit"

print_step "Systemd-Service wird installiert..."
cp "${INSTALL_DIR}/systemd/wedding-photos.service" /etc/systemd/system/wedding-photos.service
systemctl daemon-reload
systemctl enable wedding-photos.service
systemctl restart wedding-photos.service
print_ok "Service installiert und aktiviert"

print_step "Firewall wird konfiguriert..."
if command -v ufw &>/dev/null; then
  ufw allow 3000/tcp >/dev/null 2>&1 || true
  print_ok "UFW: Port 3000 freigegeben"
else
  apt-get install -y ufw
  ufw allow 3000/tcp >/dev/null 2>&1 || true
  print_ok "UFW installiert, Port 3000 freigegeben"
fi

sleep 2

echo ""
echo -e "${ROSA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Installation erfolgreich!${NC}"
echo -e "${ROSA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

SERVER_IP=$(hostname -I | awk '{print $1}')
ADMIN_PASS=$(grep '^ADMIN_PASSWORD=' "${INSTALL_DIR}/.env" | cut -d'=' -f2)

echo -e "  Webseite:     ${GREEN}http://${SERVER_IP}:3000${NC}"
echo -e "  Admin-Panel:  ${GREEN}http://${SERVER_IP}:3000/admin${NC}"
echo -e "  Admin-Passwort: ${GOLD}${ADMIN_PASS}${NC}"
echo -e "  Fotos unter:  ${INSTALL_DIR}/backend/uploads/"
echo ""
echo -e "  Nützliche Befehle:"
echo -e "    systemctl status wedding-photos"
echo -e "    journalctl -u wedding-photos -f"
echo -e "    systemctl restart wedding-photos"
echo ""
echo -e "${ROSA}  Mit Liebe für Irina & Alexander ♥${NC}"
echo ""
