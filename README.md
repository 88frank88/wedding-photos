# Wedding Photos — Irina & Alexander

Foto-Upload-Webseite für unsere Hochzeit am 26. Juni 2026.

## Installation (1 Befehl)

### Auf Proxmox-Host (erstellt automatisch einen LXC Container)

```bash
curl -fsSL https://raw.githubusercontent.com/88frank88/wedding-photos/main/install.sh | bash
```

Das Skript fragt interaktiv ab:
- **Container ID** (z.B. 200)
- **Storage** (verfügbare Storages werden angezeigt)
- **Netzwerk** (DHCP oder statische IP)

### Im LXC / Direkt auf Ubuntu

```bash
curl -fsSL https://raw.githubusercontent.com/88frank88/wedding-photos/main/install.sh | bash
```

## Update auf neueste Version

Auf dem Proxmox-Host oder im LXC:

```bash
curl -fsSL https://raw.githubusercontent.com/88frank88/wedding-photos/main/install.sh | bash -s -- update
```

Das Skript erkennt automatisch eine bestehende Installation und vergleicht die Version mit dem neuesten GitHub Release. Bei einer frisch-Installation wird automatisch geprüft, ob bereits eine Version installiert ist, und ein Update angeboten.

### Auf Proxmox-Host (Update eines Containers)

```bash
curl -fsSL https://raw.githubusercontent.com/88frank88/wedding-photos/main/install.sh | bash -s -- update
```

Dann wird nach der Container ID gefragt.

## Nach der Installation

| Funktion | URL |
|----------|-----|
| Webseite | `http://[IP]:3000` |
| Admin-Panel | `http://[IP]:3000/admin` |

Das Admin-Passwort wird am Ende der Installation angezeigt.

Fotos werden gespeichert unter: `/opt/wedding-photos/backend/uploads/`

## Nützliche Befehle

```bash
systemctl status wedding-photos     # Status prüfen
journalctl -u wedding-photos -f     # Live-Logs
systemctl restart wedding-photos    # Neustart
```

### Container-Verwaltung (Proxmox)

```bash
pct enter [ID]                      # In den Container wechseln
pct status [ID]                     # Container-Status
pct stop [ID]                       # Container stoppen
pct start [ID]                      # Container starten
```

## Fotos sichern

```bash
cp -r /opt/wedding-photos/backend/uploads/ /mnt/backup/
```

## Proxmox LXC Empfehlungen

| Einstellung | Empfehlung |
|-------------|------------|
| Template | ubuntu-24.04-standard |
| CPU | 1 Core |
| RAM | 512 MB (reicht), besser 1 GB |
| Disk | 20–50 GB (je nach Fotomenge) |
| Netzwerk | DHCP oder feste IP |
| Unprivileged | ja |
| Features | nesting=1 (für Node.js) |

## Manuelle Installation (ohne install.sh)

```bash
git clone https://github.com/88frank88/wedding-photos.git /opt/wedding-photos
cd /opt/wedding-photos/backend
npm install --production
cp ../.env.example ../.env
# .env bearbeiten und ADMIN_PASSWORD setzen
mkdir -p uploads && chmod 755 uploads
cp ../systemd/wedding-photos.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now wedding-photos
```

## Repository-Struktur

```
wedding-photos/
├── install.sh              ← Ein-Klick-Installer (Proxmox + LXC)
├── VERSION                 ← Aktuelle Versionsnummer
├── README.md
├── .env.example
├── backend/
│   ├── server.js           ← Express API Server
│   ├── package.json
│   └── uploads/            ← Foto-Speicherort
├── frontend/
│   ├── index.html          ← Single-Page-App
│   └── fonts/
│       └── Mistrully.ttf   ← Schriftart
└── systemd/
    └── wedding-photos.service
```

## API-Endpunkte

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| POST | `/api/upload` | Fotos hochladen (multipart/form-data) |
| GET | `/api/photos` | Alle Fotos auflisten |
| GET | `/api/health` | Server-Status |
| GET | `/uploads/:filename` | Foto direkt abrufen |
| GET | `/admin` | Admin-Panel (Basic Auth) |
| GET | `/admin/download-all` | Alle Fotos als ZIP |

## Lizenz

Privat — nur für Irina & Alexander.
