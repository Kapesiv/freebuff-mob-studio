## Mitä muuttui

<!-- Lyhyt kuvaus muutoksesta ja miksi. -->

## Muutos koskee

- [ ] Mobi/assetit (`js/mobs/**`, tekstuurit, animaatiot)
- [ ] Editori/toiminnallisuus (`js/main.js`, `js/utils/**`)
- [ ] Esimerkkejä-kuvat (`examples/**`)
- [ ] CI/työkalut (`.github/**`, `tools/**`)
- [ ] Dokumentaatio

## ⚠️ Mobi-muutos? Päivitä kuvat — muuten `verify:shots` ei läpäise

Toistettavuusportti vertaa committed `examples/*.png`-kuvat ubuntu-runnerin
tuoreeseen renderiin toleranssilla. Mobi-muutos (tai mikä tahansa
renderöintiä muuttava muutos: `js/main.js`, `tools/export-example-shots.mjs`)
muuttaa kuvat — päivitä ne samaan PR:ään:

```bash
node tools/export-example-shots.mjs --all   # 4 README-mobia × päivä/yö
```

Jos myös galleriakuvat muuttuivat:

```bash
node tools/export-example-shots.mjs --library --all
```

## Varmentajat (ajetaan paikallisesti ennen pushia)

- [ ] `npm run verify:uv`
- [ ] `npm run verify:render`
- [ ] `npm run verify:anim`
- [ ] `npm run verify:walk`
- [ ] `npm run verify:race` (vaatii Chromen)
- [ ] `npm run verify:cleanup` (vaatii Chromen)
- [ ] `npm run verify:shots` (vaatii Chromen — toistettavuusportti)

## Screenshot / esikatselu

<!-- Visuaalisessa muutoksessa: ennen/jälkeen-kuva tai linkki preview'iin. -->
