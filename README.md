# U.S. clinical electives for international medical students

A living list of U.S. clinical electives and clerkships that students at medical schools outside the United States can apply to directly, with requirements, application fees and tuition taken from each program's official page.

Every entry asks the reader whether it is correct, and anyone can suggest a program that is missing. Once a week the reports are checked against the official program pages: clear corrections are applied, and the maintainer decides the rest.

## How it works

```
Reader answers "Is this entry correct?" or suggests a program
        │
        ▼
Google Sheet "Feedback" (private inbox, one row per message)
        │   once a week
        ▼
Weekly check (procedure in WEEKLY_CHECK.md)
  ├─ official page clearly confirms a change → updates data/programs.json + Recent updates
  ├─ official page confirms the entry        → no change
  └─ unclear, new program, or removal        → GitHub issue "Decision needed" for the maintainer
```

## What is in this repository

| Path | What it is |
|---|---|
| `index.html`, `assets/` | The page |
| `data/programs.json` | The list. This is the single source of truth for what the page shows |
| `data/changelog.json` | The "Recent updates" section |
| `data/us-map.json` | Outlines of the states for the map (public U.S. Census shapes) |
| `config.js` | Two settings: the address of the feedback inbox and the Google Analytics ID (empty switches visit statistics off) |
| `apps-script/Code.gs` | The small script that receives feedback into the Google Sheet |
| `WEEKLY_CHECK.md` | The procedure for the weekly check |
| `tools/validate_data.py` | Safety check run before any data change is published |

## Connect the feedback inbox (once, about 5 minutes)

1. Open the Google Sheet that will receive the feedback.
2. Menu **Extensions → Apps Script**. Delete what is in the editor and paste the whole content of `apps-script/Code.gs`. Save.
3. **Deploy → New deployment**. Type: **Web app**. Execute as: **Me**. Who has access: **Anyone**. Click **Deploy** and approve the permission request (the script only writes to this one sheet).
4. Copy the **Web app URL** (it ends in `/exec`).
5. Paste it between the quotes in `config.js`:
   ```js
   FEEDBACK_ENDPOINT: "https://script.google.com/macros/s/…/exec"
   ```
6. Commit. Answer **Yes** on any program on the live page and check that a row appears in the sheet.

If you later edit `Code.gs`, use **Deploy → Manage deployments → Edit → New version** so the address stays the same.

## Publish with GitHub Pages

Repository **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**. The page is then served at `https://<user>.github.io/<repository>/`.

## Editing the list by hand

Edit `data/programs.json`, add a line at the top of `data/changelog.json`, run `python3 tools/validate_data.py`, commit. To see the page locally: `python3 -m http.server` in this folder, then open `http://localhost:8000`.

## Answering a "Decision needed" issue

Reply in a comment with the item number and your decision, for example:

```
1: approve
2: reject
3: tuition is 4200
```

The next weekly run applies it and closes the issue. Only comments from the repository owner are taken into account.

## Source and scope

The starting list is the program-level dataset (Supplemental Table S1) of a systematic environmental scan of 252 U.S. program records, searched in March and April 2024 and re-verified in June 2026:

> Zhang JMF, Heringer DL, de Oliveira Rodrigues G, Hernandez Oquet RE, Cardoso R, Liu R, Mathur M. Direct-Application Clinical Elective Pathways for International Medical Students in the United States: A Systematic Environmental Scan. Research Square; 2026. Preprint, not yet peer reviewed. https://doi.org/10.21203/rs.3.rs-11613768/v1 (CC BY 4.0)

Requirements are recorded as documented on the official page. "Not reported" means the page did not state the item; it does not mean the requirement is absent.

Included: U.S. programs offering a clinical elective, clerkship or comparable supervised rotation that accept international medical students through a direct application, whether or not the institution is also on VSLO. Not included: observerships and placements sold through private agencies.

This is an independent list. It is not affiliated with the institutions listed or with the AAMC. Always confirm requirements on the official program page before applying.
