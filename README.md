# 🧊 Freebuff Mob Studio

Web-pohjainen, Blockbenchin tyylinen 3D-editori Minecraft-mobien tekemiseen.
Suunniteltu niin, että mobin voi mallintaa helposti (cube-pohjainen editointi,
luurangot/bones, väritys ja tekstuurit) ja viedä suoraan **Bedrock Edition**
-geometryyn tai **Java Edition** -modiin (resource pack -malli).

## Ominaisuudet

- 🟦 3D-näkymä (Three.js) kiertämällä, zoomaamalla ja panoroiden
- 🧱 Kuutioiden lisääminen, muokkaus, kopiointi ja poisto
- 🦴 Luuranko/bone-hierarkia mobin nivelöintiä varten (valitse luu → kiertotyökalu)
- 🎨 **Väri = tekstuurin täyttö**: jokaisella mobilla on aina tekstuuri
  (generoitu automaattisesti kuutioiden väreistä). Kuution värin vaihto
  täyttää sen kasvot tekstuuriin heti
- ✨ **Emissiivinen glow (modimobit)**: mobin oma glow-kerros (pelin
  `glowRenderType`-layer, esim. `maniac_glow.png`, `stalker_animated_eyes.png`,
  `fallen_weaver_glow.png`, `eye_centipede_glow.png`) ladataan
  **emissiveMap**-karttana — silmät ja hehkuvat osat hohtavat valaistuksesta
  riippumatta, täsmälleen kuten pelissä. Pohjatekstuuri pysyy puhtaana pelin
  PNG:nä; hehku tulee omasta emissiivisestä kerroksesta. False Hydralla ei
  ole omaa glow-kerrosta pelissä — sen hehkuvat silmät johdetaan tekstuurin
  kirkkaista pikseleistä (varmistettu pikselianalyysillä).
- 🖌 **UV-editori**: 2D-tekstuurinäkymä, jossa kuutioiden kasvot näkyvät rajauksina.
  Valitse kasvo klikkaamalla, vedä kasvoa siirtääksesi sen UV:tä, **🪣 täytä**
  kasvo valitulla värillä tai maalaa pensselillä (väri + koko säädettävissä)
- 🎬 **Animaatio-timeline**: keyframe-kohtainen luurankojen poseeraus,
  interpolaatio, play/pause (välilyönti), tallentuu autosaveen.
  Mobit voivat tarjota **useita animaatioita** (esim. idle / walk / attack) —
  valitsin animaatiopalkissa vaihtaa niiden välillä
- 🎞️ **Animaatiomanageri**: luo (＋), kopioi (⧉), nimeä (✏) ja poista (🗑)
  animaatioita — kaikki viedään exporttiin. Keyframe-pisteet aikajanalla,
  raahaa piste siirtääksesi keyframet, 📋 Copy/📌 Paste/🪞 Mirror Pose
- 🧱 **Uuden mobin dialogi** (`New` tai pohja-nappi): nimeä mobi ja valitse
  **exportin tiedostonimi (modelId)** ennen aloitusta — modelId generoituu
  automaattisesti nimestä (🔁 synkronoi uudelleen), export-esikatselu
  näyttää tulevan tiedostonimen, ja valitse pohja (Tyhjä / ihmishahmo /
  nelijalkainen / lintu / kala / hämähäkki). Nimi näkyy otsikossa ja
  tallentuu autosaveen + projektitiedostoon
- 🧍 **Mobi-pohjat** (`New Mob Template`): aloita uusi mobi valmiista
  luurangosta — ihmishahmo, nelijalkainen, lintu, kala tai hämähäkki
  (valmiit osat + perusvärit)
- 🔍 **Kirjaston haku + lajittelu**: mob-kirjaston yläpuolella hakukenttä
  (nimi/kuvaus/id), lajitteluvaihtoehdot (**isoimmat ensin** / pienimmät
  ensin / aakkoset — koko lasketaan mobin oikeasta korkeudesta lohkoina
  rest-asennosta) ja **Vain Deep Void** -suodatin. Näkyvien mobien määrä
  päivittyy lennossa (esim. "14 / 74 mobia")
