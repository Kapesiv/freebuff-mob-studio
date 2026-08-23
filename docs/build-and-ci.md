# Build ja CI

Mitä README:n badgejen takana on ja miten `preview.html` syntyy.

## Paikallinen kehitys

| Komento | Mitä tekee |
|---|---|
| `npm install` | Asentaa riippuvuudet (three.js, esbuild) — kerran. |
| `npm start` | Käynnistää kehityspalvelimen osoitteeseen http://localhost:8080 (`python3 -m http.server 8080`). `index.html` lataa moduulit suoraan lähdekoodista importmapilla, joten muutokset näkyvät päivityksellä ilman buildia. |
| `npm run build:preview` | Rakentaa itsenäisen `preview.html`:n (katso alta). |
| `npm run verify:uv` | UV-varmentaja — katso CI-taulukko. |
| `npm run verify:render` | Render-varmentaja — katso CI-taulukko. |
| `npm run verify:anim` | Animaatio-varmentaja — katso CI-taulukko. |
| `npm run verify:walk` | Kävely-varmentaja — katso CI-taulukko. |
| `npm run verify:race` | Race-varmentaja — ajaa oikean preview.html:n headless Chromessa: Image-konstruktori mockataan, jotta vanhan mobin tekstuurilataus pysyy varmasti kesken mobin vaihdon, ja sitten vapautetaan — vanha tekstuuri ei saa ylikirjoittaa uutta mobia. Vaatii Chromen (CI asentaa sen). |
| `npm run verify:cleanup` | Tallennussiivous-varmentaja — headless Chromessa `?mob=allay`-deeplinkillä: localStorageen kirjoitetaan ennen sovellusmoduulia testiavaimet (orpo / yli 30 pv / tuore / aikaleimaton / aktiivinen + tavallinen autosave + Omat olennot) ja tarkistetaan, että siivous poistaa vain oikeat: orpo ja vanha pois, tuore ja aktiivinen (päivittyneenä) säilyvät, statusilmoitus näkyy. Vaatii Chromen. |
| `npm run verify:shots` | Toistettavuusvarmentaja (natiivi): renderöi kuvat scratch-kansioon ja vertaa repo-versioihin toleransseilla. Vertaa sekä README-kuvat (`examples/*.png`) että koko gallerian (`examples/gallery/*.png`). Vaatii Chromen. |
| `npm run verify:shots-ubuntu` | Sama vertailu ubuntu-kontissa (samoilla vaiheilla kuin CI) — varmistaa että kuvat ovat toistettavia myös runnerilla. Vaatii Dockerin — katso alta. |
| `npm run fetch:vanilla` | Lataa vanilja-mobien geometriat, tekstuurit ja animaatiot Mojangin bedrock-samples-reposta (TGA→PNG) ja regeneroi `js/mobs/vanilla.js`. Uusi mobi kirjastoon = yksi rivi `MOB_CONFIG`iin. |

`index.html` on kehitysversio (lataa moduulit verkon yli) — siksi se tarvitsee
palvelimen. `preview.html` on buildin tuotos ja toimii ilman palvelinta.

## Miten preview.html rakennetaan

`npm run build:preview` ajaa `build-preview.mjs`:

1. **Ensin varmentajat.** `verify:render` ja `verify:uv` ajetaan ennen bundlausta.
   Jos kumpikaan kaatuu, build pysähtyy — rikkinäinen data ei pääse
   preview.html:ään.
2. **esbuild bundlaa** `js/main.js`:n + three.js:n + lisäosat yhdeksi
   moduuliskriptiksi. Ei importmapia, ei CDN:ää — file://-avaus ei kaadu
   CORS:iin.
3. `style.css` upotetaan `<style>`-lohkona sisään.
4. Tuloksena yksi itsenäinen `preview.html`, joka toimii ilman palvelinta
   (kaksoisklikkaus riittää).

## Mitä CI tarkistaa

Build-status-badge kertoo `.github/workflows/ci.yml`-tilanteen. Workflow
ajetaan joka pushilla mainiin ja jokaisella pull requestilla. Vaiheet:

