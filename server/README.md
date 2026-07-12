# Thermaltrue WMS API Server

Standalone REST API server for Thermaltrue Warehouse Management System.

## Prerequisites
- PostgreSQL 14+ (running and accessible)
- Windows (for Windows Service mode)

## Quick Start

1. Create `.env` file (copy from `.env.example` at project root):
```
DATABASE_URL=postgres://postgres:password@localhost:5432/thermaltrue
JWT_SECRET=your-random-secret-key-here
```

2. Build the server:
```
cargo build -p server --release
```

3. Run in foreground (for testing):
```
.\target\release\server.exe run
```

4. Install as Windows Service (Admin):
```
.\target\release\server.exe install
.\target\release\server.exe start
```

## Commands

| Command | Description |
|---------|-------------|
| `server.exe run` | Run in foreground (for testing) |
| `server.exe install` | Install as Windows Service (Admin) |
| `server.exe uninstall` | Uninstall Windows Service (Admin) |
| `server.exe start` | Start the service |
| `server.exe stop` | Stop the service |
| `server.exe status` | Check service status (running/stopped/not installed) |

## Environment Variables

See `.env.example` at the project root for all available variables.

Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Secret key for JWT tokens (change for production!)
- `PORT` — Server listen port (default: 3000)
- `DEFAULT_ADMIN_PASSWORD` — Default password for admin user (first run only)
- `SESSION_TTL_HOURS` — Session expiry in hours (default: 24)

## Client Configuration

Open the Tauri client app, go to **Settings > API Settings**, and enter the server URL (e.g. `http://192.168.1.100:3000`).

## Docker

The project includes `docker-compose.yml` for running PostgreSQL:
```
docker compose up -d
```

For frontend preview via nginx:
```
docker compose --profile web up
```

The API server itself is Windows-only and must run natively.
