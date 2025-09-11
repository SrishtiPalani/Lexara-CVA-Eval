#!/bin/bash

# =============================================================================
# Language Model Comparison App (Lexara) - Local Development Shutdown Script
# =============================================================================
# 
# This script stops all services that were started by start_local.sh.
# It gracefully terminates all processes and ensures ports are freed.
#
# Services stopped:
# - Redis server (port 6379)
# - RQ worker processes
# - Flask backend server (port 5000/8000)
# - React frontend development server (port 3000)
#
# Usage: ./stop_local.sh
#
# Author: Research Team
# License: MIT
# =============================================================================

echo "Stopping Language Model Comparison App (Lexara) services..."

# =============================================================================
# Service Shutdown Process
# =============================================================================

# Stop Redis server (port 6379)
echo "Stopping Redis server..."
pkill -f "redis-server" || echo "Redis server not running"
sleep 1
# Force kill if still running
pkill -9 -f "redis-server" 2>/dev/null || true

# Stop RQ worker processes
echo "Stopping RQ worker..."
pkill -f "rq worker" || echo "RQ worker not running"
sleep 1
# Force kill if still running
pkill -9 -f "rq worker" 2>/dev/null || true

# Stop Flask backend server (Gunicorn)
echo "Stopping Backend server..."
pkill -f "gunicorn" || echo "Backend server not running"
sleep 1
# Force kill if still running
pkill -9 -f "gunicorn" 2>/dev/null || true

# Stop React frontend development server and related processes
echo "Stopping Frontend..."
pkill -f "npm start" || echo "npm start not running"
pkill -f "react-scripts" || echo "react-scripts not running"
pkill -f "fork-ts-checker-webpack-plugin" || echo "TypeScript checker not running"
sleep 1
# Force kill if still running
pkill -9 -f "npm start" 2>/dev/null || true
pkill -9 -f "react-scripts" 2>/dev/null || true
pkill -9 -f "fork-ts-checker-webpack-plugin" 2>/dev/null || true

# =============================================================================
# Port Cleanup and Verification
# =============================================================================

# Check if ports are still in use and force kill if necessary
echo "Checking if ports are free..."

# Frontend port (3000)
if lsof -i :3000 >/dev/null 2>&1; then
    echo "Port 3000 is still in use. Force killing processes..."
    lsof -ti :3000 | xargs kill -9 2>/dev/null || true
fi

# Redis port (6379)
if lsof -i :6379 >/dev/null 2>&1; then
    echo "Port 6379 is still in use. Force killing processes..."
    lsof -ti :6379 | xargs kill -9 2>/dev/null || true
fi

# Backend port (5000)
if lsof -i :5000 >/dev/null 2>&1; then
    echo "Port 5000 is still in use. Force killing processes..."
    lsof -ti :5000 | xargs kill -9 2>/dev/null || true
fi

echo "All services stopped successfully!"
