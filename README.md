# WebOS - Remote Browser & Privacy Suite

A comprehensive web-based operating system with remote browser control, Tor integration, virtual camera injection, and security tools.

**Made by Sudais Alam**

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/sudaisalamboy/WebOS.git
cd WebOS

# Install dependencies
npm install
pip3 install websockify

# Start all services
./scripts/start-all.sh

# Access the application
# Web Desktop: http://localhost:3000
# Remote Chrome: http://localhost:6080/vnc.html
```

## 🚀 Features

### Remote Chrome (VNC Browser)
- **Full browser control via web interface** using Xvfb + x11vnc + websockify
- Chrome DevTools Protocol (CDP) integration on port 9222
- noVNC web client for browser viewing
- Supports audio, video, and camera injection
- Anti-detection features (custom user-agent, automation flags disabled)

### Tor Integration
- **Anonymous browsing** through Tor SOCKS5 proxy (port 9050)
- Tor proxy API at `/api/tor/proxy` for routing traffic through Tor
- HTML/CSS/JS URL rewriting to keep all traffic inside the proxy
- Ad and tracker blocking at proxy level
- New identity generation for circuit rotation
- Tor status monitoring and restart capabilities

### OnionShare (Tor File Sharing)
- **Secure file sharing** over Tor hidden services
- Three modes: Share files, Receive files, Host website
- Public mode (no private key required) for easier access
- Real-time share status monitoring
- Automatic .onion URL generation
- Per-share isolated configuration to prevent conflicts

### Virtual Camera Injection
- **Chrome extension** that injects virtual camera on every page
- Supports test patterns, video files, and image sources
- Automatic re-injection watchdog (survives page navigations)
- CDP-based camera control API
- Permission management for camera/microphone access
- Configurable camera sources via web UI

### Security Lab Tools
- **Port scanner** - Open port detection
- **SSL/TLS analyzer** - Certificate inspection
- **HTTP headers analyzer** - Security header review
- DNS lookup tools
- WHOIS information gathering

### Desktop Environment
- **WebOS desktop interface** with window management
- File explorer with upload/download capabilities
- Terminal emulator with command execution
- Encrypted notes application
- Screenshot capture tool
- Text editor
- VPS dashboard for system monitoring

## 📁 Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/              # API endpoints
│   │   │   ├── auth/         # Authentication
│   │   │   ├── camera-inject/# Camera injection API
│   │   │   ├── onionshare/   # OnionShare file sharing
│   │   │   ├── tor/          # Tor proxy & control
│   │   │   ├── vnc/          # Remote Chrome control
│   │   │   ├── seclab/       # Security tools
│   │   │   └── fs/           # File system operations
│   │   └── page.tsx          # Main desktop page
│   ├── components/
│   │   ├── apps/             # Desktop applications
│   │   ├── desktop/          # Desktop UI components
│   │   └── ui/               # Reusable UI components
│   └── lib/                  # Utilities and stores
├── tools/
│   ├── camera-extension/     # Chrome camera injection extension
│   │   ├── manifest.json
│   │   ├── background.js
│   │   ├── camera-inject.js
│   │   └── camera-main.js
│   └── (additional tools directories)
├── scripts/
│   ├── start-all.sh          # Start all services
│   ├── start-tor.sh          # Tor daemon manager
│   ├── start-vnc-chrome.sh   # VNC Chrome session manager
│   ├── camera-watchdog.py    # Camera injection watchdog
│   └── x11vnc-watchdog.py    # VNC watchdog
├── public/                   # Static assets
└── package.json              # Dependencies
```

## 🛠️ Installation & Setup

### System Requirements

**Minimum Requirements:**
- CPU: 2+ cores
- RAM: 4GB+ (8GB recommended)
- Disk: 10GB+ free space
- OS: Linux (Ubuntu 20.04+, Debian 11+, Arch) - **Linux required for Xvfb/Tor**

**Software Dependencies:**
- Node.js 18+ and npm or bun
- Python 3.8+ with pip
- Tor daemon (0.4.x+)
- Xvfb (X virtual framebuffer)
- x11vnc
- Chrome/Chromium browser (122+)
- websockify (Python package)

### Step-by-Step Setup (Linux/Ubuntu)

#### 1. Install System Dependencies

**Ubuntu/Debian:**
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y xvfb x11vnc tor python3 python3-pip
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
sudo sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list'
sudo apt update && sudo apt install -y google-chrome-stable
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

**Arch Linux:**
```bash
sudo pacman -S xvfb x11vnc tor python python-pip nodejs npm google-chrome
```

#### 2. Clone and Setup Project

```bash
git clone https://github.com/sudaisalamboy/WebOS.git
cd WebOS
npm install
pip3 install websockify socks-proxy-agent
```

#### 3. Configure Tor

```bash
sudo systemctl enable tor
sudo systemctl start tor
```

#### 4. Setup Project Paths

