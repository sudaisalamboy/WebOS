# WebOS - Remote Browser & Privacy Suite

A comprehensive web-based operating system with remote browser control, Tor integration, virtual camera injection, and security tools.

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
# Update system
sudo apt update && sudo apt upgrade -y

# Install X11 and VNC dependencies
sudo apt install -y xvfb x11vnc

# Install Tor
sudo apt install -y tor

# Install Chrome (or use Chromium)
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
sudo sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list'
sudo apt update
sudo apt install -y google-chrome-stable

# Or use Chromium instead
# sudo apt install -y chromium-browser

# Install Python and pip
sudo apt install -y python3 python3-pip

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

**Arch Linux:**
```bash
sudo pacman -S xvfb x11vnc tor python python-pip nodejs npm google-chrome
```

#### 2. Clone and Setup Project

```bash
# Clone the repository (or extract the archive)
cd /path/to/your/workspace
# If from git: git clone <repository-url>
cd webos  # or your project directory

# Install Node.js dependencies
npm install

# Install Python dependencies
pip3 install websockify

# Install additional Python packages if needed
pip3 install socks-proxy-agent
```

#### 3. Configure Tor

**Create Tor configuration directory:**
```bash
sudo mkdir -p /etc/tor
sudo chown $USER:$USER /etc/tor
```

**Create/Edit Tor config file (`/etc/tor/torrc` or project-specific):**
```bash
# If using project-specific config
mkdir -p ~/my-project/tor/config
cat > ~/my-project/tor/config/torrc << 'EOF'
SOCKSPort 9050
ControlPort 9051
DataDirectory ~/my-project/tor/data
Log notice file ~/my-project/tor/log/notice.log
EOF
```

**Or use system Tor:**
```bash
sudo systemctl enable tor
sudo systemctl start tor
```

#### 4. Setup Project Paths

**Update scripts with your actual paths:**
```bash
# Edit scripts to match your installation paths
# Default paths in scripts (update as needed):
# - Project root: /home/z/my-project
# - Tor binary: /home/z/my-project/tor/bin/tor
# - Chrome: ~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome
# - Xvfb: /usr/bin/Xvfb
# - x11vnc: /home/z/my-project/tools/x11vnc/bin/x11vnc

# Find your Chrome path
which google-chrome-stable
# or
which chromium-browser

# Update scripts/start-vnc-chrome.sh with your Chrome path
sed -i 's|/home/z/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome|/usr/bin/google-chrome-stable|g' scripts/start-vnc-chrome.sh
sed -i 's|/home/z/my-project|/your/actual/path|g' scripts/*.sh scripts/*.py
```

#### 5. Setup Camera Extension

The camera extension is located in `tools/camera-extension/`. It will be automatically loaded by Chrome when using the startup scripts.

**Manual installation (for testing):**
1. Open Chrome
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `tools/camera-extension` directory

#### 6. Create Required Directories

```bash
# Create PID and log directories
mkdir -p ~/.vnc-pids ~/.vnc-logs

# Create user files directory
mkdir -p ~/my-project/user-files

# Create Tor directories
mkdir -p ~/my-project/tor/data ~/my-project/tor/log
chmod 700 ~/my-project/tor/data
```

#### 7. Configure Environment Variables (Optional)

Create `.env` file in project root:
```bash
NODE_ENV=development
# Add any other environment-specific variables
```

#### 8. Initialize Database (if using Prisma)

```bash
# Generate Prisma client
npm run db:generate

# Push database schema
npm run db:push
```

#### 9. Verify Installation

**Test individual components:**

```bash
# Test Tor
curl --socks5 127.0.0.1:9050 https://check.torproject.org

# Test Xvfb
Xvfb :99 -screen 0 1280x800x24 &
# Check it's running
ps aux | grep Xvfb

# Test Chrome
google-chrome-stable --version

# Test Node.js
node --version
npm --version

# Test Python
python3 --version
pip3 --version
```

#### 10. Start Services

**Option A: Start all services at once**
```bash
./scripts/start-all.sh
```

**Option B: Start services individually**
```bash
# Start Tor
./scripts/start-tor.sh start

# Start VNC Chrome session
./scripts/start-vnc-chrome.sh start

# Start Next.js dev server
npm run dev
```

#### 11. Access the Application

Open your browser and navigate to:
- **Web Desktop**: http://localhost:3000
- **noVNC (Remote Chrome)**: http://localhost:6080/vnc.html

Default login credentials (check `.env` or auth configuration for actual values).

### Setup for Different Environments

#### Docker Setup (Optional)

If you prefer containerized setup:

```dockerfile
# Example Dockerfile
FROM ubuntu:22.04

# Install dependencies
RUN apt update && apt install -y \
    xvfb x11vnc tor \
    python3 python3-pip \
    curl gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Chrome
RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list && \
    apt update && apt install -y google-chrome-stable

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt install -y nodejs

# Install Python packages
RUN pip3 install websockify

# Copy project
COPY . /app
WORKDIR /app

# Install Node dependencies
RUN npm install

# Expose ports
EXPOSE 3000 6080 9050 9222

# Start script
CMD ["./scripts/start-all.sh"]
```

#### Windows Setup (Limited Support)

