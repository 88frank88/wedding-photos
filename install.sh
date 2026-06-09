#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/wedding-photos"
REPO_URL="${REPO_URL:-https://github.com/88frank88/wedding-photos.git}"
REPO_API="https://api.github.com/repos/88frank88/wedding-photos/releases/latest"

RED='\033[0;31m'
GREEN='\033[0;32m'
GOLD='\033[0;33m'
ROSA='\033[0;35m'
BOLD='\033[1m'
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

print_info() {
  echo -e "${GOLD}  ℹ $1${NC}"
}

ask_yes_no() {
  local prompt="$1"
  local default="${2:-y}"
  local yn
  while true; do
    echo -en "${GOLD}  $prompt [${default^^}/$(if [ "$default" = "y" ]; then echo "N"; else echo "Y"; fi)]${NC} "
    read -r yn < /dev/tty
    yn="${yn:-$default}"
    case "$yn" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      *) echo "  Bitte Y oder N eingeben." ;;
    esac
  done
}

generate_password() {
  tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c 16 || openssl rand -hex 8
}

get_latest_version() {
  curl -fsSL "$REPO_API" 2>/dev/null | grep '"tag_name"' | head -1 | sed -E 's/.*"v?([^"]+)".*/\1/' || echo "0.0.0"
}

get_current_version() {
  if [[ -f "${INSTALL_DIR}/VERSION" ]]; then
    cat "${INSTALL_DIR}/VERSION" | tr -d '[:space:]'
  else
    echo "0.0.0"
  fi
}

version_gt() {
  test "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" != "$1"
}

do_install_lxc() {
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

  print_step "nginx wird installiert..."
  if ! command -v nginx &>/dev/null; then
    apt-get install -y nginx
  fi
  print_ok "nginx installiert"

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
    print_ok ".env bereits vorhanden"
  fi

  print_step "Upload-Ordner wird erstellt..."
  mkdir -p "${INSTALL_DIR}/backend/uploads"
  chmod 755 "${INSTALL_DIR}/backend/uploads"
  chown -R www-data:www-data "${INSTALL_DIR}/backend/uploads" 2>/dev/null || true
  print_ok "Upload-Ordner bereit"

  print_step "Systemd-Service wird installiert..."
  cp "${INSTALL_DIR}/systemd/wedding-photos.service" /etc/systemd/system/wedding-photos.service
  systemctl daemon-reload
  systemctl enable wedding-photos.service
  systemctl restart wedding-photos.service
  print_ok "Service installiert und aktiviert"

  print_step "nginx wird konfiguriert..."
  cp "${INSTALL_DIR}/nginx/wedding-photos.conf" /etc/nginx/sites-available/wedding-photos
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  ln -sf /etc/nginx/sites-available/wedding-photos /etc/nginx/sites-enabled/wedding-photos
  nginx -t 2>/dev/null
  systemctl enable nginx
  systemctl restart nginx
  print_ok "nginx konfiguriert (Port 80 → Node.js:3000)"

  print_step "Firewall wird konfiguriert..."
  if command -v ufw &>/dev/null; then
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 3000/tcp >/dev/null 2>&1 || true
    print_ok "UFW: Port 80 + 3000 freigegeben"
  else
    apt-get install -y ufw >/dev/null 2>&1
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 3000/tcp >/dev/null 2>&1 || true
    print_ok "UFW installiert, Port 80 + 3000 freigegeben"
  fi

  sleep 2
  show_install_result
}

do_update_lxc() {
  local current_ver="$1"
  local latest_ver="$2"

  print_step "Update wird durchgeführt..."
  print_info "Aktuelle Version: v${current_ver}"
  print_info "Neue Version:     v${latest_ver}"

  cd "${INSTALL_DIR}"
  git fetch origin
  git reset --hard origin/main
  print_ok "Repository aktualisiert"

  cd "${INSTALL_DIR}/backend"
  npm install --production
  print_ok "Abhängigkeiten aktualisiert"

  if [[ -f "${INSTALL_DIR}/systemd/wedding-photos.service" ]]; then
    cp "${INSTALL_DIR}/systemd/wedding-photos.service" /etc/systemd/system/wedding-photos.service
    systemctl daemon-reload
  fi

  if [[ -f "${INSTALL_DIR}/nginx/wedding-photos.conf" ]]; then
    cp "${INSTALL_DIR}/nginx/wedding-photos.conf" /etc/nginx/sites-available/wedding-photos
    ln -sf /etc/nginx/sites-available/wedding-photos /etc/nginx/sites-enabled/wedding-photos
    nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
  fi

  systemctl restart wedding-photos.service
  print_ok "Service neugestartet"

  echo ""
  echo -e "${GREEN}  ✓ Update erfolgreich: v${current_ver} → v${latest_ver}${NC}"
  echo ""
}

