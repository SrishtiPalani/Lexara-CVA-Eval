#!/bin/bash

# Stop Local Development Environment
echo "Stopping LM Comparison App services..."

# Stop Redis server
echo "Stopping Redis server..."
pkill -f "redis-server" || echo "Redis server not running"
sleep 1
# Force kill if still running
pkill -9 -f "redis-server" 2>/dev/null || true

# Stop RQ worker
echo "Stopping RQ worker..."
pkill -f "rq worker" || echo "RQ worker not running"
sleep 1
# Force kill if still running
pkill -9 -f "rq worker" 2>/dev/null || true

# Stop Gunicorn backend
echo "Stopping Backend server..."
pkill -f "gunicorn" || echo "Backend server not running"
sleep 1
# Force kill if still running
pkill -9 -f "gunicorn" 2>/dev/null || true

# Stop npm frontend and related processes
echo "Stopping Frontend..."
pkill -f "npm start" || echo "npm start not running"
pkill -f "react-scripts" || echo "react-scripts not running"
pkill -f "fork-ts-checker-webpack-plugin" || echo "TypeScript checker not running"
sleep 1
# Force kill if still running
pkill -9 -f "npm start" 2>/dev/null || true
pkill -9 -f "react-scripts" 2>/dev/null || true
pkill -9 -f "fork-ts-checker-webpack-plugin" 2>/dev/null || true

# Check if ports are still in use
echo "Checking if ports are free..."
if lsof -i :3000 >/dev/null 2>&1; then
    echo "Port 3000 is still in use. Force killing processes..."
    lsof -ti :3000 | xargs kill -9 2>/dev/null || true
fi

if lsof -i :6379 >/dev/null 2>&1; then
    echo "Port 6379 is still in use. Force killing processes..."
    lsof -ti :6379 | xargs kill -9 2>/dev/null || true
fi

if lsof -i :5000 >/dev/null 2>&1; then
    echo "Port 5000 is still in use. Force killing processes..."
    lsof -ti :5000 | xargs kill -9 2>/dev/null || true
fi

echo "All services stopped!"