- 👑 **Bossit / Minionit -ryhmittely**: kirjasto jakaa mobit kahteen
  osioon yhdistetyllä pisteytyksellä `korkeus + 0.35×luut + 0.12×kuutiot`
  (raja ≥ 16). 28 bossia (False Hydra, Weaver of Souls, Bringer of
  Despair, Apostle of Catastrophe, Flesh Worm, Giant Shadow Hand…) ja 104
  minionia. Työkaluvihje ja tilapalkki näyttävät tierin, korkeuden ja
  pisteet; tyhjät ryhmät piilotetaan suodatuksen aikana
- 🐘 **Kokoluokka-suodatin**: oma valikko (Jättiläinen ≥8.5 lohkoa / Iso
  4–8.5 / Keskikoko 1.5–4 / Pieni <1.5 — jakauma 11/36/47/38) yhdistyy
  haun ja Deep Void -rajauksen kanssa; jokaisella mob-kortilla on
  kokoluokkamerkki
- 🦊 **Voxel-eläimet — oikeat eläimet neliöiksi**: `tools/voxelize.mjs`
  vokseloi oikeita 3D-eläinmalleja (three.js / Khronos glTF -näytteet,
  CC-BY 4.0) Minecraft-tyylisiksi mobeiksi: lohikäärme (4.5 lohkoa,
  👑 BOSSI), hevonen, kettu, flamingo, papukaija ja haikara (kaikki
  oikeista tekstuureista/väristä, ei keksittyjä). Oma **Voxel-eläimet**
  -suodatin kirjastossa; jokainen kuutio kantaa oikean värin ja editori
  luo tekstuurin (varjostetut sivut + rakeisuus) automaattisesti
- 🪞 **Mirror Copy**: kopioi valittu kuutio tai koko luu peilikuvana
  vastakkaiselle puolelle (x-akselin yli, UV:t peilattu) yhdellä napsulla
- 🖌 **3D-maalaus**: valitse 🖌-työkalu ja maalaa suoraan mallin pintaan —
  tekstuuri (ja UV-editori) päivittyvät reaaliajassa samalla värillä ja
  sivellinkoolla kuin UV-editorissa. Maalaus-tilassa **näkymä on lukittu**
  (ei kierrä/zoomaa), sivellin **leikataan kasvon UV-rectiin** (ei vuoda
  naapurikasvoille) ja raycast maalaa vain **näkyvän pinnan** (ei läpi
  seinän). **Ctrl+Z / Ctrl+Y** kumoaa/tekee uudelleen maalausvedot
  (sekä 3D- että UV-maalauksessa) ennen mallin undo/redoa.
  **🪞-kytkimellä** maalaus peilautuu samaan aikaan vastakkaiselle puolelle
  (right_X ↔ left_X, leg0 ↔ leg1 — sama paritus kuin Mirror Pose) —
  symmetriset silmät/kuviot syntyvät yhdellä vedolla.
  **💉 Väripipetti** poimii värin suoraan mallin pinnasta: klikkaa mallia,
  niin osuman tekstuuriväri asettuu maalausväriksi ja työkalu palaa
  automaattisesti maalaukseen
- ↩️ Undo/redo (Ctrl+Z / Ctrl+Y)
- 💾 Autosave selaimen localStorageen (ei katoa reloadissa)
- 📤 Bedrock-export (geometry.json, UV-offsetit + pivot-konversio), Java-export
  (element-malli rotations + display-osiolla)
- 📸 **Save PNG**: yksi klikkaus → PNG-kuva mobista nykyisestä kamerakulmasta
  (2× supersamplattu, ruudukko/gizmo/valintakorostus piilotetaan automaattisesti
  ja palautetaan). Tiedostonimi `modelId_screenshot.png`
- 📥 Bedrock-import (round-trip testattu)
- 🔬 **UV-varmentaja** (`npm run verify:uv`): tarkistaa jokaisen kirjaston mobin
  kasvojen UV-asettelun automaattisesti — tekstuurin rajat, päällekkäisyydet,
  näkymättömät kuutiot ja pään north-kasvon (naaman) sisältö
