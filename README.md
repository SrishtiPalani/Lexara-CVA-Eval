## Language Model Comparison App

A comprehensive tool for comparing and evaluating different language models with real-time streaming capabilities and detailed metrics.

## 🌐 Online Access

**Live Application:** [https://lexara-6b38293fcdac.herokuapp.com/](https://lexara-6b38293fcdac.herokuapp.com/)

## 🎯 How to Use Lexara

Lexara is an interactive benchmarking tool for conversational visual analytics that helps AI engineers, researchers, and product managers:

- **Explore model and prompt capabilities and limitations**
- **Make sense of qualitative and quantitative differences**
- **Confidently choose the right model and prompt for their use case**

Your feedback will directly shape Lexara's development so it becomes a practical, decision-support tool for model and prompt selection. You can choose to:

- **Evaluate a Test Case** — Compare how different models/prompts perform on a specific dataset scenario
- **Evaluate a Model** — Test the same prompt across different models to see differences
- **Evaluate a System Prompt** — Compare prompt variations with the same model

You can use any of the listed sample datasets and corresponding test cases or please feel free to create your own, as long as they follow the required yaml structure. 

### Ideas for evaluation tasks to try out:

- Try different model sizes (large vs. small)
- Keep one variable fixed (e.g., same prompt) while changing another (e.g., model)
- Explore edge cases like ambiguous prompts or unusual chart types

## 🚀 Local Development Setup

### Prerequisites

- Python 3.11
- Node.js and npm
- Redis (install via `brew install redis` on macOS)

### Quick Start (Recommended)

The easiest way to run the application locally is using the provided automation scripts:

```bash
# Start all services (Redis, RQ Worker, Backend, Frontend)
./start_local.sh

# Stop all services
./stop_local.sh
```

This will start:
- **Frontend:** [http://localhost:3000](http://localhost:3000)
- **Backend:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Redis:** localhost:6379

### Environment Setup

Create a `.env` file in the `backend` directory with your API keys:

```bash
# LM API Keys
ANTHROPIC_API_KEY="insert-your-own"
OPENAI_API_KEY="insert-your-own"
HUGGINGFACE_API_KEY="insert-your-own"
```

### Manual Setup (Alternative)

If you prefer to run services manually, see [LOCAL_SETUP.md](LOCAL_SETUP.md) for detailed instructions on running each service in separate terminals.

## 📚 Documentation

- **Detailed Local Setup:** [LOCAL_SETUP.md](LOCAL_SETUP.md) - Comprehensive guide for manual setup and troubleshooting
- **Project Structure:** See the project layout above for file organization

## 🔧 Services Overview

| Service | Port | Purpose |
|---------|------|---------|
| Redis Server | 6379 | Background job queue and pub/sub messaging |
| RQ Worker | - | Processes evaluation jobs in background |
| Backend (Gunicorn) | 8000 | Flask API server |
| Frontend (React) | 3000 | React development server |
