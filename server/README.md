# Thermaltrue WMS API Server

## Prerequisites
- PostgreSQL 14+ (running and accessible)
- Windows (for Windows Service mode)

## Quick Start

1. Build the server:
```powershell
cargo build -p server --release
```

2. Create `.env` file in this directory:
```
DATABASE_URL=postgres://postgres:password@localhost:5432/thermaltrue
PORT=3000
```

3. Run in foreground (for testing):
```powershell
.\target\release\server.exe run
```

4. Install as Windows Service (Admin):
```powershell
.\target\release\server.exe install
.\target\release\server.exe start
```

5. Check status:
```powershell
.\target\release\server.exe status
```

## Commands
- `server.exe run` — Run in foreground
- `server.exe install` — Install Windows Service
- `server.exe uninstall` — Uninstall Windows Service
- `server.exe start` — Start the service
- `server.exe stop` — Stop the service
- `server.exe status` — Check service status

## Client Configuration
Open the Tauri client app, go to **Settings > API Settings**, and enter the server URL (e.g. `http://192.168.1.100:3000`).
