# Neubar WhatsApp + Web Menu MVP

This MVP lets a customer enter from WhatsApp, open a web menu, add multiple items with + / -, checkout, and receive a pickup code.

## Structure

- `frontend/` — React + Vite mobile ordering UI
- `backend/` — Node/Express API for sessions, menu, cart checkout, payment webhook, Petpooja placeholder, WhatsApp placeholder

## MVP Flow

1. Customer sends HI on WhatsApp.
2. Backend creates an order session.
3. WhatsApp sends customer a link like: `https://order.neubar.in/?session=SESSION_ID`
4. Customer opens web menu.
5. Customer adds items using + / - buttons.
6. Customer checks out.
7. Backend creates order and payment link placeholder.
8. After payment success webhook, backend generates pickup code and pushes order to Petpooja placeholder.
9. Customer receives pickup code on WhatsApp.

## Local Run

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Backend runs on `http://localhost:4000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

Open:

```text
http://localhost:5173/?session=demo-session
```

## Environment Variables

See `backend/.env.example`.

## Production Additions Needed

- WhatsApp Cloud API credentials
- Razorpay keys and live payment link API
- Petpooja integration credentials
- Real database: Supabase / Firebase / Postgres
- Hosted backend: Render / Railway / AWS
- Hosted frontend: Vercel / Netlify
