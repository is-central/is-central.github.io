# Gacha simulator data

`gen.py` builds `src/components/GachaSim/data.json` (banners, operators, availability dates) and downloads the operator
portraits into `public/gacha-sim/ops/`. It needs three source files in one folder:

- `gacha.json`, `char.json` — `en_US/gamedata/excel/gacha_table.json` and `character_table.json` from
  github.com/Kengxxiao/ArknightsGameData_YoStar
- `cn.json` — `zh_CN/gamedata/excel/character_table.json` from github.com/Kengxxiao/ArknightsGameData (only needed for
  operators newer than the EN mirror; listed by hand in `MANUAL` inside `gen.py`)

Run: `python3 gen.py <folder with the three json files> ../../src/components/GachaSim/data.json ../../public/gacha-sim/ops`

To add a banner, append a line to `banners.txt` (`type|name|start|end|operators`, type is `lt`, `lim` or `link`;
operator names as on arknights.wiki.gg), add any brand-new operator to `release.txt` (name|EN release date|limited Y/N),
and re-run. Banner dates and rate-up lists come from https://arknights.wiki.gg/wiki/Headhunting/Banners.