```bash
# Update scripts with your Chrome path
which google-chrome-stable
sed -i 's|/home/z/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome|/usr/bin/google-chrome-stable|g' scripts/start-vnc-chrome.sh
sed -i 's|/home/z/my-project|'$(pwd)'|g' scripts/*.sh scripts/*.py
```

#### 5. Create Required Directories

```bash
mkdir -p ~/.vnc-pids ~/.vnc-logs ~/my-project/user-files ~/my-project/tor/data ~/my-project/tor/log
chmod 700 ~/my-project/tor/data
```

#### 6. Start Services

```bash
./scripts/start-all.sh
```

#### 7. Access the Application

- **Web Desktop**: http://localhost:3000
- **Remote Chrome**: http://localhost:6080/vnc.html

#### 8. Set Password

First time visit http://localhost:3000 and set your password.

## 🚀 Usage

### Starting All Services

```bash
./scripts/start-all.sh
```

### Individual Service Control

**Tor**
```bash
./scripts/start-tor.sh start|stop|restart|status
```

**VNC Chrome**
```bash
./scripts/start-vnc-chrome.sh start|stop|restart|status
```

**Next.js**
```bash
npm run dev    # Start on port 3000
npm run build  # Build for production
npm run start  # Start production server
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/login` - Login with password
- `GET /api/auth/check` - Check authentication status
- `POST /api/auth/logout` - Logout

### Tor Proxy
- `GET /api/tor/proxy?url=<url>` - Fetch URL through Tor
- `POST /api/tor/newid` - Get new Tor identity
- `GET /api/tor/status` - Check Tor status
- `POST /api/tor/restart` - Restart Tor daemon

### OnionShare
- `POST /api/onionshare/create` - Create new share
- `GET /api/onionshare/list?id=<id>` - List shares
- `POST /api/onionshare/stop?id=<id>` - Stop share
- `GET /api/onionshare/download?id=<id>` - Download shared files

### Camera Injection
- `POST /api/camera-inject` - Inject virtual camera
- `GET /api/camera-inject` - Get camera status
- `POST /api/camera-inject/upload` - Upload camera source

### Remote Chrome (VNC)
- `POST /api/vnc/start` - Start VNC session
- `POST /api/vnc/stop` - Stop VNC session
- `GET /api/vnc/status` - Check VNC status
- `POST /api/vnc/navigate` - Navigate to URL
- `GET /api/vnc/screenshot` - Capture screenshot
- `POST /api/vnc/control` - Send mouse/keyboard events

### Security Lab
- `GET /api/seclab/ports?host=<host>` - Scan ports
- `GET /api/seclab/ssl?host=<host>` - Check SSL/TLS
- `GET /api/seclab/headers?url=<url>` - Analyze headers

### File System
- `GET /api/fs/list?path=<path>` - List directory
- `POST /api/fs/upload` - Upload file
- `GET /api/fs/download?path=<path>` - Download file
- `DELETE /api/fs/delete?path=<path>` - Delete file

## 🔐 Security Features

- **Authentication required** for all API endpoints
- **File sandboxing** - File operations restricted to user-files directory
- **Ad/tracker blocking** - Blocks known ad and tracking domains
- **Tor anonymity** - All Tor traffic routed through SOCKS5 proxy
- **URL rewriting** - Prevents leakage through direct links
- **Certificate validation bypass** - For Tor compatibility (configurable)

## 🌐 Access Points

- **Web Desktop**: http://localhost:3000
- **noVNC (Remote Chrome)**: http://localhost:6080/vnc.html
- **Chrome CDP**: localhost:9222
- **Tor SOCKS Proxy**: localhost:9050
- **VNC Server**: localhost:5900

## 🐛 Troubleshooting

### Tor not connecting
- Check Tor status: `./scripts/start-tor.sh status`
- View logs: `~/my-project/tor/tor-stdout.log`
- Restart Tor: `./scripts/start-tor.sh restart`

### VNC session not starting
- Check Xvfb: `pgrep Xvfb`
- Check Chrome CDP: `ss -tln | grep 9222`
- View logs: `~/.vnc-logs/`

### Camera injection not working
- Check extension loaded in Chrome
- Check watchdog: `pgrep -f camera-watchdog`
- Verify config: `~/my-project/.camera-config.json`

### Next.js not starting
- Check port 3000: `ss -tln | grep 3000`
- Install dependencies: `npm install`
- View logs: `dev.log`

## 📄 License

See [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions welcome! Please read the license terms before contributing.

## ⚠️ Disclaimer

This tool is for educational and legitimate privacy purposes only. Users are responsible for ensuring compliance with applicable laws and regulations. The authors are not responsible for misuse of this software.

## 🙏 Acknowledgments

- Next.js - React framework
- shadcn/ui - UI components
- Tor Project - Anonymous networking
- OnionShare - Secure file sharing
- noVNC - VNC web client
- Playwright/Puppeteer - Browser automation

---

**Made by Sudais Alam**
