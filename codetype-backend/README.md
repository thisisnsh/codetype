# CodeType Backend (Cloudflare Workers)

## Requirements

- Node.js 18+
- Wrangler (installed via `npm install`)

## Develop

```bash
cd codetype-backend
npm install
npm run dev
```

## Test

No automated tests yet.

## Release

1. Update `wrangler.toml` with your Firebase project vars and KV namespace ID.
2. Set secrets:

```bash
wrangler secret put FIREBASE_CONFIG
```

3. Deploy:

```bash
npm run deploy
```