- 🧊 **Render-varmentaja** (`npm run verify:render`): varmistaa että 3D-renderöinti
  vastaa mallidataa — jokaisen kuution mesh-keskipisteen pitää olla
  origin+size/2 (BoxGeometry on keskitetty, origin on alakulma). Varmentaa
  myös render-kaavan regressiosuojan ja luuhierarkian (parent-viitteet,
  simuloitu transform-ketju ZYX-rotaatioineen)
- ⚠️ **Runtime-render-varoitus**: jokaisen muokkauksen jälkeen (rebuild,
  gizmo-raahaus, UV-resize) verrataan renderöityä keskipistettä dataan
  (origin+size/2) suoraan selaimessa — jos ero ylittää 0.01, 3D-näkymän
  yläreunaan ilmestyy punainen banneri, joka luettelee virheelliset kuutiot.
  Klikkaa banneria → ensimmäinen virheellinen kuutio valitaan. Vertailu
  tehdään rest-asennossa (animaatio ei peitä virheitä eikä tuota vääriä
  hälytyksiä), kierretty luuketju on pehmeä tapaus kuten verify-renderissä,
  ja raahauksen aikana tarkistus siirtyy raahauksen loppuun (drag-perf)
- 🛠️ **Työkalu-yhdenmukaisuus keskipistelaskennan kanssa**: gizmo-siirto,
  rotaatio ja skaalaus kirjoittavat dataan oikein — skaalaus poltetaan
  kokoon ja geometriaan (mesh-skaala nollataan), luun skaalaus hylätään
  (Bedrock-luilla ei ole skaalaa), koon muokkaus ominaisuusikkunasta
  säilyttää gizmon kiinnityksen, ja origin pyöristetään 3 desimaaliin
  (ei 0.5-ruudukkoon) jotta murto-osainen koko ei siirrä kuutiota
  rebuildissa. Kopio/mirror-copy tuottavat data-render-yhdenmukaisia
  kuutioita (varmistettu selaimessa kierrettyjen kuutioiden kanssa)

## Käyttö

Avaa `index.html` tai käynnistä kehityspalvelin:

```bash
npm install       # asentaa three.js + esbuild (kerran)
npm start         # kehityspalvelin: http://localhost:8080
npm run build:preview   # tekee itsenäisen preview.html:n
```

