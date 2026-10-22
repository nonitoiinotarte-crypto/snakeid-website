# SnakeID — Worldwide Snake Guide

A responsive Node.js/Express website that uses the iNaturalist API for snake taxon search, taxon reference details, and community observations. It includes photo preview/validation, local browser search history, and safety messaging.

## Important scope note

This starter does **not** automatically identify a snake from an uploaded image. The iNaturalist API provides taxon and observation data, but the app does not claim that searching or comparing reference photos proves the identity or venom status of an animal. The upload route validates file type/size and returns a clear message; it does not send the photo to iNaturalist.

## Requirements

- Node.js 20 or later (Node 18+ may work if it supports built-in `fetch`)
- Internet access for iNaturalist API calls
- Modern browser

## Run locally

```bash
# 1. Extract the ZIP and open its folder in a terminal
cd snakeid-website

# 2. Install dependencies
npm install

# 3. Optional environment configuration
# Windows PowerShell:
Copy-Item .env.example .env
# macOS/Linux:
cp .env.example .env

# 4. Start the app
npm start
```

Open http://localhost:3000

Node does not automatically load `.env` files in every supported version. The app works with defaults; if you want environment variables from `.env`, install `dotenv`, add `import 'dotenv/config';` at the top of `server.js`, and then run `npm install dotenv`.

For development auto-restart, run `npm run dev`.

## Project structure

```text
snakeid-website/
├── public/
│   ├── index.html     # Page structure
│   ├── styles.css    # Responsive styling
│   └── app.js         # Search, details, upload preview, local history
├── server.js          # Express routes, iNaturalist API proxy, scan logging
├── package.json
├── .env.example
├── .gitignore
├── snakeid.sqlite     # Created automatically at first run (SQLite database)
└── README.md
```

## API routes

- `GET /api/species/search?q=cobra` — searches taxa under Serpentes.
- `GET /api/species/:id` — retrieves a taxon's reference details.
- `GET /api/species/:id/observations` — returns recent georeferenced research-grade observations with photos.
- `POST /api/photo-check` — validates an uploaded image (JPG/PNG/WebP, max 8 MB); does not identify it.

The API proxy keeps browser code separate from iNaturalist calls and adds a basic per-IP rate limit. Do not use this starter as a production service without adding logging, deployment configuration, privacy review, stronger abuse controls, and tests.

## Data and safety

- iNaturalist taxon/observation data can be incomplete, community-generated, or geographically imprecise.
- Observation photos are hosted by contributors; follow the photo's licensing and attribution terms before reusing it elsewhere.
- Do not infer venom status from appearance or the presence of a search result. A reliable venom-risk feature needs a curated, sourced species dataset and expert review.
- Never approach or handle an unidentified snake. If bitten, seek emergency medical care immediately.

## API documentation

- https://api.inaturalist.org/v1/docs/
- https://www.inaturalist.org/pages/api+recommended+practices


## Scan logs and dashboard

The server creates `snakeid.sqlite` automatically. It stores:
- A species-search event when a search returns a match
- A photo-upload event when a photo passes validation
- Timestamp, species taxon/name when available, event type, status, and optional location label

The public page has a Scan logs & statistics section with total logged events, today's events, validated photo uploads, a seven-day chart, top searched species, and recent records.

**Important:** These are logged search and photo-upload events, not successful AI image scans. The current upload route still does not identify a snake. The dashboard API is not password-protected in this starter; add admin authentication before publishing it to the internet. The database is local to the server and does not automatically synchronize across multiple server instances. Back up `snakeid.sqlite` regularly.


## Deploying with a persistent SQLite volume

For a host that supports persistent volumes, mount the volume at `/data` and set:

```text
DB_PATH=/data/snakeid.sqlite
```

The app honors `DB_PATH`; without it, local development uses `snakeid.sqlite` in the project folder.

Before making the dashboard public, add admin authentication. The starter's `/api/admin/scan-stats` and `/api/admin/scan-logs` routes are not protected by default, so anyone who discovers the site can view the aggregate statistics and recent logs. Do not store personal or precise location data until access control and privacy handling are implemented.