| Vaihe | Mitä tarkistaa |
|---|---|
| `verify:uv` | UV-asettelu jokaiselle kirjaston mobille oikeaa tekstuuria vasten: kasvojen rectit tekstuurin sisällä, rectit eivät mene päällekkäin (peiliparit saavat), mikään kuutio ei ole kokonaan läpinäkyvällä alueella, pään etukasvolla on tarpeeksi värejä että se näyttää kasvoilta |
| `verify:render` | 7578 kuutiota / 148 mobia: jokainen kuutio renderöityy datansa kohdalla (origin + koko/2), mallitieto on äärellistä ja parent-ketjut ehjiä. Vartioi myös editorin render-kaavoja, jotka ovat joskus hajonneet |
| `verify:anim` | Vokselimobien animaatiot eivät revi luita irti rungosta — simuloi jokaisen keyframen matriisiketjun |
| `verify:walk` | Jalkaterät eivät uppoa lattiaan — mittaa oikealla THREE.js-rigillä, ettei yksikään jalka painu alle −0.5 yksikön |
| `verify:race` | E2E headless Chromessa: Image-mock pitää oletusmobin (Stalkerin) tekstuurilatauksen kesken, käyttäjä klikkaa toisen mobin, ja vasta sitten vanha lataus vapautetaan — tekstuurin pitää pysyä uuden mobin omana (tämä löysi aiemmin oikean kilpailutilanne-bugin, jossa myöhässä saapuva onload ylikirjoitti juuri klikatun mobin tekstuurin) |
| `verify:cleanup` | E2E headless Chromessa: ennen sovellusmoduulia localStorageen kirjoitetaan testiavaimet ja `?mob=allay`-deeplink käynnistää bootin — siivouksen pitää poistaa orpo ja yli 30 pv vanhat tallennukset (deeplink + tavallinen autosave + Omat olennot), säilyttää tuoreet ja aikaleimattomat sekä AKTIIVISEN avaimen (päivittyneenä), ja statusrivin pitää kertoa lukumäärä. Rikottu ikäraja → 3 tarkistusta kaatuu, exit 1 |
| `verify:shots` (PR + main) | Toistettavuusportti: ubuntu-runnerin tuore renderi (scratch-kansioon, `--out`) verrataan repo-versioihin (`examples/*.png`) toleransseilla. PR:ssä aina — mob-muutos vaatii kuvien päivityksen mukaan. Mainilla ohitetaan vain jos push koskettaa mobeja/kuvaustyökalua mutta EI `examples/`-kuvia (ne päivittää `example-shots.yml` pushin jälkeen → vertailu vanhentuneita kuvia vastaan olisi väärä punainen); kaikissa muissa tapauksissa ajetaan, myös `example-shots.yml`:n omassa kuvakommitissa |
| `build:preview` | Rakentaa preview.html:n (ajaa siis verify:uv + verify:render uudelleen) |
| artifact | preview.html ladataan build-artefaktina |

Mobi-määrä-badge ei tule CI:stä vaan omasta workflowsta:
`.github/workflows/mob-count.yml` laskee mobit `tools/mob-count.mjs`-skriptillä
aina kun `js/mobs/**` muuttuu ja committaa tuloksen `badges/mobs.json`
-tiedostoon. Badge lukee tiedoston shields.io-endpointilla, joten luku
pysyy ajan tasalla ilman käsin päivitystä.

"Toimii ilman palvelinta" -badge on staattinen ja linkittää `preview.html`
-tiedostoon. Lisenssi-badge on GitHubin oma tunnistus LICENSE-tiedostosta.

## Esimerkkejä-kuvat

`examples/*.png` (900×900) eivät ole kuvankäsittelyä — ne renderöi
`node tools/export-example-shots.mjs --all` (4 mobia × päivä/yö). Työkalu
avaa `preview.html`-tiedoston headless Chromessa ja ohjaa sitä DevTools
Protocolin yli — sama THREE.js-renderöintiprosessi kuin editorissa:

1. **Mobi ladataan** kirjaston kortista (`loadLibraryMob`), jolloin tekstuuri,
   glow-kerros ja Game Preview (vihreä maa, varjot, hehku) tulevat päälle.
   `--night`-lipulla kytketään yötila (`setGamePreviewNight`), jolloin glow
   hehkuu voimakkaammin.
2. **Tekstuurin lataus odotetaan** — `applyTextureDataURL` lataa PNG:n
   asynkronisesti; lisäksi odotetaan, että sovelluksen oletusmobin oma
   lataus on ehtinyt asettua (race-suojaus `js/main.js`:ssä estää vanhan
   mobin kuvan ylikirjoittamasta uuden mobin tekstuuria).
3. **Rajaus lasketaan mallista**: kuutioiden kulmat muunnetaan
   maailmakoordinaatteihin meshin `matrixWorld`-matriisilla (plain-JS
   matriisilasku, THREE:tä ei tarvita sivulla) → bbox → center + radius.
4. **Kamera**: neliökuvasuhde, etäisyys `radius · 2.6 + 2`, 3/4-kuva edestä
   (sama sijoittelu kuin `fitCameraToMob`), `lookAt(center)`.
5. **Renderöinti**: `setPixelRatio(1)` + `setSize(900, 900)` + tausta
   `#24292f` → `renderer.domElement.toDataURL()` → PNG näytölle →
   `Page.captureScreenshot` (900×900, `Emulation.setDeviceMetricsOverride`).