show_install_result() {
  local server_ip
  server_ip=$(hostname -I | awk '{print $1}')
  local admin_pass
  admin_pass=$(grep '^ADMIN_PASSWORD=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d'=' -f2 || echo "siehe .env")

  local current_ver
  current_ver=$(get_current_version)

  echo ""
  echo -e "${ROSA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  Installation erfolgreich! (v${current_ver})${NC}"
  echo -e "${ROSA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  Webseite:       ${GREEN}http://${server_ip}${NC}"
  echo -e "  Admin-Panel:    ${GREEN}http://${server_ip}/admin${NC}"
  echo -e "  Admin-Passwort: ${GOLD}${admin_pass}${NC}"
  echo -e "  Version:        ${GOLD}v${current_ver}${NC}"
  echo -e "  Fotos unter:    ${INSTALL_DIR}/backend/uploads/"
  echo ""
  echo -e "  Nützliche Befehle:"
  echo -e "    systemctl status wedding-photos"
  echo -e "    journalctl -u wedding-photos -f"
  echo -e "    systemctl restart wedding-photos"
  echo ""
  echo -e "  Update auf neueste Version:"
  echo -e "    curl -fsSL https://raw.githubusercontent.com/88frank88/wedding-photos/main/install.sh | bash -s -- update"
  echo ""
  echo -e "${ROSA}  Mit Liebe für Irina & Alexander ♥${NC}"
  echo ""
}

do_proxmox_install() {
  print_step "Proxmox-Host erkannt — LXC-Installation"
  echo ""

  echo -e "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GOLD}  LXC Container erstellen${NC}"
  echo -e "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  local ct_id
  while true; do
    echo -en "${GOLD}  Container ID (z.B. 200): ${NC}"
    read -r ct_id < /dev/tty
    if [[ "$ct_id" =~ ^[0-9]+$ ]] && [ "$ct_id" -gt 0 ]; then
      if pct status "$ct_id" &>/dev/null; then
        print_error "Container $ct_id existiert bereits."
        if ask_yes_no "Diesen Container für Update nutzen?"; then
          do_proxmox_update "$ct_id"
          return
        fi
        continue
      fi
      break
    fi
    print_error "Bitte eine gültige numerische Container ID eingeben."
  done

  local storages
  storages=$(pvesm status 2>/dev/null | grep -E 'rootdir|images|subvol' | awk '{print $1}' | sort -u)
  if [[ -z "$storages" ]]; then
    storages=$(pvesm status 2>/dev/null | grep -v '^Name' | awk '{print $1}' | sort -u)
  fi

  local storage_array=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && storage_array+=("$line")
  done <<< "$storages"

  echo ""
  echo -e "${GOLD}  Verfügbarer Storage:${NC}"
  for i in "${!storage_array[@]}"; do
    echo -e "  ${BOLD}$((i+1)))${NC} ${storage_array[$i]}"
  done
  echo ""

  local storage_choice
  while true; do
    echo -en "${GOLD}  Storage auswählen [1-${#storage_array[@]}]: ${NC}"
    read -r storage_choice < /dev/tty
    if [[ "$storage_choice" =~ ^[0-9]+$ ]] && [ "$storage_choice" -ge 1 ] && [ "$storage_choice" -le "${#storage_array[@]}" ]; then
      break
    fi
    print_error "Bitte eine Nummer zwischen 1 und ${#storage_array[@]}."
  done
  local selected_storage="${storage_array[$((storage_choice-1))]}"
  print_ok "Storage: ${selected_storage}"

  echo ""
  echo -e "${GOLD}  Netzwerk-Konfiguration:${NC}"
  echo "  1) DHCP (automatisch)"
  echo "  2) Statische IP"
  echo ""
  local net_choice
  while true; do
    echo -en "${GOLD}  Auswahl [1/2]: ${NC}"
    read -r net_choice < /dev/tty
    [[ "$net_choice" =~ ^[12]$ ]] && break
    print_error "Bitte 1 oder 2."
  done

  local net_config="ip=dhcp"
  local gateway=""
  if [[ "$net_choice" == "2" ]]; then
    local static_ip
    while true; do
      echo -en "${GOLD}  IP/CIDR (z.B. 192.168.1.100/24): ${NC}"
      read -r static_ip < /dev/tty
      if [[ "$static_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+$ ]]; then
        break
      fi
      print_error "Format: IP/CIDR (z.B. 192.168.1.100/24)"
    done
    while true; do
      echo -en "${GOLD}  Gateway (z.B. 192.168.1.1): ${NC}"
      read -r gateway < /dev/tty
      if [[ "$gateway" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        break
      fi
      print_error "Format: IP (z.B. 192.168.1.1)"
    done
    net_config="ip=${static_ip},gw=${gateway}"
  fi

  print_step "Ubuntu 24.04 Template wird geprüft..."
  local template
  template=$(pveam list local 2>/dev/null | grep -i 'ubuntu.*24\.04' | head -1 | awk '{print $2}')
  if [[ -z "$template" ]]; then
    print_info "Template wird heruntergeladen..."
    pveam update
    local template_name
    template_name=$(pveam available 2>/dev/null | grep -i 'ubuntu.*24\.04.*standard' | head -1 | awk '{print $2}')
    if [[ -n "$template_name" ]]; then
      pveam download local "$template_name"
      template="local:${template_name}"
      print_ok "Template heruntergeladen: ${template_name}"
    else
      template=$(pveam list local 2>/dev/null | grep -i 'ubuntu.*24\|ubuntu.*22' | head -1 | awk '{print $2}')
      if [[ -z "$template" ]]; then
        print_error "Kein Ubuntu Template gefunden. Bitte manuell herunterladen:"
        echo "  pveam download local ubuntu-24.04-standard_24.04-2_amd64.tar.zst"
        exit 1
      fi
    fi
  else
    print_ok "Template gefunden: ${template}"
  fi

  if [[ "$template" != local:* ]]; then
    template="local:vztmpl/${template}"
  fi

  local hostname="wedding-photos"

  print_step "Container ${ct_id} wird erstellt..."
  pct create "$ct_id" "$template" \
    --hostname "$hostname" \
    --cores 1 \
    --memory 1024 \
    --swap 512 \
    --storage "$selected_storage" \
    --rootfs "${selected_storage}:20" \
    --net0 "name=eth0,bridge=vmbr0,${net_config}" \
    --features "nesting=1" \
    --unprivileged 1 \
    --onboot 1 \
    --password "$(generate_password)"
  print_ok "Container erstellt"

  print_step "Container wird gestartet..."
  pct start "$ct_id"
  print_ok "Container gestartet"

  print_info "Warte auf Netzwerk..."
  local retries=0
  while [ $retries -lt 30 ]; do
    if pct exec "$ct_id" -- ping -c1 -W1 8.8.8.8 &>/dev/null; then
      break
    fi
    retries=$((retries+1))
    sleep 2
  done

  if [ $retries -eq 30 ]; then
    print_error "Netzwerk nicht verfügbar. Bitte manuell prüfen."
    echo "  pct enter $ct_id"
    exit 1
  fi
  print_ok "Netzwerk bereit"

  print_step "Installation im Container..."
  pct exec "$ct_id" -- bash -c "apt-get update -qq && apt-get install -y -qq curl"
  pct exec "$ct_id" -- bash -c "curl -fsSL https://raw.githubusercontent.com/88frank88/wedding-photos/main/install.sh -o /tmp/install.sh && bash /tmp/install.sh"
  print_ok "Installation abgeschlossen"

  local ct_ip
  ct_ip=$(pct exec "$ct_id" -- hostname -I 2>/dev/null | awk '{print $1}')
  if [[ -z "$ct_ip" ]]; then
    ct_ip="<Container-IP>"
  fi

  local admin_pass
  admin_pass=$(pct exec "$ct_id" -- grep '^ADMIN_PASSWORD=' /opt/wedding-photos/.env 2>/dev/null | cut -d'=' -f2 || echo "siehe .env im Container")

  local current_ver
  current_ver=$(pct exec "$ct_id" -- cat /opt/wedding-photos/VERSION 2>/dev/null | tr -d '[:space:]' || echo "1.0.0")

  echo ""
  echo -e "${ROSA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  LXC-Installation erfolgreich! (v${current_ver})${NC}"
  echo -e "${ROSA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  Container ID:   ${BOLD}${ct_id}${NC}"
  echo -e "  Webseite:       ${GREEN}http://${ct_ip}${NC}"
  echo -e "  Admin-Panel:    ${GREEN}http://${ct_ip}/admin${NC}"
  echo -e "  Admin-Passwort: ${GOLD}${admin_pass}${NC}"
  echo -e "  Version:        ${GOLD}v${current_ver}${NC}"
  echo ""
  echo -e "  Container verwalten:"
  echo -e "    pct enter ${ct_id}"
  echo -e "    pct status ${ct_id}"
  echo -e "    pct stop ${ct_id}"
  echo -e "    pct start ${ct_id}"
  echo ""
  echo -e "  Update auf neueste Version:"
  echo -e "    curl -fsSL https://raw.githubusercontent.com/88frank88/wedding-photos/main/install.sh | bash -s -- update"
  echo ""
  echo -e "${ROSA}  Mit Liebe für Irina & Alexander ♥${NC}"
  echo ""
}

do_proxmox_update() {
  local ct_id="$1"

  print_step "Update für Container ${ct_id}..."
  local current_ver
  current_ver=$(pct exec "$ct_id" -- cat /opt/wedding-photos/VERSION 2>/dev/null | tr -d '[:space:]' || echo "0.0.0")
  local latest_ver
  latest_ver=$(get_latest_version)

  print_info "Aktuelle Version: v${current_ver}"
  print_info "Neueste Version:  v${latest_ver}"

  if [[ "$current_ver" == "$latest_ver" ]]; then
    print_ok "Bereits auf neuester Version (v${current_ver})"
    return
  fi

  if ! ask_yes_no "Update durchführen? (v${current_ver} → v${latest_ver})"; then
    print_info "Update abgebrochen."
    return
  fi

  pct exec "$ct_id" -- bash -c "curl -fsSL https://raw.githubusercontent.com/88frank88/wedding-photos/main/install.sh -o /tmp/install.sh && bash /tmp/install.sh update"
  print_ok "Update abgeschlossen"
}

main() {
  print_header

  if [[ "$EUID" -ne 0 ]]; then
    print_error "Dieses Skript muss als root ausgeführt werden."
    echo "  Benutze: sudo bash install.sh"
    exit 1
  fi

  local mode="${1:-}"

  if command -v pct &>/dev/null; then
    # ── PROXMOX HOST MODE ──
    if [[ "$mode" == "update" ]]; then
      echo -e "${GOLD}  Vorhandene Container:${NC}"
      pct list 2>/dev/null | grep -E 'wedding-photos|N/A' || true
      echo ""
      local ct_id
      while true; do
        echo -en "${GOLD}  Container ID für Update: ${NC}"
        read -r ct_id < /dev/tty
        if [[ "$ct_id" =~ ^[0-9]+$ ]] && pct status "$ct_id" &>/dev/null; then
          break
        fi
        print_error "Container ${ct_id} nicht gefunden."
      done
      do_proxmox_update "$ct_id"
    else
      do_proxmox_install
    fi
  else
    # ── LXC / DIRECT MODE ──
    if [[ "$mode" == "update" ]] || [[ -d "${INSTALL_DIR}/.git" ]]; then
      if [[ -d "${INSTALL_DIR}/.git" ]]; then
        local current_ver
        current_ver=$(get_current_version)
        local latest_ver
        latest_ver=$(get_latest_version)

        if [[ "$current_ver" == "$latest_ver" ]]; then
          print_ok "Bereits auf neuester Version (v${current_ver})"
          exit 0
        fi

        print_info "Aktuelle Version: v${current_ver}"
        print_info "Neueste Version:  v${latest_ver}"
        echo ""

        if [[ "$mode" != "update" ]]; then
          if ! ask_yes_no "Bestehende Installation gefunden. Update auf v${latest_ver} durchführen?"; then
            print_info "Update übersprungen. Neu-Installation nicht möglich — ${INSTALL_DIR} existiert bereits."
            exit 0
          fi
        fi

        do_update_lxc "$current_ver" "$latest_ver"
      else
        print_error "Keine Installation in ${INSTALL_DIR} gefunden."
        print_info "Führe das Skript ohne 'update' für eine Neu-Installation aus."
        exit 1
      fi
    else
      do_install_lxc
    fi
  fi
}

main "$@"
