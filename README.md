# Not Just Fatalities

**Who, How and Where Australians Are Hospitalised by Road Crashes (2011–2021)**

COS30045 Data Visualisation Project 2026, Group 29. A six-page D3.js data story built on BITRE hospitalised injury data.

## Research questions

1. Who is hospitalised by road crashes: which ages, sexes and population groups?
2. How are they injured: which road users, hit by what?
3. Where do they live: which states and remoteness areas?
4. How has this changed from 2011 to 2021?

## Technologies

- KNIME Analytics Platform: data cleaning, processing and exploration
- D3.js v7: interactive visualisations
- HTML, CSS and JavaScript: website
- GitHub: version control and team collaboration
- Swinburne Mercury: hosting

## Folder structure

The repo root is the website root, so the whole repo can be uploaded to Mercury as it is.

```
COS30045_Group29/
├── index.html                 Home         (Teammate 1)
├── who.html                   Who          (Teammate 2)
├── how.html                   How          (Teammate 2)
├── where.html                 Where        (Winson)
├── time.html                  Over time    (Teammate 1)
├── about.html                 About        (Winson)
├── assets/
│   ├── css/
│   │   └── style.css          shared styles, colours as CSS variables (Teammate 1)
│   ├── js/
│   │   ├── common.js          shared helpers: tooltip, number format, colours, year filter (Teammate 1)
│   │   └── pages/
│   │       ├── home.js        (Teammate 1)
│   │       ├── time.js        (Teammate 1)
│   │       ├── who.js         (Teammate 2)
│   │       ├── how.js         (Teammate 2)
│   │       └── where.js       (Winson)
│   └── img/                   logos, icons
├── data/                      cleaned CSVs exported from KNIME (do not edit by hand)
│   └── geo/
│       └── aus_states.geojson state boundaries for the Where map (to add)
├── README.md
└── .gitignore
```

Each HTML page loads three scripts in this order: D3, `assets/js/common.js`, then its own file in `assets/js/pages/`.

The KNIME workflow and Design Book PDF are submitted on Canvas, not kept in this repo.

## Rules

- Only edit your own files. Ask Teammate 1 before changing `assets/css/style.css` or `assets/js/common.js`.
- Never edit files in `data/` by hand. If data needs to change, change the KNIME workflow and re-export.
- Use D3 version 7: `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js`
- Load data with relative paths, e.g. `d3.csv("data/yearly_total.csv", d3.autoType)`, so the site works on Mercury.
- Column names are case sensitive: `Year`, `Month`, `Sex`, `Counterparty` and `Hospitalisations` start with a capital; all others are lower case.
- Use relative paths only (no leading `/`), e.g. `assets/css/style.css`, so links work on Mercury.
- File names are lower case with no spaces.
- Pull before you start work, commit small, clear changes, and write messages that say what changed, e.g. `Add age pyramid to Who page`.
- Credit any code adapted from examples or AI tools in a comment above it.

## Data files

All files are long format with no missing values. Hospitalisations and bed days exclude people who died within 30 days.

| File | Rows | Columns | Page |
| --- | --- | --- | --- |
| yearly_total.csv | 11 | Year, Hospitalisations, bed_days, avg_stay_days | Home |
| who_age_sex.csv | 154 | Year, age_group, Sex, age_order, Hospitalisations, bed_days | Who |
| who_first_nations.csv | 66 | Year, fn_status, remoteness, Hospitalisations, bed_days | Who |
| how_user_counterparty.csv | 996 | Year, road_user, Counterparty, road_user_group, counterparty_group, Hospitalisations, bed_days | How |
| how_user_age.csv | 874 | Year, age_group, road_user, age_order, road_user_group, Hospitalisations, bed_days | How |
| where_state.csv | 88 | Year, state, Hospitalisations, bed_days | Where |
| where_remoteness.csv | 33 | Year, remoteness, Hospitalisations, bed_days | Where |
| trend_month.csv | 132 | Year, Month, month_num, Hospitalisations | Over time |
| trend_year_group.csv | 264 | Year, group, Hospitalisations, group_type | Over time |

Sort helpers: `month_num` (1–12) and `age_order` (1–7) keep months and age groups in the right order.

State and First Nations figures are counts, not population rates. Any chart of them must say so.

## Team

Team name: Group 29

- Chong Jin Cheng
- Soon Mung Hing
- (third member)

## Academic integrity

Generative AI assistance will be acknowledged in the Design Book and relevant source-code comments in accordance with the unit requirements.

## Data source

Bureau of Infrastructure and Transport Research Economics. Hospitalised injury. https://www.bitre.gov.au/resource/road-safety/hospitalised-injury
