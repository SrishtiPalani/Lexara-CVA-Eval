# Local Development Setup

This guide explains how to run the LM Comparison App locally to match the Heroku production environment.

## Prerequisites

- Python 3.11
- Node.js and npm
- Redis (install via `brew install redis` on macOS)

## Quick Start

### Option 1: Automated Scripts (Recommended)

#### Local Redis (Default)
```bash
# Start all services with local Redis
./start_local.sh

# Stop all services
./stop_local.sh
```

#### Heroku Redis (For Testing Production Redis)
```bash
# Start all services with Heroku Redis
./start_local_heroku_redis.sh

# Stop all services
./stop_local.sh
```

### Option 2: Manual Setup (4 Terminals)

#### Terminal 1: Redis Server (Local)
```bash
redis-server
```

#### Terminal 2: RQ Worker (Background Job Processor)
```bash
cd backend
python3.11 -m venv .venv311
source .venv311/bin/activate
pip install -r ../requirements.txt

# For local Redis:
rq worker -u redis://localhost:6379/0 eval

# For Heroku Redis:
rq worker -u redis://default:IP2jiUiicnzsJHn8MGqtIZQ3NUIUeKB7@redis-17364.c81.us-east-1-2.ec2.redns.redis-cloud.com:17364 eval
```

#### Terminal 3: Backend Server
```bash
cd backend
source .venv311/bin/activate

# Set environment variables to match Heroku
export NPM_CONFIG_PRODUCTION=false
export OUTBOUND_CONCURRENCY=12
export OUTBOUND_HTTP_LIMIT=40
export STREAM_HEARTBEAT_SECS=12

# Run from project root (not backend directory)
cd ..
gunicorn backend.app:app -k gthread --threads 4 --timeout 3600 --graceful-timeout 30 --max-requests 2000 --max-requests-jitter 200 --bind 127.0.0.1:8000
```

#### Terminal 4: Frontend
```bash
cd frontend
REACT_APP_API_BASE_URL=http://127.0.0.1:8000 npm start
```

## Services Overview

| Service | Port | Purpose |
|---------|------|---------|
| Redis Server | 6379 | Background job queue and pub/sub messaging |
| RQ Worker | - | Processes evaluation jobs in background |
| Backend (Gunicorn) | 8000 | Flask API server |
| Frontend (React) | 3000 | React development server |

## Environment Variables

The app automatically detects Redis connection in this order:
- `REDIS_TLS_URL` (Heroku Redis with TLS)
- `REDIS_URL` (Heroku Redis without TLS)  
- `REDISCLOUD_URL` (Redis Cloud add-on)
- Falls back to `redis://localhost:6379/0` for local development

### Heroku Environment Variables
```bash
export NPM_CONFIG_PRODUCTION=false
export OUTBOUND_CONCURRENCY=12
export OUTBOUND_HTTP_LIMIT=40
export STREAM_HEARTBEAT_SECS=12
export REDISCLOUD_URL="redis://default:IP2jiUiicnzsJHn8MGqtIZQ3NUIUeKB7@redis-17364.c81.us-east-1-2.ec2.redns.redis-cloud.com:17364"
```

## Key Differences from Your Previous Setup

1. **Redis Integration**: The app now uses Redis for:
   - Background job processing with RQ (Redis Queue)
   - Real-time progress updates via pub/sub
   - Job state persistence

2. **RQ Worker**: Required to process evaluation jobs asynchronously

3. **Gunicorn Configuration**: Matches Heroku's production settings

4. **Environment Variables**: Now includes Heroku-specific config vars

## Troubleshooting

### Redis Connection Issues
```bash
# Test local Redis connection
redis-cli ping

# Test Heroku Redis connection
redis-cli -u "redis://default:IP2jiUiicnzsJHn8MGqtIZQ3NUIUeKB7@redis-17364.c81.us-east-1-2.ec2.redns.redis-cloud.com:17364" ping

# Should return: PONG
```

### Backend Not Responding
```bash
# Test backend health
curl http://127.0.0.1:8000/get-models

# Check if gunicorn is running
ps aux | grep gunicorn
```

### RQ Worker Issues
```bash
# Check if RQ worker is running
ps aux | grep "rq worker"

# Check Redis queue status (local)
redis-cli llen rq:queue:eval

# Check Redis queue status (Heroku)
redis-cli -u "redis://default:IP2jiUiicnzsJHn8MGqtIZQ3NUIUeKB7@redis-17364.c81.us-east-1-2.ec2.redns.redis-cloud.com:17364" llen rq:queue:eval
```

### Port Conflicts
```bash
# Check what's using port 8000
lsof -i :8000

# Check what's using port 3000
lsof -i :3000
```

### Gunicorn Import Error
If you get "No module named 'backend'" error:
- Make sure you're running gunicorn from the project root (not backend directory)
- Use: `gunicorn backend.app:app` from the project root

## Production vs Local

| Component | Production (Heroku) | Local Development |
|-----------|---------------------|-------------------|
| Redis | Heroku Redis add-on | Local Redis server or Heroku Redis |
| Backend | Gunicorn on Heroku dyno | Gunicorn on localhost:8000 |
| Frontend | Static build served by backend | React dev server on localhost:3000 |
| RQ Worker | Heroku worker dyno | Local RQ worker process |

## Development Workflow

1. Start all services with `./start_local.sh` or `./start_local_heroku_redis.sh`
2. Make changes to code
3. Frontend auto-reloads on changes
4. Backend requires restart: `pkill -f gunicorn` then restart
5. Stop all services with `./stop_local.sh`

## Testing with Production Redis

To test with the exact same Redis instance as production:
1. Use `./start_local_heroku_redis.sh`
2. This will use your Heroku Redis Cloud instance
3. Useful for testing Redis-specific functionality
4. Be careful not to interfere with production jobs
