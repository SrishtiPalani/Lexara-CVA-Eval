#!/bin/bash

# =============================================================================
# Language Model Comparison App (Lexara) - Local Development Startup Script
# =============================================================================
# 
# This script starts all services needed to run the Lexara application locally.
# It matches the Heroku production environment configuration and includes:
# - Redis server for job queue and pub/sub messaging
# - RQ worker for background job processing
# - Flask backend API server
# - React frontend development server
#
# Usage: ./start_local.sh
#
# Author: Research Team
# License: MIT
# =============================================================================

echo "Starting Language Model Comparison App (Lexara) locally..."

# =============================================================================
# Utility Functions
# =============================================================================

# Check if a specific port is already in use
# Args: $1 - port number to check
# Returns: 0 if port is in use, 1 if port is available
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null ; then
        echo "Port $1 is already in use"
        return 0
    else
        echo "Port $1 is not in use"
        return 1
    fi
}

# Start a service in the background with port checking
# Args: $1 - service name, $2 - command to execute, $3 - port number
start_service() {
    local name=$1
    local command=$2
    local port=$3
    
    echo "Starting $name..."
    if check_port $port; then
        echo "$name already running on port $port"
    else
        eval "$command" &
        echo "$name started"
    fi
}

# Set environment variables to match Heroku
export NPM_CONFIG_PRODUCTION=false
export OUTBOUND_CONCURRENCY=6
export OUTBOUND_HTTP_LIMIT=20
export STREAM_HEARTBEAT_SECS=12
export JUDGE_TIMEOUT=60
export GRANULAR_PROGRESS=1
export RQ_JOB_TIMEOUT=604800
export RQ_RESULT_TTL=604800

# Redis configuration for concurrent users
export REDIS_MAX_CONNECTIONS=20
export REDIS_RETRY_ON_TIMEOUT=true
export REDIS_HEALTH_CHECK_INTERVAL=30

# For testing with Heroku Redis (optional - comment out to use local Redis)
# export REDISCLOUD_URL="redis://default:IP2jiUiicnzsJHn8MGqtIZQ3NUIUeKB7@redis-17364.c81.us-east-1-2.ec2.redns.redis-cloud.com:17364"

# 1. Start Redis Server (Terminal 1)
echo "Starting Redis Server..."
if pgrep -f "redis-server" > /dev/null; then
    echo "Redis server already running"
else
    # Use custom Redis configuration for better concurrent performance
    if [ -f "redis.conf" ]; then
        redis-server redis.conf &
        echo "Redis server started with custom configuration"
    else
        redis-server &
        echo "Redis server started with default configuration"
    fi
fi

# Wait for Redis to be ready
sleep 2
if redis-cli ping > /dev/null 2>&1; then
    echo "Redis is responding"
else
    echo "Redis is not responding"
    exit 1
fi

# 2. Start RQ Worker (Terminal 2)
echo "Starting RQ Worker..."
if pgrep -f "rq worker" > /dev/null; then
    echo "RQ worker already running"
else
    # Run RQ worker from project root with proper Python path
    source backend/.venv311/bin/activate
    # Set PYTHONPATH to include the project root
    export PYTHONPATH="${PWD}:${PYTHONPATH}"
    # Set RQ worker timeout to 7 days (604800 seconds) to prevent timeouts
    RQ_JOB_TIMEOUT=604800 RQ_RESULT_TTL=604800 rq worker -u redis://localhost:6379/0 eval &
    echo "RQ worker started"
fi

# 3. Start Backend Server (Terminal 3)
echo "Starting Backend Server..."
if check_port 8000; then
    echo "Backend already running on port 8000"
else
    # Must run from project root, not backend directory
    source backend/.venv311/bin/activate
    gunicorn backend.app:app -k gthread --threads 4 --timeout 0 --graceful-timeout 30 --max-requests 2000 --max-requests-jitter 200 --worker-connections 1000 --bind 127.0.0.1:8000 &
    echo "Backend server started"
fi

# Wait for backend to be ready
sleep 3
if curl -s http://127.0.0.1:8000/get-models > /dev/null; then
    echo "Backend is responding"
else
    echo "Backend is not responding"
fi

# 4. Start Frontend (Terminal 4)
echo "Starting Frontend..."
if check_port 3000; then
    echo "Frontend already running on port 3000"
else
    cd frontend
    REACT_APP_API_BASE_URL=http://127.0.0.1:8000 npm start &
    cd ..
    echo "Frontend started"
fi

echo ""
echo "All services started!"
echo ""
echo "Frontend: http://localhost:3000"
echo "Backend:  http://127.0.0.1:8000"
echo "Redis:    localhost:6379"
echo ""
echo "To stop all services, run: ./stop_local.sh"
echo ""
