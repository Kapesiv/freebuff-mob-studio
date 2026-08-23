# Osallistuminen

## Kehitysympäristö

```bash
npm install          # riippuvuudet (kerran)
npm start            # kehityspalvelin http://localhost:8080 (index.html lataa moduulit suoraan)
npm run build:preview  # itsenäinen preview.html (toimii ilman palvelinta, file://)
```

Muutokset `js/`-tiedostoihin näkyvät kehityspalvelimessa päivityksellä;
`preview.html` rakennetaan erikseen.

## Mobi-muutokset ja Esimerkkejä-kuvat

**Mobi-muutos vaatii kuvien päivityksen.** CI:n toistettavuusportti
(`verify:shots` PR:issä) renderöi kuvat tuoreesti ubuntu-runnerilla ja
vertaa niitä committed `examples/*.png`-kuviin toleranssilla — jos ero
ylittää toleranssin, PR ei läpäise.

Kun muutat mobeja (`js/mobs/**`) tai mitään renderöintiä vaikuttavaa
(`js/main.js`, `tools/export-example-shots.mjs`):

```bash
node tools/export-example-shots.mjs --all          # 4 README-mobia × päivä/yö → examples/
node tools/export-example-shots.mjs --library --all # galleria → examples/gallery/ (jos tarpeen)
```

Kuvat kommitoidaan samaan PR:ään. Mainilla mob-muutos ilman kuvia on sallittu
— `example-shots.yml` päivittää kuvat pushin jälkeen automaattisesti.

## Varmentajat

| Komento | Mitä tarkistaa | Vaatimus |
|---|---|---|
| `npm run verify:uv` | UV-asettelu oikeaa tekstuuria vasten kaikille mobeille | — |
| `npm run verify:render` | Jokainen kuutio renderöityy datansa kohdalla, parent-ketjut ehjät | — |
| `npm run verify:anim` | Animaatiot eivät revi luita irti rungosta | — |
| `npm run verify:walk` | Jalkaterät eivät uppoa lattiaan | — |
| `npm run verify:race` | Nopea mobin vaihto tekstuurilatauksen aikana ei ylikirjoita uutta tekstuuria | Chrome |
| `npm run verify:cleanup` | Tallennussiivous: orpo/vanha poistetaan, tuore/aktiivinen säilyy, statusilmoitus näkyy | Chrome |
| `npm run verify:shots` | Esimerkkejä-kuvat toistettavia (tuore renderi = committed) | Chrome |
| `npm run verify:shots-ubuntu` | Sama vertailu ubuntu-kontissa (runnerin alusta) | Docker |

Ajetaan kaikki ennen pushia: PR-portti (`ci.yml`) ajaa samat varmentajat
sekä toistettavuusportin.

## CI

- **`ci.yml`** — jokainen push/PR: kaikki varmentajat, mobi-määrä-badge,
  build + toistettavuusportti (`verify:shots`: PR aina, mainilla ohitetaan
  vain mobi-muutos ilman kuvia).
- **`example-shots.yml`** — mainilla, kun mobit/kuvaustyökalu muuttuvat:
  renderöi kuvat ja committaa ne (vain `examples/*.png`, ei galleriaa).
- **`mob-count.yml`** — päivittää mobi-määrä-badgen (`badges/mobs.json`).

Yksityiskohdat: `docs/build-and-ci.md`.
