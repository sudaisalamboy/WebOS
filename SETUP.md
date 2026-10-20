# WebOS — Setup Guide

A comprehensive, secure, and high-performance web-based operating system featuring remote browser control, virtual camera injection, terminal access, security tools, and advanced file management — all running in the browser. Built with Next.js 16, React 19, Bun, and 18+ integrated applications.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Build for Production](#build-for-production)
- [Deployment Options](#deployment-options)
- [Project Structure](#project-structure)
- [Mini-Services](#mini-services)
- [Troubleshooting](#troubleshooting)

---

## Project Overview

WebOS transforms your browser into a full-featured operating system with 18+ integrated applications. From AI-powered browser automation to security reconnaissance tools, WebOS provides a complete desktop experience entirely in the browser. It features end-to-end encryption for sensitive data, secure session management via NextAuth.js, a real terminal with PTY support, remote Chromium browser control via noVNC, virtual camera injection, and a complete security lab — all built with enterprise-grade security and performance.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 22+ | JavaScript runtime |
| **Bun** | 1.3+ | Package manager & preferred runtime |
| **Database** | — | PostgreSQL, MySQL, or SQLite (SQLite default) |
| **Xvfb** | any | Virtual display for Remote Browser feature |
| **Chrome / Chromium** | 120+ | For Remote Browser (noVNC) feature |
| **Git** | 2.20+ | Cloning the repository |

Install Bun:

```bash
curl -fsSL https://bun.sh/install | bash
bun --version
```

For the **Remote Browser** feature on Linux, install Xvfb and Chrome:

```bash
sudo apt update
sudo apt install -y xvfb chromium-browser x11vnc
```

> The Remote Browser, Camera Inject, and Terminal apps require these system dependencies. All other apps work with just Bun + the database.

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/sudaisalamboy/WebOS.git
cd WebOS
```

### 2. Install dependencies

```bash
bun install
```

### 3. Configure environment variables

```bash
cp .env.example .env   # if .env.example exists, otherwise create manually
```

Edit `.env` (see [Environment Variables](#environment-variables) below).

### 4. Generate Prisma client & push the schema

```bash
bun run db:generate   # generate the Prisma client
bun run db:push       # create / sync the database schema
```

### 5. (Optional) Start the PTY mini-service

The Terminal app uses a separate WebSocket PTY service:

```bash
cd mini-services/pty-service
bun install
bun run index.ts   # or ./start.sh
```

---

## Environment Variables

```env
# Database (SQLite default; switch provider in prisma/schema.prisma for Postgres/MySQL)
DATABASE_URL="file:./db/custom.db"

# NextAuth.js
NEXTAUTH_SECRET="your-nextauth-secret"      # generate: openssl rand -hex 32
NEXTAUTH_URL="http://localhost:3000"

# Optional — AI assistant (uses z-ai-web-dev-sdk)
# ZAI_API_KEY="..."
```

> **Production:** `NEXTAUTH_SECRET` is mandatory. Generate a strong secret with `openssl rand -hex 32`.

---

## Running Locally

```bash
bun run dev
```

The app is available at **http://localhost:3000**. Dev logs are written to `dev.log`.

On first launch, the app shows a login / setup screen. Create your admin account (the auth setup endpoint only works on an empty database).

Other scripts:

```bash
bun run lint         # ESLint
bunx tsc --noEmit    # TypeScript type-check
bunx playwright test  # E2E tests
```

---

## Build for Production

WebOS uses Next.js **standalone output** for a minimal production bundle:

```bash
bun run build        # builds + copies .next/static and public/ into standalone dir
bun run start        # runs the standalone server
```

The production server runs from `.next/standalone/server.js` on the port set by `PORT` (default `3000`).

---

## Deployment Options

### Option A — Self-hosted VM (recommended)

WebOS is designed for a persistent long-lived server (filesystem, PTY, Xvfb, and noVNC all require a stable host).

```bash
bun install
bun run db:generate
bun run db:push
bun run build
bun run start
```

Run behind **Caddy** (a `Caddyfile` is included) for automatic TLS:

```bash
caddy run --config Caddyfile
```

### Option B — Docker

```dockerfile
FROM oven/bun:1 AS base
RUN apt-get update && apt-get install -y xvfb chromium x11vnc python3
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run db:generate && bun run build
EXPOSE 3000
CMD ["bun", "run", "start"]
```

Persist `db/`, `user-files/`, and `storage/` via volume mounts.

### Option C — Vercel (partial)

The core Next.js app deploys to Vercel, but **filesystem-dependent features** (Remote Browser, Terminal PTY, Camera Inject, File Explorer writes) will **not** work on serverless. Use Vercel only for the UI/security-lab subset; deploy the full stack on a VM for all features.

---

## Project Structure

```
WebOS/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── assistant/      # AI browser-automation endpoints
│   │   │   ├── vnc/            # Remote browser (noVNC) control
│   │   │   ├── camera-inject/  # Virtual camera injection
│   │   │   ├── seclab/         # Security lab (headers, SSL, DNS, nmap…)
│   │   │   ├── fs/             # Filesystem CRUD
│   │   │   ├── enc/            # Encrypted notes
│   │   │   ├── tor/            # Tor suite
│   │   │   ├── onionshare/     # OnionShare integration
│   │   │   ├── auth/           # NextAuth setup/login/logout
│   │   │   ├── screenshot/     # Screenshot capture
│   │   │   └── notes/          # Notes
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── apps/               # 18+ application components
│   │   ├── desktop/            # Desktop shell, taskbar, window manager
│   │   ├── ui/                 # shadcn/ui library
│   │   └── vps/                # VPS dashboard widgets
│   └── lib/                    # auth, fs-server, chrome-cdp, live-browser…
├── prisma/schema.prisma
├── mini-services/pty-service/  # WebSocket PTY for Terminal app
├── tools/novnc/                # noVNC client (vendored)
├── tools/x11vnc/               # x11vnc binaries
├── user-files/                 # persistent user files
├── Caddyfile
└── package.json
```

---

## Mini-Services

| Service | Path | Purpose |
|---------|------|---------|
| PTY Service | `mini-services/pty-service/` | WebSocket pseudo-terminal for the Terminal app |

Start it independently:

```bash
cd mini-services/pty-service
bun install && bun run index.ts
```

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| `EADDRINUSE :3000` | Port already in use | `PORT=3001 bun run dev` or kill the process |
| Prisma `Database is locked` | Concurrent SQLite writes | Switch to PostgreSQL, or ensure single writer |
| Remote Browser shows black screen | Xvfb / Chrome not installed | `sudo apt install xvfb chromium-browser x11vnc` |
| Terminal doesn't connect | PTY mini-service not running | Start `mini-services/pty-service` |
| `NEXTAUTH_SECRET` error in prod | Missing secret | Set `NEXTAUTH_SECRET` in `.env` |
| noVNC connection refused | x11vnc / websockify not started | The app auto-starts them; check `.vnc-pids/` |
| `prisma generate` fails | Schema or client mismatch | `bun run db:generate` after `bun install` |
| Camera Inject no video | No media files uploaded | Upload a video/image in the Camera Inject app |
| Build OOM | Large dependency tree | Increase Node memory: `NODE_OPTIONS=--max-old-space-size=4096 bun run build` |
| Tor features 503 | Tor not installed / not running | Install tor and ensure it's running on the control port |

---

Made by **Sudais Alam** · [GitHub @sudaisalamboy](https://github.com/sudaisalamboy)
