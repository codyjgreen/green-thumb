# Hosting Guide — Green-Thumb 🌱

Complete guide to running the Green-Thumb API and frontend permanently on your home server at `192.168.0.102`, accessible publicly at `https://greenthumb.dnd-dad.com`.

---

## Architecture

```
Internet → Cloudflare (proxy/SSL) → nginx:80/443 → API:4041
                                               → Frontend:4042 (or nginx serves static)
```

> **Cloudflare constraint:** Cloudflare only proxies ports 80 and 443. All services must be reachable through nginx on those ports.

---

## Prerequisites

- [ ] PostgreSQL running on `localhost:4050`
- [ ] Ollama running at `http://192.168.0.27:11434`
- [ ] Node.js 20+ with `tsx` and `npx`
- [ ] nginx installed (`sudo apt install nginx`)
- [ ] Cloudflare account with `greenthumb.dnd-dad.com` added

---

## 1. Install the Systemd Services

Three services cover the API, frontend, and (optional) Swagger UI proxy:

```bash
# Copy service files
sudo cp /home/cody/green-thumb/deploy/green-thumb-api.service   /etc/systemd/system/
sudo cp /home/cody/green-thumb/deploy/green-thumb-frontend.service /etc/systemd/system/

# Reload systemd, enable and start
sudo systemctl daemon-reload
sudo systemctl enable green-thumb-api    green-thumb-frontend
sudo systemctl start  green-thumb-api    green-thumb-frontend

# Verify all running
sudo systemctl status green-thumb-api    green-thumb-frontend
```

### Verify locally
```bash
curl http://localhost:4041/api/v1/health   # API
curl http://localhost:4042                 # Frontend
curl http://localhost:4041/docs            # Swagger UI
```

---

## 2. Configure nginx

nginx receives all external traffic and routes it to the right internal service.

### Option A — All services behind nginx (recommended for public access)

**File:** `/etc/nginx/sites-available/greenthumb.conf`