> 💡 `preview.html` on **täysin itsenäinen** (esbuild bundlaa three.js:n
> sisään) — sen voi avata suoraan kaksoisklikkauksella (file://) ilman
> palvelinta. Tavalliset ES-moduulit eivät toimi file://-protokollalla
> (CORS), joten siksi kaikki on yhdessä tiedostossa.

## 🔍 Tutkimus & referenssit

GitHubista kerättyä aineistoa Deep Void -tyylisistä modpäkeistä, boss-modeista
ja niiden koodista/datasta (mobi/bossi-suunnittelun pohjaksi):

- [**docs/research.md**](docs/research.md) — koottu lista: Deep Void -tyyliset
  modpäkit, avoimen lähdekoodin boss-modit ja entiteettidatan lähteet
- [**docs/bedrock-entity-reference.md**](docs/bedrock-entity-reference.md) —
  Bedrock-bossin rakenne datana (Mojang/bedrock-samples): behavior-packin
  `minecraft:entity` + resource-packin `client_entity` ja miten editorin
  exporttaama `geometry.<id>` liitetään entiteettiin
- [**docs/meetyourfight-analysis.md**](docs/meetyourfight-analysis.md) —
  MeetYourFight-bossimodin koodianalyysi: bossbar, attribuutit, AI-goalit,
  kutsuminen ja loot-tables

> 🦴 **Renderöinti pelin logiikalla:** mobien luut renderöidään HIERARKKISESTI
> (lapsiluut vanhempiensa sisällä, kuten peli ja Blockbench tekevät) ja
> rotaatiot sovelletaan **'ZYX'-järjestyksessä** (Bedrock/GeckoLib-konventio,
> X-akselin rotaatio ensin). Tämä on varmistettu GeckoLibin lähdekoodista
> (BakedAnimationsAdapter kääntää X/Y-etumerkit; prepMatrixForBone = T(pos)·T(pivot)·Rz·Ry·Rx·T(-pivot))
> — ilman tätä moniakseliset asennot menevät "sinne sun tänne".
> GeckoLib-mobien animaatiorotaatio on **additiivinen** geometrian rest-rotaatioon
> (initialSnapshot + keyframe) — siksi skeletonBody (rest 90°) ja kynnet
> (rest ±5–10°) asettuvat oikein.
>
> 🎬 **Aidot animaatiot:** Warden (ja mikä tahansa vanilja-mobi) saa oikeat
> Bedrock-animaationsa `assets/vanilla/animations/`-kansiosta — avainframet
> käännetään suoraan ja proseduraaliset MoLang-kaavat (kuten wardenin kävely)
> näytteistetään tarkoista vaniljakaavoista. Pudota vain geometria + tekstuuri
> + animaatio assets-kansioon ja aja `node tools/generate-vanilla.js`.
>
> 👹 **Oikeat Deep Void -assetit:** kirjastossa on nyt **72 Deep Void -otusta**
> modin JARista tuotuina (modi on MIT-lisenssillä) — oikea GeckoLib-geometria,
> oikeat tekstuurit ja oikeat animaatiot. Mobeilla, joilla pelissä on glow-kerros
> (varmistettu modin layer-luokista: `ManiacLayer` → `maniac_glow.png`,
> `StalkerLayer` → `stalkernew_eyesnsouls.png`, `CentigazeLayer` →
> `eye_centipede_glow.png`, `WeaverOfSoulsBossLayer` → `fallen_weaver_glow.png`,
> `SeekerLayer` → `seeker_glow.png`, `DeathMawLayer` → `death_maw_glow.png`,
> `ForsakenLayer` → `forsaken_glow.png`, `DeathVultureLayer` →
> `death_vulture_glow.png`…), kerros toimii **emissiivisenä emissiveMap-karttana**
> — hehku hohtaa valaistuksesta riippumatta. Modin isoimmat ja hienoimmat otukset:
> - 👁️ **Stalker** (oletusmobi) — modin ikoninen hahmo: pitkä tumma
>   luurankohumanoidi, hehkuvat valkoiset silmät, levitetyt raajat (slowIdle).
> - 🧵 **Weaver of Souls** — varsinainen pääbossi (6 animaatiota).
> - ⛓️ **Chained Weaver** — kahlittu, roikkuva muoto.
> - 🐍 **False Hydra** (107 luuta, 10 animaatiota) — kauhuklassikko
> - ⚔️ **Apostle of Catastrophe** (55 luuta, 23 animaatiota — veitset, teleportti)
> - 🐛 **Eye Centipede** (66 luuta) · 🐝 **Hive Watcher** (56 luuta)
> - 🪽 **Soulseeker (Seeker)** — siipinen sielunmetsästäjä, hehkuvat silmät
> - 🐲 **Alpha Bone Crawler** · 🧟 **Bog Walker** · 🫦 **Everhunger**
> - 🦷 **Death Maw** (+glow) · 😈 **Fool Eater** (+glow) · 👤 **Forsaken** (+glow)
> - 🦅 **Death Vulture** (+glow) · 🪦 **Dooming Tombstone** (+glow)
> - 🖐️ **Giant Shadow Hand** (+glow) · 🌿 **Rooted** (+glow)
> - …ja ~50 muuta (Abductor, Beholder, Bone Crawler, Damned, Devourer,
>   Flesh Worm, Gaoler, Gravekeeper, Harvestmen, Hivemind, Hollowed, Licker,
>   Lurker, Mad Cultist, Mourner, Overseer, Penitent, Prison Guard, Scarecrow,
>   Saw Thrower, Skull Smasher, Spore Spewer, Swarmer, Thumper, Void Fly,
>   Void Watcher, Wanderer…) — yhteensä **72 otusta**, kaikki pelin oikeita.
> Aja `node tools/generate-weaver.js` regenrataksesi. Näille mobeille UV-
> varmentaja käyttää rentoutettuja sääntöjä (`uvRelaxed`): modin alkuperäinen
> UV-pakkaus jakaa alueita tarkoituksella (ketjut, koristenauhat) — rajat,
> tekstuurikoko ja naama tarkistetaan kuitenkin aina.

## Näppäimet

| Näppäin | Toiminto |
|---------|----------|
| `S` | Valintatyökalu |
| `G` | Siirto (move) |
| `R` | Kierto (rotate) |
| `Delete` | Poista valittu |
| `Ctrl+D` | Kopioi valittu kuutio |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Space` | Animaation play/pause |

## Asentotila (Pose)

Animaatiopalkin **✋ Pose**-nappi pysäyttää toiston ja kytkee asentotilan:
aikaa voi raahata liukusäätimestä tai **klikata mihin tahansa kohtaan aikajanaa**
— malli asettuu heti siihen asentoon, eikä animaatio pyöri. Raahaaminen pysäyttää
toiston aina (ei tarvitse erikseen painaa taukoa), ja ▶ käynnistää toiston uudelleen.

**Luiden suora poseeraus 3D:ssä** (asentotilassa): klikkaa kuutiota 3D-näkymässä
→ sen luu valitaan ja **rotate-gizmo** ilmestyy. Kääntele luuta kädellä — jokainen
raahaus **tallentaa asennon keyframeksi automaattisesti** (tai paina **+ Key**
tallentaaksesi asennon käsin valittuun aikaan). Pääset asentotilasta pois ▶:llä.

**Keyframe-pisteet aikajanalla**: jokainen frame, jolla on keyframe jossakin luussa,
piirtyy sinisenä pisteenä liukusäätimelle. **Raahaa pistettä** siirtääksesi sen
keyframen uuteen aikakohtaan (siirtää kaikki saman framen keyframet yhdessä) —
malli päivittyy heti raahauksen mukana. + Key / 🗑 päivittää pisteet automaattisesti.

**Copy / Paste Pose**: **📋 Copy Pose** tallentaa kaikkien luiden nykyisen asennon
leikepöydälle (interpoloitu asento, jos aikana on keyframeja) — **rotaatio ja
positiosiirtymä** (posTracks). Siirry toiseen frameen ja paina **📌 Paste Pose**
— koko asento tallentuu keyframeiksi jokaiseen luuhun yhdellä napsulla. Jos luu
on valittu hierarkiassa/3D:ssä, liimataan **vain se luu** — muuten koko keho.
Myös **Ctrl+C / Ctrl+V** toimivat.

**🪞 Mirror Pose**: peilaa asennon samaan frameen — oikea käsi/jalka → vasen
(ja päinvastoin). Luuparit tunnistetaan automaattisesti nimistä (`right_X` ↔
`left_X`, `leg0` ↔ `leg1` jne.), rotaatio peilataan oikein (pitch säilyy,
yaw/roll kääntyvät) ja myös positiosiirtymät peilautuvat (x-akseli kääntyy).
Symmetrisessä lepoasennossa tulos = "kopioi oikea → vasen".

## Tiedostorakenne

```
index.html              — pääsivu (lataa moduulit)
style.css               — tyylit
js/main.js              — sovelluslogiikka ja 3D-näkymä
js/uv-editor.js         — 2D UV-editori (kasvojen valinta, siirto, maalaus)
js/animation.js         — animaatio-timeline ja keyframet
js/formats/bedrock.js   — Bedrock geometry import/export
js/formats/java.js      — Java Edition -malli export (rotations + display)
js/formats/example.js   — esimerkkimobi
js/mobs/library.js      — mob-kirjasto (vanilja + humanoidi + Deep Void -bossi)
js/mobs/vanilla.js      — vanilja-mobit (generoitu)
js/mobs/deepvoid.js     — Deep Void -hahmot (generoitu): Stalker, Weaver of
                          Souls, Chained Weaver, Stalker (New) — modin OIKEAT
                          assetit (geometria + tekstuuri + animaatiot)
assets/vanilla/         — vanilja-geometriat, -tekstuurit ja -animaatiot (tools/generate-vanilla.js)
assets/deepvoid/        — The Deep Void -modin (MIT) oikeat hahmo-assetit (tools/generate-weaver.js)
js/utils/boxuv.js       — jaettu box-UV-laskenta (3D- ja 2D-näkymä)
js/utils/history.js     — undo/redo
tools/verify-uv.js      — UV-varmentaja (npm run verify:uv)
tools/verify-render.js  — render-varmentaja (npm run verify:render, ajetaan myös buildissa)
tools/generate-vanilla.js — generaattori vanilja-mobeille
tools/generate-weaver.js — Deep Void -hahmogeneraattori: oikea geometria + tekstuuri (+glow) + animaatiot
build-preview.mjs       — leipoo yhden tiedoston (preview.html); ajaa UV-varmentajan
                          automaattisesti ennen rakennusta (build kaatuu jos UV:t murtuu)
tools/fetch-vanilla.js  — hakee vanilja-assetit Mojang/bedrock-samplesista + ZtechNetwork-
                          varakopioista ja päivittää kirjaston (npm run fetch:vanilla)
tools/tga.js            — TGA-dekooderi (Node, RLE + uncompressed, 24/32-bit)
tools/png.js            — PNG-dekooderi/-enkooderi (Node)
tools/bake-sheep-face.js — paistaa lampaan kasvot tekstuuriin (moderni Bedrock
                          1.21.30+ -tekstuuri piirtää kasvot alpha=3:een; ks. alla)
docs/                   — tutkimus ja referenssit (research, Bedrock, MeetYourFight)
```

## Vanilla-assetit yhdellä komennolla

`npm run fetch:vanilla` lataa Mojangin virallisesta `Mojang/bedrock-samples`-reposta
KAIKKI mobien geometriat, tekstuurit ja animaatiot, konvertoi TGA→PNG, paistaa
lampaan kasvot, regeneroi `js/mobs/vanilla.js` ja ajaa UV-varmentajan. Tekstuurit,
joita ei ole sample-repossa, haetaan automaattisesti
`ZtechNetwork/MCBVanillaResourcePack`-varakopiosta (ghast käyttää klassista Java-
tekstuuria, koska moderni 128×64 ei vastaa vanhaa geometriaa).

Uusi mobi kirjastoon = yksi rivi `MOB_CONFIG`iin `tools/generate-vanilla.js`iin —
assetit haetaan automaattisesti. Jalat/kädet johdetaan luunimistä, jos niitä ei
ole määritelty. Kirjastossa on nyt ~60 oikeaa vanilja-mobia (kissa, koira, aksolotli,
mehiläinen, ghast, sula…).

Oikeat animaatiot: ne vanilja-animaatiot, joissa on oikeita keyframeja, tulevat
valitsimeen sellaisinaan (esim. sheep **grazing**, warden **emerge/dig/roar/sniff/
attack/sonic_boom**). Proseduraaliset MoLang-animaatiot (esim. muiden mobien walk)
korvataan generaattorin kävelysyklillä.

## UV-editorin kasvovärit

Kun kuutio on valittuna, sen jokainen kasvo piirtyy UV-editoriin omalla värillään
ja nimilapulla — näet heti mikä tekstuurialue karttaa mihinkin kasvoon:
north=punainen, south=sininen, east=vihreä, west=keltainen, up=syaani, down=magenta.
Väriselite näkyy UV-editorin alla, ja klikattu kasvo korostetaan katkoviivalla.

## Vanilja-mobit kirjastossa

Kirjastossa on oikeat vanilja-mobit Mojangin virallisista geometrioista (Mojang/bedrock-samples):
Chicken, Cow, Creeper, Pig, Rabbit, Sheep, Skeleton, Spider, Villager, Warden, Zombie + Humanoid.

**Huom. lampaasta:** Bedrockin uusin (1.21.30+) sheep-tekstuuri piirtää lampaan kasvot
(2D-`sheep`-materiaalin subsurface-scatteringin takia) alpha-kanavaan arvolla 3 —
tavallisessa renderöijässä se on näkymätön. `tools/bake-sheep-face.js` kopioi kasvot
sheared-pään alueelta villa-pään north-kasvolle (6,38)-(12,44) täydellä alphalla, joten
kasvot näkyvät oikein myös meidän renderöijässä.

## Seuraavat askeleet (ideat)

- Tekstuurin piirtäminen suoraan UV-editorissa eri työkaluilla (suora viiva, taytto)
- Mirror/peilaus-työkalu ja symmetria-editointi
- Mobiili/tablet-tuki
