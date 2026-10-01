# Lot Companion

Lot Companion is Cornerstone's Queensland property mapping and report application. It includes 14 council map experiences, account access, Stripe purchase links, one-time report access, POD import, and the Visual Approvals report API.

## Run locally

Install dependencies and start the application:

```powershell
npm install
npm start
```

The web application defaults to `http://localhost:3000`. The Windows mapping launchers can also start the local static version.

## Production configuration

Copy the names from `.env.example` into the hosting platform's environment settings. Never commit real credentials.

The paywall is enabled in production code. Stripe creates access only after a paid Checkout Session is verified. If an external order system calls `POST /api/create-token`, it must send the configured `TOKEN_ISSUER_API_KEY` in the `x-api-key` header or as a Bearer token.

Required production secrets include:

- `SESSION_SECRET` (at least 32 characters)
- `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID`
- `TOKEN_ISSUER_API_KEY` when external orders issue access
- database credentials used by account login

Set `FRONTEND_ORIGIN` to the permitted browser origin. Multiple origins can be supplied as a comma-separated list.

## Build offline pages

Regenerate the `*-file.html` pages and their bundles after changing shared map code:

```powershell
npm run build:file-pages
```

Offline pages remain purchase-locked because paid access must be validated by the hosted service.

## Visual Approvals

Run the report-only service with:

```powershell
npm run serve:reports
```

See `docs/VA-INTEGRATION.md` for the authenticated API contract.