```nginx
# ── greenthumb.dnd-dad.com ──────────────────────────────────────────────
# Handles: API (4041) + Frontend (4042) + Swagger UI (4041/docs)
# ─────────────────────────────────────────────────────────────────────────

upstream greenthumb_api {
    server 127.0.0.1:4041;
}

upstream greenthumb_frontend {
    server 127.0.0.1:4042;
}

# Redirect www → apex
server {
    listen 80;
    server_name www.greenthumb.dnd-dad.com;
    return 301 https://greenthumb.dnd-dad.com$request_uri;
}

# Main site — serves both API and frontend
server {
    listen 80;
    server_name greenthumb.dnd-dad.com;

    # Frontend static files (root)
    location / {
        proxy_pass http://greenthumb_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API — /api/* routes
    location /api/ {
        proxy_pass http://greenthumb_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # Swagger UI at /docs
    location /docs {
        proxy_pass http://greenthumb_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # OpenAPI spec at /docs/json and /docs/yaml
    location ~ ^/docs/(json|yaml)$ {
        proxy_pass http://greenthumb_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Swagger static assets at /docs/static/*
    location /docs/static {
        proxy_pass http://greenthumb_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SSE /jobs endpoints need longer timeouts
    location /api/v1/books/jobs/ {
        proxy_pass http://greenthumb_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

### Option B — API-only nginx config (frontend served directly by nginx)

If you want nginx to serve the frontend static files directly (better performance, no Node.js frontend service needed):

```nginx
server {
    listen 80;
    server_name greenthumb.dnd-dad.com;
    root /home/cody/green-thumb/admin;
    index index.html;

    # Frontend static files
    location / {
        try_files $uri $uri/ =404;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:4041;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # Swagger UI
    location /docs {
        proxy_pass http://127.0.0.1:4041;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~ ^/docs/(json|yaml)$ {
        proxy_pass http://127.0.0.1:4041;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /docs/static {
        proxy_pass http://127.0.0.1:4041;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Enable and reload

```bash
sudo cp /etc/nginx/sites-available/greenthumb.conf /etc/nginx/sites-available/greenthumb.conf.bak
sudo ln -sf /etc/nginx/sites-available/greenthumb.conf /etc/nginx/sites-enabled/greenthumb.conf
sudo nginx -t
sudo systemctl reload nginx
```

---

## 3. Cloudflare Setup

In the Cloudflare dashboard for `greenthumb.dnd-dad.com`:

### DNS Records
| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `greenthumb` | `YOUR_PUBLIC_IP` | 🟡 Proxied |
| A | `www` | `YOUR_PUBLIC_IP` | 🟡 Proxied |

To find your public IP:
```bash
curl -s https://ifconfig.me
```

### SSL/TLS Settings
Set to **"Full"** or **"Full (strict)"** if you have a valid certificate:
- **Full** (Cloudflare-issued or self-signed) — most flexible
- **Full (strict)** — requires a valid CA certificate on your origin server

### Getting a valid certificate for "Full (strict)"

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d greenthumb.dnd-dad.com
```

Certbot will automatically update your nginx config with TLS certificates from Let's Encrypt.

### SSL/TLS → Edge Certificates
- Enable **"Always Use HTTPS"** → Force redirect HTTP → HTTPS
- Enable **"Minimum TLS Version"** → TLS 1.2
- Enable **"Opportunratic Encryption"** (optional)

---

## 4. Router — Port Forwarding

Forward external ports to your server:

| Service | External Port | Internal IP | Internal Port |
|---------|-------------|-------------|---------------|
| HTTP | 80 | `192.168.0.102` | 80 |
| HTTPS | 443 | `192.168.0.102` | 443 |

> After setting up port forwarding, verify from a mobile network (not on LAN) that `https://greenthumb.dnd-dad.com` resolves correctly.

---

## 5. Split-Horizon DNS (LAN Access)

Devices on your home network need `greenthumb.dnd-dad.com` to resolve to `192.168.0.102`, not the public IP.

### Option A — Pi-hole (recommended if you run one)
Add a local DNS override:
```
greenthumb.dnd-dad.com = 192.168.0.102
```

### Option B — Router DNS override
Most routers support "Static DNS" or "Local Domain Overrides". Set:
```
greenthumb.dnd-dad.com → 192.168.0.102
```

### Option C — /etc/hosts on each device
On each device that needs LAN access:
```
192.168.0.102  greenthumb.dnd-dad.com
```

---

## 6. Verify Everything

```bash
# Local health checks
curl http://localhost:4041/api/v1/health
curl http://localhost:4042
curl http://localhost:4041/docs

# From LAN (if DNS is set up)
curl http://greenthumb.dnd-dad.com/api/v1/health
curl http://greenthumb.dnd-dad.com

# From outside (must have port forwarding + Cloudflare DNS set up)
curl https://greenthumb.dnd-dad.com/api/v1/health
curl https://greenthumb.dnd-dad.com/docs
```

---

## Managing Services

```bash
# View logs
sudo journalctl -u green-thumb-api   -f
sudo journalctl -u green-thumb-frontend -f

# Restart after code updates
sudo systemctl restart green-thumb-api green-thumb-frontend

# Stop / start
sudo systemctl stop    green-thumb-api green-thumb-frontend
sudo systemctl start   green-thumb-api green-thumb-frontend

# Check which ports are listening
ss -tlnp | grep -E '4041|4042|80|443'
```

---

## Quick Reference — URLs

| Service | LAN URL | Public URL |
|---------|---------|------------|
| Frontend | `http://192.168.0.102:4042` | `https://greenthumb.dnd-dad.com` |
| API | `http://192.168.0.102:4041` | `https://greenthumb.dnd-dad.com/api/v1` |
| Swagger UI | `http://192.168.0.102:4041/docs` | `https://greenthumb.dnd-dad.com/docs` |
| OpenAPI JSON | `http://192.168.0.102:4041/docs/json` | `https://greenthumb.dnd-dad.com/docs/json` |
