# WebOS

[![CI Pipeline](https://github.com/sudaisalamboy/WebOS/workflows/CI%20Pipeline/badge.svg)](https://github.com/sudaisalamboy/WebOS/actions)

A comprehensive, secure, and high-performance web-based operating system featuring remote browser control, virtual camera injection, terminal access, security tools, and advanced file management. Built with cutting-edge web technologies for maximum speed and security.

## Overview

WebOS transforms your browser into a full-featured operating system with 18+ integrated applications. From AI-powered browser automation to security reconnaissance tools, WebOS provides a complete desktop experience entirely in the browser with enterprise-grade security and lightning-fast performance.

## Key Features

### Security
- **End-to-end encryption** for sensitive data (notes, cookies, credentials)
- **Secure session management** with NextAuth.js
- **Input validation and sanitization** across all APIs
- **Rate limiting and request throttling** to prevent abuse
- **No client-side secrets** - all sensitive operations server-side
- **Prisma ORM** with parameterized queries preventing SQL injection
- **Anti-detect browser fingerprinting** evasion
- **Virtual camera injection** for privacy protection

### Performance
- **Next.js 16** with React 19 for optimal rendering
- **Bun runtime** for ultra-fast package management and execution
- **Standalone output** for minimal production bundle
- **Code splitting** and lazy loading for instant app launches
- **WebSocket connections** for real-time communication
- **CDP (Chrome DevTools Protocol)** for efficient browser control
- **In-memory caching** for frequently accessed data
- **Server-Sent Events (SSE)** for streaming AI responses

## Applications

### 1. AI Browser Assistant
An intelligent AI agent that can see and control your browser through vision and natural language commands.

**Features:**
- **Vision-based automation** - AI sees screenshots and understands page layout
- **Natural language control** - Tell the AI what to do in plain English
- **Real-time action execution** - Click, type, scroll, navigate, run JavaScript
- **Step-by-step transparency** - See every action the AI takes
- **Screenshot history** - Review screenshots taken during automation
- **QPS bypass** - Chat ID rotation for faster AI responses
- **Decision caching** - Reuses decisions for identical page states
- **Multi-tab management** - Open, close, and switch between tabs
- **Video control** - Play, pause, and interact with media
- **Error recovery** - Automatic retry on failures

**Use Cases:**
- Automated web testing
- Data extraction
- Form filling
- Navigation tasks
- Content interaction

### 2. Remote Browser
Full Chromium browser running on a virtual display, accessible via noVNC.

**Features:**
- **Real Chrome browser** - Full Chromium with all features
- **noVNC integration** - Browser-based VNC client
- **Anti-detect injection** - Evades browser fingerprinting
- **Virtual camera support** - Inject custom video feeds
- **Clipboard sync** - Paste from local to remote browser
- **Quick navigation** - URL bar with history
- **Browser controls** - Back, forward, refresh, scroll
- **Live camera status** - Real-time FPS and injection status
- **1366x768 resolution** - Optimized virtual display
- **Component monitoring** - Xvfb, Chrome, x11vnc, websockify status

**Use Cases:**
- Browser testing
- Camera injection testing
- Remote desktop access
- Privacy-focused browsing

### 3. Camera Inject
Advanced virtual camera injection system with real-time video processing and multi-target support.

**Features:**
- **Multiple source types** - Test pattern, video files, image files
- **Real-time filters** - Brightness, contrast, saturation, hue
- **Transform controls** - Zoom, pan, stretch, mirror, flip
- **Color effects** - Grayscale, sepia, invert
- **Multi-target injection** - Inject to Remote Chrome and Tor Suite simultaneously
- **Live preview** - See camera output before injection
- **File management** - Upload, delete, and manage media files
- **Live statistics** - Real-time FPS, resolution, zoom level
- **Console logging** - Detailed operation logs
- **Hot patching** - Update settings without re-injecting
- **Custom resolution** - Configurable width, height, and FPS

**Use Cases:**
- Video conferencing privacy
- Testing camera-dependent apps
- Custom video feeds
- Privacy protection
- Development testing

### 4. Security Lab
Comprehensive security reconnaissance toolkit for web application analysis.

**Features:**
- **HTTP Headers Analysis** - Grade security headers (CSP, HSTS, XFO, etc.)
- **SSL/TLS Inspection** - Certificate chain, cipher strength, protocol analysis
- **Tech Stack Detection** - Framework, server, CMS, analytics identification
- **DNS Lookup** - A, AAAA, CNAME, NS, MX, TXT, SOA, SRV records
- **Subdomain Enumeration** - Passive subdomain discovery via Certificate Transparency
- **Port Scanning** - Top 30 common TCP ports scan
- **Path/Directory Scanning** - Enumerate sensitive paths (.git, .env, admin panels)
- **JS Endpoint Extraction** - Extract API endpoints and routes from JavaScript
- **WHOIS Lookup** - Domain registration, registrar, name servers, expiry

**Use Cases:**
- Security reconnaissance
- Bug bounty hunting
- Penetration testing
- Security auditing
- Threat intelligence

### 5. Network Suite
Advanced browser with integrated security tools and network analysis.

**Features:**
- **Browser Integration** - Full browser with network monitoring
- **Network Request Monitoring** - Real-time request/response inspection
- **Cookie Management** - Save, restore, and manage cookies
- **Security Tools** - 23+ integrated security tools
- **IP Lookup** - Geolocation and IP information
- **DNS Records** - Comprehensive DNS analysis
- **WHOIS** - Domain registration data
- **Subdomain Discovery** - Passive subdomain enumeration
- **Tech Stack Detection** - Web technology identification
- **Headers Analysis** - HTTP security header inspection
- **SSL/TLS Analysis** - Certificate and cipher analysis
- **Nmap Scanning** - Port scanning capabilities
- **Redirect Analysis** - URL redirect chain tracking
- **Speed Testing** - Network performance measurement
- **API Testing** - Custom API request testing
- **SQL Injection Testing** - Quick SQLi detection
- **SQLMap Integration** - Advanced SQL injection testing
- **XSS Scanning** - Cross-site scripting detection
- **Directory Scanning** - Path enumeration
- **JavaScript Extraction** - Extract and analyze JS files
- **Port Scanning** - Quick port scan
- **Web Crawling** - Automated website crawling
- **Webhook Testing** - Webhook endpoint testing
- **JWT Analysis** - JWT token decoding and validation
- **Hash Identification** - Hash type recognition
- **Base64 Encoding/Decoding** - Base64 operations

**Use Cases:**
- Security research
- Penetration testing
- Bug bounty hunting
- Network analysis

### 6. Terminal
Full-featured terminal emulator with PTY integration and shell access.

**Features:**
- **xterm.js integration** - Full terminal emulation
- **PTY support** - Pseudo-terminal for true shell experience
- **WebSocket connection** - Real-time terminal I/O
- **Multiple shell support** - Bash, Zsh, Fish, etc.
- **Color support** - Full ANSI color support
- **Keyboard shortcuts** - Copy, paste, and terminal shortcuts
- **Session persistence** - Maintain terminal state
- **Resize handling** - Dynamic terminal resizing

**Use Cases:**
- Command-line operations
- System administration
- Development work
- Script execution
- File management

### 7. File Explorer
Complete file system with CRUD operations and drag-drop support.

**Features:**
- **Directory navigation** - Browse file system
- **File operations** - Create, read, update, delete files
- **Drag and drop** - Drag files to upload/move
- **File preview** - Preview images, text, code
- **Bulk operations** - Select and operate on multiple files
- **Search functionality** - Search files and directories
- **File properties** - View file metadata
- **Path navigation** - Breadcrumb navigation
- **Hidden files** - Toggle hidden file visibility

**Use Cases:**
- File management
- Code editing
- Asset management
- Data organization
- System administration

### 8. Browser
Simple iframe-based browser for sites that allow embedding.

**Features:**
- **Iframe embedding** - Embed sites that allow it
- **Bookmark management** - Quick access to favorite sites
- **Navigation controls** - Back, forward, refresh
- **URL input** - Direct URL navigation
- **Blocked domain detection** - Friendly fallback for blocked sites
- **Quick links** - Pre-configured safe-to-embed sites

**Use Cases:**
- Quick web access
- Documentation viewing
- Safe site browsing
- Reference lookup

### 9. Text Editor
Rich text editor with file operations.

**Features:**
- **Syntax highlighting** - Code syntax highlighting
- **File operations** - Open, save, create files
- **Multiple languages** - Support for various file types
- **Undo/redo** - Full edit history
- **Search and replace** - Find and replace text
- **Line numbers** - Code line numbering
- **Auto-save** - Periodic auto-saving

**Use Cases:**
- Code editing
- Note taking
- Configuration editing
- Script writing
- Documentation

### 10. Notes
Simple note-taking application.

**Features:**
- **Quick notes** - Fast note creation
- **Note management** - Edit, delete notes
- **Persistent storage** - Notes saved to database
- **Search** - Find notes by content

**Use Cases:**
- Quick reminders
- Meeting notes
- Idea capture
- Task lists

### 11. Encrypted Notes
Secure note-taking with end-to-end encryption.

**Features:**
- **AES encryption** - Military-grade encryption
- **Password protection** - Secure password access
- **End-to-end encryption** - Server never sees plaintext
- **Secure storage** - Encrypted data at rest
- **Note management** - Create, edit, delete encrypted notes

**Use Cases:**
- Sensitive information storage
- Password storage
- Private notes
- Secret keeping
- Secure documentation

### 12. Screenshot
Screenshot capture and management.

**Features:**
- **Screenshot capture** - Capture screen or window
- **Image preview** - View captured screenshots
- **Download** - Download screenshots
- **Delete** - Remove unwanted screenshots
- **Gallery view** - Browse all screenshots

**Use Cases:**
- Screen recording
- Bug reporting
- Documentation
- Tutorial creation
- Evidence collection

### 13. Chrome Debugger
Chrome DevTools Protocol integration for advanced browser control.

**Features:**
- **CDP connection** - Connect to Chrome instances
- **Element inspection** - Inspect DOM elements
- **Console access** - Execute JavaScript in browser context
- **Network monitoring** - Monitor network requests
- **Performance profiling** - Analyze page performance
- **Memory analysis** - Track memory usage

**Use Cases:**
- Browser debugging
- Performance analysis
- Network debugging
- DOM manipulation
- JavaScript debugging

### 14. Secure Share
Secure file sharing via encrypted connections.

**Features:**
- **Encrypted transfer** - Secure file sharing
- **File upload** - Upload files to share
- **Download links** - Generate secure download links
- **Temporary sharing** - Auto-expire shares
- **Password protection** - Optional password protection

**Use Cases:**
- Secure file sharing
- Privacy-focused sharing
- Temporary file hosting
- Secure distribution

### 15. Private Browser
Dedicated browser for private browsing.

**Features:**
- **Private browsing** - Enhanced privacy mode
- **IP masking** - Additional privacy features
- **Security level** - Adjustable security settings
- **Script control** - JavaScript control

**Use Cases:**
- Privacy protection
- Secure research
- Testing in isolated environment

### 16. VPS Dashboard
VPS monitoring and management dashboard.

**Features:**
- **System metrics** - CPU, memory, disk usage
- **Process monitoring** - View running processes
- **Service status** - Check service health
- **Resource graphs** - Visual resource usage
- **Alert notifications** - Resource threshold alerts

**Use Cases:**
- Server monitoring
- Resource management
- Performance tracking
- System administration
- Capacity planning

### 17. Guide
Interactive guide and documentation.

**Features:**
- **Step-by-step tutorials** - Guided walkthroughs
- **Feature documentation** - Detailed feature explanations
- **Video tutorials** - Embedded video guides
- **Search** - Find topics quickly
- **Progress tracking** - Track learning progress

**Use Cases:**
- Onboarding
- Feature learning
- Troubleshooting
- Best practices
- Training

### 18. About
Application information and credits.

**Features:**
- **Version information** - Current version display
- **Credits** - Author and contributor information
- **Links** - Links to documentation and support
- **License** - License information

## Tech Stack

- **Framework**: Next.js 16 with React 19
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **UI Components**: shadcn/ui (Radix UI)
- **Database**: Prisma ORM
- **Authentication**: NextAuth.js
- **Terminal**: xterm.js
- **Testing**: Playwright
- **Runtime**: Bun
- **Browser Control**: Chrome DevTools Protocol (CDP)
- **Virtual Display**: Xvfb
- **VNC**: noVNC, x11vnc, websockify
- **AI**: z-ai-web-dev-sdk

## Prerequisites

- Node.js 22+
- Bun 1.3+
- Database (PostgreSQL, MySQL, or SQLite)
- Xvfb (for Remote Browser)
- Chrome/Chromium (for Remote Browser)

## Installation

```bash
# Clone the repository
git clone https://github.com/sudaisalamboy/WebOS.git
cd WebOS

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Generate Prisma client
bun run db:generate

# Push database schema
bun run db:push
```

## Development

```bash
# Start development server
bun run dev

# Run linting
bun run lint

# Type checking
bunx tsc --noEmit

# Run E2E tests
bunx playwright test
```

## Production Build

```bash
# Build for production
bun run build

# Start production server
bun run start
```

## Environment Variables

```env
DATABASE_URL=your_database_connection_string
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=your_application_url
```

## Project Structure

```
src/
├── app/              # Next.js app directory
│   ├── api/         # API routes
│   │   ├── assistant/    # AI assistant endpoints
│   │   ├── vnc/          # Remote browser endpoints
│   │   ├── camera-inject/ # Camera injection endpoints
│   │   ├── seclab/       # Security lab endpoints
│   │   └── fs/           # File system endpoints
│   ├── components/  # React components
│   └── lib/         # Utility libraries
├── components/      # Shared components
│   ├── apps/        # Application components
│   ├── desktop/     # Desktop UI components
│   ├── ui/          # UI component library
│   └── vps/         # VPS dashboard components
└── lib/             # Helper functions
```

## CI/CD

The project uses GitHub Actions for continuous integration:

- **Automated builds** on push to main
- **Dependency installation** with Bun
- **Prisma client generation**
- **Production builds** with error ignoring
- **Vercel deployment** via GitHub integration

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

This project is private and proprietary.

## Author

Made with ❤️ by Sudais Alam

---

**Built with cutting-edge technology for maximum security and performance.**