**Note:** Full functionality requires Linux for Xvfb and Tor. Windows users can:
- Use WSL2 (Windows Subsystem for Linux)
- Use a remote Linux server
- Run only the Next.js frontend on Windows

**WSL2 Setup:**
```powershell
# Install WSL2
wsl --install

# In WSL2 Ubuntu:
sudo apt update && sudo apt upgrade -y
sudo apt install -y xvfb x11vnc tor python3 python3-pip nodejs npm
```

Then follow the Linux setup steps above.

### Post-Setup Configuration

#### Set Up Password (First Time)

**IMPORTANT:** The application requires a password to be set before first use. This is done through the web interface:

1. Start the Next.js server: `npm run dev`
2. Open http://localhost:3000 in your browser
3. You will see the login screen - click "Setup" or "First-time setup"
4. Enter your desired password (minimum 4 characters)
5. Click "Set Password"

**Or via API:**
```bash
curl -X POST http://localhost:3000/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"password":"your_secure_password"}'
```

**Password Security:**
- Passwords are hashed using bcrypt (10 rounds) - one-way hash, cannot be decrypted
- Hash is stored in `/home/z/my-project/.auth/password.hash` (outside user-files sandbox)
- Server secret for session signing is in `/home/z/my-project/.auth/server.secret`
- Both files have mode 600 (owner read/write only)
- Rate limiting: 10 failed attempts per minute, then 5-minute lockout
- Session tokens expire after 24 hours

#### Change Password

To change your password after initial setup:

**Via Web Interface:**
1. Log in with your current password
2. Go to Settings or use the change password option
3. Enter current password and new password

**Or via API:**
```bash
curl -X POST http://localhost:3000/api/auth/change \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"old_password","newPassword":"new_password"}'
```

**Note:** Changing the password invalidates all existing sessions (you'll need to log in again).

#### Reset Password (If Forgotten)

If you forget your password, you'll need to manually reset it:

```bash
# Remove the password hash file
rm /home/z/my-project/.auth/password.hash

# Then go through first-time setup again
# Visit http://localhost:3000 and set a new password
```

**Warning:** This will also invalidate all encrypted notes/data that was encrypted with the old password.

#### Configure File Upload Limits

Edit Next.js config (`next.config.ts`) if needed for large file uploads.

#### Customize Desktop

Edit `src/components/desktop/` to customize the desktop environment, wallpapers, and default applications.

### Verification Checklist

After setup, verify:
- [ ] Tor is running and accessible on port 9050
- [ ] Xvfb is running on display :99
- [ ] Chrome is running with CDP on port 9222
- [ ] x11vnc is running on port 5900
- [ ] websockify is running on port 6080
- [ ] Next.js is running on port 3000
- [ ] Can access web desktop at http://localhost:3000
- [ ] Can access noVNC at http://localhost:6080/vnc.html
- [ ] Camera extension is loaded in Chrome
- [ ] Tor proxy can fetch websites through `/api/tor/proxy`

## 🚀 Usage

### Starting All Services

```bash
./scripts/start-all.sh
```

This starts:
- Tor daemon
- Xvfb (virtual display)
- x11vnc (VNC server)
- websockify (WebSocket to VNC bridge)
- Chrome with camera extension
- Next.js web application

### Individual Service Control

**Tor**
```bash
./scripts/start-tor.sh start    # Start Tor
./scripts/start-tor.sh stop     # Stop Tor
./scripts/start-tor.sh restart  # Restart Tor
./scripts/start-tor.sh status   # Check status
```

**VNC Chrome**
```bash
./scripts/start-vnc-chrome.sh start    # Start VNC Chrome session
./scripts/start-vnc-chrome.sh stop     # Stop session
./scripts/start-vnc-chrome.sh restart  # Restart session
./scripts/start-vnc-chrome.sh status   # Check status
```

**Next.js Dev Server**
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

## 📝 Configuration

### Environment Variables
- `NODE_ENV` - Production/development mode
- Database configuration in Prisma schema

### Tor Configuration
Edit `tor/config/torrc`:
```
SOCKSPort 9050
ControlPort 9051
DataDirectory /path/to/tor/data
```

### Chrome Flags
Configured in `scripts/start-vnc-chrome.sh`:
- `--no-sandbox` - Required for headless mode
- `--remote-debugging-port=9222` - CDP access
- `--load-extension` - Camera extension
- `--use-fake-ui-for-media-stream` - Camera injection

## 🐛 Troubleshooting

### Tor not connecting
- Check Tor status: `./scripts/start-tor.sh status`
- View logs: `/home/z/my-project/tor/tor-stdout.log`
- Restart Tor: `./scripts/start-tor.sh restart`

### VNC session not starting
- Check Xvfb is running: `pgrep Xvfb`
- Check Chrome CDP port: `ss -tln | grep 9222`
- View logs: `/home/z/my-project/.vnc-logs/`

### Camera injection not working
- Check extension is loaded in Chrome
- Check watchdog is running: `pgrep -f camera-watchdog`
- Verify camera config: `/home/z/my-project/.camera-config.json`

### Next.js not starting
- Check port 3000 is available: `ss -tln | grep 3000`
- Check dependencies: `npm install`
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
