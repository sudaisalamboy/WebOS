# WebOS

[![CI/CD Pipeline](https://github.com/sudaisalamboy/WebOS/workflows/CI%20CD%20Pipeline/badge.svg)](https://github.com/sudaisalamboy/WebOS/actions)

A comprehensive web-based operating system with remote browser control, virtual camera injection, terminal access, and file management.

## Features

- **Desktop Environment** - Full desktop UI with window management, taskbar, and drag-and-drop support
- **Remote Browser** - Chrome DevTools Protocol (CDP) integration for remote browser control
- **Virtual Camera** - Camera injection with virtual camera support for video streaming
- **Terminal** - Full terminal emulator with PTY integration and shell access
- **File Explorer** - Complete file system with CRUD operations and drag-drop support
- **Authentication** - Secure session management with password protection
- **VNC Service** - Process management for VNC services
- **Tor Browser** - Anonymous browsing with Tor proxy integration
- **Text Editor** - Rich text editor with file operations
- **Settings** - Configuration management for all apps

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

## Prerequisites

- Node.js 22+
- Bun 1.3+
- Database (PostgreSQL, MySQL, or SQLite)

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
│   ├── components/  # React components
│   └── lib/         # Utility libraries
├── components/      # Shared components
└── lib/             # Helper functions
```

## CI/CD

The project uses GitHub Actions for continuous integration and deployment:

- Automated builds on push to main
- Linting and type checking
- Security audits
- E2E testing with Playwright

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
