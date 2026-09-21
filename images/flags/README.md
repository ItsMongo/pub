# images/flags

Flag SVGs referenced by `items.flag_image` (stored as the exact path, e.g. `images/flags/ca.svg`).
**Don't rename files** — the database stores the literal filename.

- **`xx.svg`** (two-letter ISO 3166 code, plus `gb-eng`, `gb-sct`, `gb-wls`, `gb-nir`, `eu`, `un`, `xk`):
  [flag-icons](https://github.com/lipis/flag-icons), MIT license (see `LICENSE-flag-icons.txt`),
  all on one 640x480 (4:3) canvas.
- **Named files** (`nazi-germany`, `soviet-union`, `yugoslavia`, `east-germany`, `german-empire`,
  `austria-hungary`): historical states with no ISO code, from Wikimedia Commons (national flags).
  Czechoslovakia (1920-1992) used the same design as today's Czech flag, so use `cz.svg`.
- **`index.json`**: name / aliases / file for every flag here — look up a country there.

To add another flag: `https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/<code>.svg`
