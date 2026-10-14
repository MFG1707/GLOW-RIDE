# GLOW-Ride

Booking and fleet-management platform for electric scooter sessions in Benin.

## Run & Operate

- `pnpm --filter @workspace/glow-ride run dev` — run the customer website
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck and build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI
- `pnpm --filter @workspace/db run push` — push database schema changes to development
- Required environment: `DATABASE_URL`, Clerk keys; `FEDAPAY_SECRET_KEY` for payments

## Stack

- pnpm workspaces, Node.js, TypeScript
- Web: React, Vite, Clerk authentication
- API: Express, Clerk session validation, FedaPay server-side payments
- DB: PostgreSQL + Drizzle ORM
- API codegen: Orval

## Where things live

- `artifacts/glow-ride` — public site, customer bookings, accounts and admin UI
- `artifacts/api-server` — API routes and FedaPay webhook
- `lib/db/src/schema` — database models
- `lib/api-spec/openapi.yaml` — API source of truth for generated contracts and hooks

## Architecture decisions

- React/Vite + Express + PostgreSQL is the stack selected for this workspace; do not switch frameworks or databases without an explicit request.
- Admin access uses verified Clerk email allowlisting through `ADMIN_EMAILS`; never use a shared default password or trust a client-supplied role.
- FedaPay credentials and payment verification stay server-side; configure a webhook signature secret before recording confirmed payments.

## Product

- Customers reserve available scooters for administrator-published dates and times, pay through FedaPay, and view or cancel eligible reservations.
- Customers can see remaining ride time and the scheduled end time.
- Administrators manage locations, dated sessions, scooter stock, reservations, fares, and account roles.
- Locations are temporary meetup points attached to scheduled activity, not permanent always-open rental stations.
- Development seed records are fictional examples, not real riders or transactions.

## User preferences

- Preserve booking and user/admin capabilities when updating the visual design.
- Show `Produit par MFG-TECH` in the footer on every page.

## Gotchas

- Regenerate the Zod schemas and client hooks after changing the OpenAPI file.
- Payment status updates require the FedaPay endpoint webhook secret in Replit Secrets.

## Pointers

- See the `pnpm-workspace` skill for workspace structure and TypeScript project details.
