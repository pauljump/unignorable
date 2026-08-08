# Unignorable

Unignorable turns NYC 311 records into a persistent public accountability map. It groups repeated reports into place-based issues, shows closure-versus-resolution evidence, and lets residents corroborate, document, and organize around a location.

## Ownership

- Canonical source and Git history: `/Users/mini-home/unignorable`
- Production runtime data: `/Users/mini-home/.local/share/unignorable`
- Production secrets: `/Users/mini-home/.secrets/monorepo.env`
- Deployment definitions: `/Users/mini-home/Desktop/Monorepo/control-plane/deploy`
- Current data-engine dependency: `/Users/mini-home/Desktop/Monorepo/sidewalk`

Mutable data and credentials never belong in this repository. The project-local `data/` directory is retained only as preserved pre-cutover state and local-development input; it is ignored except for explicit public configuration files.

## Verify

```bash
DATA_DIR=/Users/mini-home/.local/share/unignorable npm run verify
```

## Run locally

`REVIEW_KEY` is required. Production injects it from the central secret store through the control-plane PM2 definition.

```bash
DATA_DIR=/path/to/test-data REVIEW_KEY=test-only-key PORT=8000 npm start
```

See `CLAUDE.md` for architecture, product state, and operational history.
