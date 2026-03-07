# JagGPT Web Frontend

Next.js chat frontend under `/web`, structured with reusable chat components and wired to the
Python backend endpoint `POST /api/jag-chat`.

## Requirements

- Next.js app in `/web`
- Chat page with reusable components
- Clean TypeScript setup
- Anonymous Firebase authentication (frontend only)
- Backend endpoint configured via env var
- No direct model-provider calls in the frontend

## Firebase behavior

- Firebase is initialized from `NEXT_PUBLIC_*` env vars in `.env.local`.
- Anonymous auth is started on app load via `signInAnonymously`.
- Auth state is kept in a top-level auth context and reused across the app.
- Each chat request includes the Firebase ID token as:

```
Authorization: Bearer <idToken>
```

## Run

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

## Backend wiring

Set `NEXT_PUBLIC_BACKEND_API_BASE_URL` to your backend host, e.g.:

```
NEXT_PUBLIC_BACKEND_API_BASE_URL=http://localhost:5000
```

Payload sent to `/api/jag-chat`:

```json
{
  "message": "...",
  "query": "...",
  "input": "...",
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

Streaming is preserved and rendered incrementally in the assistant bubble.
