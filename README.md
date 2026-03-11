# BOTQR

Discord bot for QR payment requests, payment tracking, and simple admin reporting.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment template and fill your values:

```bash
copy .env.example .env
```

3. Put your Google service account file at:

```text
service-account-key.json
```

4. Start bot:

```bash
npm run dev
```

## Required Environment Variables

- `TOKEN`
- `GUILD_ID`
- `GOOGLE_SHEETS_ID`
- `ADMIN_ROLES` (optional, default: `Admin`)
- `DEFAULT_SELLER_ID`
- `PORT` (optional, default: `3000`)

## Security Notes

- Do not commit `.env`.
- Do not commit `service-account-key.json`.
- Rotate credentials immediately if they were exposed.

