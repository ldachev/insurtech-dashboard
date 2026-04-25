# Insurtech & Proptech Competitive Intelligence Dashboard

This project builds a local SEC EDGAR-powered dashboard for:

- Lemonade (LMND)
- Hippo Holdings (HIPO)
- American Homes 4 Rent (AMH)
- NMI Holdings (NMIH)
- Invitation Homes (INVH)
- Essex Property Trust (ESS)

## Run

```bash
python3 scripts/fetch_sec_data.py
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000/`.

## Data

The dataset in `data/sec_company_fundamentals.json` is generated from the SEC EDGAR companyfacts API using latest annual 10-K facts. The subtitle uses `metadata.prepared_by` and `metadata.school`.
