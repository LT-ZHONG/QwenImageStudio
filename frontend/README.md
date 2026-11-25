# Qwen Image Studio — Frontend

React + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui (Base UI) + Zustand + TanStack Query.

```bash
npm install
npm run dev      # http://127.0.0.1:5173, proxies /api (incl. WebSocket) to http://127.0.0.1:8000
npm run build    # production build to dist/
```

The backend (FastAPI) must be running on port 8000; see `../backend`.