6. **Tallennus**: PNG kirjoitetaan suoraan `examples/<id>.png`-tiedostoksi.

Koko kirjaston galleria syntyy samalla työkalulla:

```bash
node tools/export-example-shots.mjs --library          # kaikki 143 mobia → examples/gallery/
node tools/export-example-shots.mjs --library --all    # + yöversiot
node tools/export-example-shots.mjs --library --category=deepvoid   # vain yksi kategoria
node tools/export-example-shots.mjs --library --jobs=4 # 4 Chromea rinnakkain (~2 min)
```

`--library` kirjoittaa kuvat `examples/gallery/`-kansioon ja generoi sinne
`index.html`-galleriasivun, jossa mobit on ryhmitelty kategorioittain ja
☀️/🌙 -vaihto näyttää yöversiot. Kuvat uusiutuvat automaattisesti CI:ssä
(`example-shots.yml`), kun kirjaston mobit tai kuvauslogiikka muuttuvat.
Jokainen kuva on lisäksi varmistettu silmämääräisesti ennen hyväksyntää.

### Ubuntu-kontissa toistettava vertailu

`npm run verify:shots-ubuntu` (`tools/verify-example-shots-ubuntu.mjs`)
ajaa samat vaiheet kuin CI-workflow ubuntu-kontissa ja vertaa kuvat
repo-versioihin pikselitarkasti — tämä varmistaa, että kuvat ovat
toistettavia myös runnerilla, ei vain paikallisella koneella:

1. Rakennetaan (tai käytetään uudelleen) konttikuva `ubuntu:22.04` +
   Node 22 + Google Chrome (deb) — sama asennus kuin `example-shots.yml`.
2. Kontti kopioi repon, ajaa `npm ci` → `npm run build:preview` →
   `node tools/export-example-shots.mjs --all` (repo read-only-mountilla,
   työtila temp-kansiossa).
3. Vertailu puhtaalla Node-PNG-dekooderilla (ei riippuvuuksia): sama
   tiedostosarja, samat kuvakoot, ja jokaiselle kuvalle toleranssit:
   max kanavapoikkeama (oletus 12), diff-osuus (oletus ≤ 2 %) ja MEA
   (oletus ≤ 2). Epäonnistuessa exit-koodi 1.

Liput: `--rebuild-image` (pakota kuvan uudelleenrakennus),
`--tolerance=N --max-diff-pct=N --max-mea=N` (toleranssit),
`--keep` (pidä työtila), `--no-platform-pin` (älä pakota amd64-emulaatiota).
Apple Siliconilla amd64-emulaatio on hidas — koko ajo vie 3–6 min.

Ilman Dockeria sama vertailu ajetaan natiivisti: `npm run verify:shots`
renderöi kuvat väliaikaiskansioon (`--out`-lipulla työkalu ei koske
`examples/`-kansioon) ja vertaa repo-versioihin samoilla toleransseilla.
Vertailu on kaksiosainen:

1. **README-kuvat** (`examples/*.png`) — 4 mobia × päivä/yö (`--all`).
2. **Galleria** (`examples/gallery/*.png`) — koko kirjasto renderöidään
   `--library`-lipulla `--jobs`-rinnakkaisuudella (oletus 4, ~2 min
   natiivina). Yöversiot renderöidään vain jos repo-galleriassa niitä on.
   Ohitus: `--skip-gallery` (vain README-kuvat, nopea tarkistus).

Molemmat työkalut jakavat vertailulogiikan (`tools/lib/compare-shots.mjs`),
joten toleranssit ja raportointi ovat samat joka alustalla. Kun portti löytää
vanhentuneita kuvia, päivitä ne renderöimällä uudelleen
(`node tools/export-example-shots.mjs --all` ja `--library --all`).

### CI:n commit+push ja push-loop

Workflow'n commit-vaihe ajaa `git add examples/*.png` — siis **vain
renderöidyt README-kuvat** (8 tiedostoa), ei `examples/gallery/`-kansiota
eikä muita tiedostoja. Epäonnistunut renderöinti pysäyttää jobin ennen
committia (työkalu asettaa `process.exitCode = 1`), joten osittaista
kuvasarjaa ei koskaan kommitoida.

Push-loop on estetty `paths`-suodattimella: workflow käynnistyy vain kun
`js/mobs/**`, `tools/export-example-shots.mjs` tai `js/main.js` muuttuu.
Oma commit+push koskettaa vain `examples/**` (mukaan lukien
`examples/gallery/`, jos sitä joskus päivitetään CI:ssä `--library`-ajolla),
joten se ei koskaan täsmää trigger-polkuhin → ei uutta ajoa. Lisäksi
`concurrency`-ryhmä sarjallistaa ajot, jotta kaksi päällekkäistä ajoa ei
kilpaile `git push`ista.
