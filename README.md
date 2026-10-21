# Chaurasiya Puja Samagri

## Local development

1. Install Node.js and run `npm install`.
2. Copy `.env.example` to `.env`.
3. Set `ADMIN_PASSWORD` to a unique password of at least 12 characters and `SESSION_SECRET` to a random value of at least 32 characters.
4. Run `npm run dev`, then open `http://localhost:5173`.

## Production

Run `npm run build`, then run `npm start` with `NODE_ENV=production` and the same required environment variables. The Express server serves the built frontend and API from one origin. Production must use HTTPS so the admin session cookie is protected.

SQLite stores products and sales in `backend/data/store.sqlite` by default. Set `DATABASE_PATH` to a persistent disk location on the host; ephemeral deployment filesystems will lose the database when an instance is replaced. Back up this database file regularly.

Stock updates and invoices are committed together in a SQLite transaction. Sales are accepted only in a product's stock unit or a unit with a configured verified conversion. The current catalog includes the goni, half-goni, and quarter-goni conversions where applicable; other conversions must be configured before those units can be sold.
