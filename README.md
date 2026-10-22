<div align="center">

# 🖥️ WebOS

[![CI Pipeline](https://github.com/sudaisalamboy/WebOS/workflows/CI%20Pipeline/badge.svg)](https://github.com/sudaisalamboy/WebOS/actions)
[![Next.js](https://img.shields.io/badge/Next.js%2016-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React%2019-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-000000?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](./LICENSE)

A web-based desktop environment with remote browser control, AI assistant, terminal, file explorer, and security tools. Built with Next.js 16, React 19, TypeScript, and Bun.

</div>

---

## 📸 Preview

<table>
  <tr>
    <td width="50%" align="center"><b>Start Menu + AI Assistant</b></td>
    <td width="50%" align="center"><b>Camera Inject + File Explorer + Terminal</b></td>
  </tr>
  <tr>
    <td><img src="preview/Screenshot_20261022_224155.png" alt="WebOS — Start Menu + AI Assistant" /></td>
    <td><img src="preview/Screenshot_20261022_225514.png" alt="WebOS — Camera Inject + File Explorer + Terminal" /></td>
  </tr>
  <tr>
    <td width="100%" colspan="2" align="center"><b>Overview</b></td>
  </tr>
  <tr>
    <td width="100%" colspan="2"><img src="preview/preview.png" alt="WebOS Preview" /></td>
  </tr>
</table>

> 📖 **Full setup instructions:** see [SETUP.md](SETUP.md) for detailed installation, configuration, and deployment guide.

---

## 📋 Overview

WebOS transforms your browser into a desktop environment with 10+ integrated applications. From AI-powered browser automation to security reconnaissance tools, WebOS provides a complete desktop experience entirely in the browser with session-based authentication and real-time features.

---

## ✨ Key Features

### 🔒 Security
- **Session-based authentication** with NextAuth.js (no client-side secrets)
- **Input validation and sanitization** across all APIs
- **Prisma ORM** with parameterized queries preventing SQL injection
- **Virtual camera injection** for privacy protection
- **Server-side operations** — sensitive data never exposed to client

### ⚡ Performance
- **Next.js 16** with React 19 for optimal rendering
- **Bun runtime** for fast package management
- **Standalone output** for minimal production bundle
- **Code splitting** and lazy loading for fast app launches
- **WebSocket connections** for real-time communication
- **CDP (Chrome DevTools Protocol)** for efficient browser control
- **In-memory caching** for frequently accessed data
- **Server-Sent Events (SSE)** for streaming AI responses

---

## 📱 Applications

### 1. 🤖 AI Browser Assistant
An intelligent AI agent that can see and control your browser through vision and natural language commands.

**Features:**
- **Vision-based automation** — AI sees screenshots and understands page layout
- **Natural language control** — Tell the AI what to do in plain English
- **Real-time action execution** — Click, type, scroll, navigate, run JavaScript
- **Step-by-step transparency** — See every action the AI takes
- **Screenshot history** — Review screenshots taken during automation
- **Chat ID rotation** — Rotates API chat IDs for rate limit management
- **Decision caching** — Reuses decisions for identical page states
- **Multi-tab management** — Open, close, and switch between tabs
- **Video control** — Play, pause, and interact with media
- **Error recovery** — Automatic retry on failures

### 2. 🌐 Remote Browser
Full Brave browser running on a virtual display, accessible via noVNC.

**Features:**
- **Real Brave browser** — Full browser with CDP support
- **noVNC integration** — Browser-based VNC client
- **Browser automation** — CDP-based control for AI assistant
- **Virtual camera support** — Inject custom video feeds
- **Clipboard sync** — Paste from local to remote browser
- **Quick navigation** — URL bar with history
- **Browser controls** — Back, forward, refresh, scroll
- **Live camera status** — Real-time FPS and injection status
- **1280x720 resolution** — Optimized virtual display
- **Component monitoring** — Xvfb, Brave, x11vnc, websockify status

### 3. 💻 Terminal
Real terminal with PTY support — not a simulation.

**Features:**
- **Real bash shell** — Full PTY with proper signal handling
- **Command history** — Up/down arrow to browse previous commands
- **Tab completion** — Auto-complete file paths and commands
- **vim / nano support** — Full terminal editors work
- **Pipe support** — Chain commands with `|`, `>`, `<`
- **Multi-session** — Open multiple terminal tabs

### 4. 📁 File Explorer
Complete file management system with sandboxed storage.

**Features:**
- **Sandboxed storage** — Files stored safely in `user-files/`
- **Standard folders** — Desktop, Documents, Pictures, Downloads, Music
- **Upload/Download** — Drag-and-drop + chunked upload support
- **Folder creation** — Create nested directories
- **File preview** — View images, text, code files inline
- **Delete/Rename** — Full file operations

### 5. 📝 Notes
Persistent note-taking app with auto-save.

**Features:**
- **Auto-save** — Changes saved automatically to SQLite
- **Markdown support** — Write notes in Markdown
- **Persistent storage** — Notes survive page reloads

### 6. 📷 Camera Inject
Virtual camera injection for privacy protection.

**Features:**
- **Test pattern** — Built-in color bar test pattern
- **Custom video** — Inject your own video feed
- **Camera preview** — See what's being injected
- **Zoom & crop** — Adjust the injected feed

### 7. 🔍 Browser Debugger
CDP-based browser debugging tool.

**Features:**
- **Tab management** — List, switch, close tabs
- **Console output** — View browser console logs
- **Screenshot capture** — Take screenshots of any tab
- **Network monitoring** — View network requests

### 8. 📊 VPS Dashboard
Server monitoring dashboard.

**Features:**
- **CPU usage** — Real-time CPU monitoring
- **Memory usage** — RAM consumption tracking
- **Disk usage** — Storage space monitoring
- **Network stats** — Upload/download speeds
- **Process list** — Running processes

### 9. 🛡️ Security Lab
Security reconnaissance tools.

**Features:**
- **OSINT guide** — Open-source intelligence resources
- **Tech detection** — Identify technologies used by websites
- **Security references** — OWASP, CVE databases, tools

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | Next.js 16, React 19 |
| **Language** | TypeScript 5 |
| **Runtime** | Bun |
| **Database** | SQLite (Prisma ORM) |
| **Auth** | NextAuth.js |
| **Styling** | Tailwind CSS 4, shadcn/ui |
| **Real-time** | WebSocket, Socket.io |
| **Browser Control** | CDP (Chrome DevTools Protocol) |
| **VNC** | Xvfb, x11vnc, websockify, noVNC |
| **AI** | z-ai-web-dev-sdk (VLM + LLM) |

---

## 🚀 Quick Start

```bash
git clone https://github.com/sudaisalamboy/WebOS.git
cd WebOS
bun install
bun run db:push
bun run dev
```

Open `http://localhost:3000` in your browser.

> 📖 See [SETUP.md](SETUP.md) for full setup instructions including VNC stack, PTY service, and environment variables.

---

## 📁 Project Structure

```
WebOS/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API routes (auth, fs, vnc, assistant)
│   │   ├── page.tsx            # Main desktop page
│   │   └── layout.tsx          # Root layout
│   ├── components/             # React components
│   │   ├── desktop/            # Desktop, taskbar, window manager
│   │   ├── apps/               # Individual app components
│   │   └── ui/                 # shadcn/ui components
│   └── lib/                    # Utilities (db, auth, fs-server)
├── prisma/                     # Database schema
├── scripts/                    # Startup + watcher scripts
├── tools/                      # x11vnc + noVNC binaries
├── SETUP.md                    # Full setup guide
└── package.json
```

---

## 🤝 Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## 📄 License

**MIT** © [Sudais Alam](https://github.com/sudaisalamboy)

---

<div align="center">

**Made with ♥ by [Sudais Alam](https://github.com/sudaisalamboy)**

[![GitHub](https://img.shields.io/badge/GitHub-sudaisalamboy-181717?style=for-the-badge&logo=github)](https://github.com/sudaisalamboy)
[![Email](https://img.shields.io/badge/Email-sudaisalam18@gmail.com-EA4335?style=for-the-badge&logo=gmail)](mailto:sudaisalam18@gmail.com)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-+91%209117509707-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://wa.me/919117509707)

</div>
