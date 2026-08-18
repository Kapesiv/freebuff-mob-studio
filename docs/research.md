# Tutkimus: Deep Void -tyyliset modpäkit, boss-modit ja koodi/data

Kerätty GitHubista — referenssiksi mobien, bossien ja modpackien
suunnitteluun. Päivitetty 2026-08.

## Deep Void -modi itse

- **Wiki (GitHub):** [TroupeMaster/TheDeepVoid](https://github.com/TroupeMaster/TheDeepVoid)
  — virallinen wiki: mobit, biomeet, mekaniikat, lore.
- **Alustat:** NeoForge + Forge. **Huom:** modin koodi on
  **MCreator-generoitua ja suljettua** — lähdekoodia ei ole julkisessa
  repossa, vain wiki. Bossien/mobien "koodidataa" ei siis voi noutaa,
  mutta wiki dokumentoi niiden käytöksen.

## Deep Void -tyyliset modpäkit (horror) GitHubissa

| Modpäkki | Repo | Kuvaus |
|---|---|---|
| **Cursed Walking** | [Samishi0711/Cursed-Walking-Modpack](https://github.com/Samishi0711/Cursed-Walking-Modpack) | Zombi-apokalypsi (8,3M+ latausta). **Sisältää Deep Void -dimension.** Tämä on se paketti, jossa Deep Void oikeasti esiintyy. |
| **All The Horrors** | [emmaexe/all-the-horrors](https://github.com/emmaexe/all-the-horrors) | Horror + QoL + optimointi. Packwiz-pohjainen — koko modilista ja build-konfiguraatio repossa. |
| **TREPIDATION** | [CalaMariGold/TREPIDATION](https://github.com/CalaMariGold/TREPIDATION) | Hades/DOOM Eternal -henkinen horror-roguelike-modpäkki. |

Ei-GitHub mutta lähimmät Deep Void -vastineet: **Whispers in the Void**
ja **Cave Horror Project** (Modrinth).

## Boss-modit avoimella lähdekoodilla (Java)

| Modi | Repo | Mitä tarjoaa |
|---|---|---|
| **Bosses of Mass Destruction** | [barribob/bosses-of-mass-destruction](https://github.com/barribob/bosses-of-mass-destruction) (Fabric) · [Forge-portti](https://github.com/CERBON-MODS/Bosses-of-Mass-Destruction-FORGE) | 4+ bossia (Void Blossom, Obsidilith…): entiteetit, AI-goalit, bossbarit, kutsumisrituaalit. |
| **Meet Your Fight** | [Lykrast/MeetYourFight](https://github.com/Lykrast/MeetYourFight) | 4 bossia + minionit + projektiilit. Analyysi: [meetyourfight-analysis.md](meetyourfight-analysis.md) |
| **The Graveyard** | [finndog/The-Graveyard-Fabric](https://github.com/finndog/The-Graveyard-Fabric) (myös Forge-repo) | Hautausmaa-teemaiset mobit ja bossit — hyvä visuaalinen/malli-referenssi. |
| **ChronoDawn** | [ksoichiro/ChronoDawn](https://github.com/ksoichiro/ChronoDawn) | Dimensiomodi: portaalit, bossitaistelut, aikamanipulaatio (Fabric & Forge). |

Suljettu mutta data-referenssinä käyttökelpoinen: **L_Ender's Cataclysm**
(config-JSON + wiki dokumentoivat bossien statsit ja mekaniikat).

## "Koodidataa" entiteeteistä ja bosseista

| Lähde | Repo/tiedosto | Käyttötarkoitus |
|---|---|---|
| **Bedrock-vanilja** | [Mojang/bedrock-samples](https://github.com/Mojang/bedrock-samples) (`behavior_pack/entities/`, `resource_pack/entity/`) | Viralliset entity-JSONit (mm. ender_dragon, wither, elder_guardian) + client_entity-geometrialinkit. Tiivistelmä: [bedrock-entity-reference.md](bedrock-entity-reference.md) |

> **Oikeat tekstuurit kirjastossa:** vanilja-mobien oikeat geometriat ja
> tekstuurit (mm. **Warden**) on bundlattu mob-kirjastoon `assets/vanilla/`
> -kansiosta `tools/generate-vanilla.js`-skriptillä. Huom: nämä assetit ovat
> Mojangin **Minecraft EULA** -lisenssin alaisia (kuten koko peli) — ei
> kaupalliseen jakeluun ilman ehtojen noudattamista.
| **Vanilja behavior pack -peili** | [ZtechNetwork/MCBVanillaBehaviorPack](https://github.com/ZtechNetwork/MCBVanillaBehaviorPack) | Helposti selattava vanilja behavior data. |
| **Datapack-bossit** | *Brutal Bosses* (CurseForge) | Bossit pelkkänä datapack-JSONna (statsit, kyvyt, loot) ilman Javaa — esimerkki datavetoisesta bossista. |
| **Java + Bedrock -horror** | [Verity-JE-BE-Mod-Minecraft](https://github.com/absorptive-spadefoottoad898/Verity-JE-BE-Mod-Minecraft) | Sama horror-entiteetti (AI-dialogi, adaptiivinen käytös) molemmille alustoille. |

## Johtopäätökset tämän editorin kannalta

1. **Bedrock-entity-JSONit** (`Mojang/bedrock-samples`) ovat paras referenssi
   sille, miten editorin exporttaama `geometry.<id>` liitetään elävään
   entiteettiin (client_entity → geometry + behavior → boss/health/AI).
2. **MeetYourFight / BoMD** näyttävät Java-bossin kokonaiskuvan: bossbar,
   attribuutit, AI-goalit, kutsuminen, loot.
3. **The Graveyard** on hyvä malli-referenssi visuaaliseen suunnitteluun.
4. Deep Voidin oma koodi ei ole avointa — mutta sen **wiki** antaa
   käytöksellisen kuvauksen mobeista, jotka voi toteuttaa itse.

---

## ✅ Toteutettu: Weaver Of Souls (oikea bossi editorissa)

**Faktat, joihin toteutus perustuu** (ei omaa designia — pelin omat assetit):

- **Bossi:** *Weaver Of Souls* — "viimeinen kutojamestari, joka elää edelleen
  **kahlittuna** muinaiseen hautaan, ympäröitynä käsityönsä uhreista"
  (virallinen wiki, Bosses-sivu). 500 HP / 12 vahinkoa / 10 panssaria,
  löytyy Sepulcherista (0,1,0); 9 osumaa rikkoo kahleet. Taustamusiikki:
  *Darkmare* (DARK FANTASY STUDIO).
- **Lähde:** modin JAR (v1.98.1, Modrinth) — modi on **MIT-lisenssillä**, eli
  assetit ovat käytettävissä. JARista purettiin:
  - `assets/the_deep_void/geo/chainedweaver.geo.json` + `fallenweaver.geo.json`
    (GeckoLib/Bedrock-geometria — 49 luuta, 59 kuutiota)
  - `textures/entities/chainedweaver.png`, `fallenweaver.png` (256×256),
    `fallen_weaver_glow.png` (glow-kerros — emissiivisenä karttana, katso alta)
  - `animations/chainedweaver.animation.json` + `fallenweaver.animation.json`
    (vector-keyframet — idle/walk/stun/death/attack/aggressive + kahlittu idle)
- **Toteutus:** `tools/generate-weaver.js` → `js/mobs/deepvoid.js`. Malli
  skaalataan ja siirretään jalkoihin, UV-rectit pidetään alkuperäisellä
  koolla (`uvSize`), positiotrackit skaalataan. Editorin animaatiojärjestelmä
  sai **positiotuki-tuen** (Bedrockin `position`-keyframet) — ilman sitä
  kahlittu bossi ei voisi roikkua.
- **Kirjastossa:** 🧵 **Weaver of Souls** (taistelumuoto, 6 animaatiota) ja
  ⛓️ **Chained Weaver** (kahlittu, roikkuva).

**Kaksi mallia = kaksi muotoa** (geometriat ovat identtiset, tekstuurit
hieman eri): kahlittu versio on Sepulcherissa kahleissa roikkuva, vapautettu
(fallen) taistelee. Mallissa on 4 uhrien luurankoa kiinnitettynä kehoon —
wiki: "ympäröitynä käsityönsä uhreista".

---

## ✅ Toteutettu: Stalker (modin ikoninen hahmo — oletusmobi)

Käyttäjän referenssikuva (GitHub-repon preview, 820×586) on **Stalker** —
README:n "Surprise Stalker attack !!" -kuva. Fakta (modin JAR, v1.98.1):

- **Luokka-analyysi** (dekompiloitu `StalkerModel.class`): nykymodin stalker
  käyttää `geo/stalkernew.geo.json` + `stalkernew.animation.json` +
  `textures/entities/stalkernew.png` + `stalkernew_eyesnsouls.png` (glow-kerros),
  animaatiot `animation.stalker_idle/aggressive/attack`.
- **Referenssikuva** (levitetyt siipimäiset raajat) vastaa kuitenkin **vanhaa**
  `stalker.geo.json`-mallia (19 luuta, 47 kuutiota, x-väli −41..41): sen
  `slowIdle`-animaatio levittää raajat (left_arm [-180,17.5,-270] jne.).
  Tekstuuri `stalker_animated.png` (128×128) + `stalker_animated_eyes.png`
  (hehkuvat valkoiset silmät — 2 valkoista pikseliä pään pohjoiskasvolla).
- **Toteutus:** sama `tools/generate-weaver.js`-pipeline → kirjastossa
  👁️ **Stalker** (oletusmobi, slowIdle = referenssiasento) ja
  🕷️ **Stalker (New)** (10 animaatiota).
- **Löydökset pipelineen:** 0-leveyskuutioiden (kynnet) degenerate-kasvot
  sallitaan UV-varmentajassa (`tools/verify-uv.js`) — ne eivät peitä pikseleitä,
  ja modin alkuperäisessä UV-pakkauksessa ne menevät muiden alueiden päälle.

---

## ✅ Toteutettu: kaikki Deep Void -entiteetit (72 otusta)

Käytiin koko modin JAR läpi: jokaiseen `entity/model/*Model.class`-luokkaan
kirjoitettu geo-tiedosto (esim. `geo/bogwalker.geo.json`) yhdistettiin
entity-luokan registry-id:hen (tekstuuri = `textures/entities/{id}.png`,
esim. AlphaBoneCrawlerEntity → `alphacrawlerremodelnew`) ja vastaavaan
animaatiotiedostoon. Tällä tavalla löydettiin **58 uutta kokonaista otusta**
(geo + tekstuuri + animaatiot) edellisten 14:n lisäksi — yhteensä **72**.

Käyttäjän nimeämät erikoistapaukset:
- **Soulseeker**: nykymodin Seeker (`geo/seeker.geo.json` + `seeker.png` +
  `seeker_glow.png` + 6 animaatiota). Vanhat `soulseekervoid`/`soulwings`
  -tiedostot ovat tynkiä (1 luu, 16×16) / armor-lisäosa — ei kokonaisia
  entiteettejä.
- **Alpha Bone Crawler**: AlphaBoneCrawlerEntity → registry `alphacrawlerremodelnew`
  → `geo/alphacrawlerremodel.geo.json` + `alphacrawlerremodelnew.png` (256×256).

Glow-kerrokset lisättiin emissiivisinä karttoina sinne, missä pelin
layer-luokat niitä käyttävät (Seeker, Death Maw, Fool Eater, Forsaken,
Death Vulture, Tombstone, Giant Shadow Hand, Rooted).

**Bossi/minioni-ryhmittely** (kirjaston 👑-osiot): jokaiselle mobille
lasketaan pisteytys `korkeus + 0.35×luut + 0.12×kuutiot`, raja ≥ 16 =
BOSSI. Aineistosta varmistettu luonnollinen raja: 28 bossia (False Hydra
66.7 p, Weaver 32.9, Bringer, Apostle, Flesh Worm 35.5, Giant Shadow Hand
19.3…) vs. 104 minionia (Void Tentacle 12.6, Ghast 12.3, Soulseeker 12.1…).
Vanilja-mobien korkeudet jaetaan 16:lla, jotta ne vertautuvat Deep Voidin
lohkoasteikkoon oikein.

Modin isoimmat/hienoimmat (edellisen kierroksen lista):

| Mobi | Luut | Kuutiot | Animaatiot | Huom |
|---|---|---|---|---|
| 🐍 **False Hydra** | 107 | 123 | 10 (scream, arms, volley…) | Kauhuklassikko: monipäinen hirviö |
| 💀 **Bringer of Despair** | 64 | 135 | 11 (shoot, thrust, dance…) | Ketjukoristeet jakavat UV:n tarkoituksella |
| 🐛 **Eye Centipede** | 66 | 118 | 5 (hidden, crawlOut…) | 256×256-tekstuuri |
| ⚔️ **Apostle of Catastrophe** | 55 | 58 | 23 (block, pierce, teleport…) | Veitsiä heittelevä bossi |
| 🐝 **Hive Watcher** | 56 | 87 | 5 (spin, glide, spawn…) | Suupielet läpinäkyviä modin omassa datassa |
| 🏹 **Hunter** | 52 | 64 | 7 (shoot, jump, swim…) | Jousimies |
| 🦴 **Primordial Bone Crawler** | 32 | 52 | 14 (fly, dashJump, slam…) | Lentävä luinen peto; alaleuka läpinäkyvä modin datassa |
| 👁️ **Cave Nightmare** | 30 | 55 | 10 (idleStealth, despawn…) | Hiipii stealth-asennossa |
| 🔪 **Maniac** | 18 | 49 | 6 | Konekivääriputki, glow-silmät |
| 🪓 **Executioner** | 14 | 83 | 8 (grab, slash, bash…) | Kirvesteloittaja |

**UV-varmentaja modimobeille (`uvRelaxed`):** nämä ovat modin ORIGINAALIA
dataa — modi pakkaa UV:t tarkoituksella päällekkäin (ketjut jakavat saman
tekstuurin, koristenauhat kulkevat muiden alueiden yli) ja osa koristeista
on läpinäkyviä (esim. primordialin alaleuka uv (176,27) on modin omassa
tekstuurissa tyhjä — renderöityy pelissäkin näkymättömänä). Varmentaja
skippaa näille overlap-/läpinäkyvyysvirheet, mutta tarkistaa AINA rajat,
tekstuurikoon ja naaman. Löydetyt modi-artefaktit dokumentoitiin koodiin.

---

## ✅ Renderöinti pelin logiikalla ("osat sinne sun tänne" -korjaus)

**Ongelma:** luut renderöitiin litteästi (kaikki scenen lapsina) ja rotaatiot
THREE:n oletusjärjestyksellä ('XYZ') — moniakseliset asennot (kuten
stalkerin `left_arm [-180,17.5,-270]`) hajosivat: raajat irtosivat
vartalosta ja menivät eri asentoihin kuin pelissä.

**Löydetyt faktat (lähdekoodista, ei arvauksesta):**

1. **Hierarkia:** Blockbench (`outliner.js` NodePreviewController.updateTransform)
   lisää jokaisen luun meshin VANHEMPANSA meshiin (`parent.mesh.add(mesh)`)
   ja vähentää lapsen positionista vanhemman originin. Sama tekee GeckoLib
   (`renderRecursively` = lapsi vanhemman poseStackin sisällä). Editori
   tekee nyt samoin: lapsen ryhmä on vanhemman sisällä kohdassa
   `pivot − parentPivot`, kuutiot kohdassa `origin − pivot`.
2. **Rotaatiojärjestys 'ZYX':** GeckoLib `RenderUtils.prepMatrixForBone` =
   `T(pos)·T(pivot)·Rz·Ry·Rx·T(−pivot)` — PoseStackin oikeakertominen
   tarkoittaa että X-rotaatio sovelletaan ensin vektoriin = THREE:n
   Euler-järjestys **'ZYX'**. Blockbenchin `Format.euler_order`-oletus on
   myös 'ZYX'. THREE:n oletus 'XYZ' on päinvastainen — siitä raajojen
   hajoaminen.
3. **Etumerkit:** `BakedAnimationsAdapter` (GeckoLib) kääntää animaatiorotaation
   X- ja Y-arvot (`−rx, −ry, rz`) ja koko malli peilataan X-akselissa
   (`BakedModelFactory`) — nettoefekti on täsmälleen X-peilattu Bedrock-asento,
   joten editori (Bedrock-avaruus) käyttää raaka-arvoja sellaisinaan.
4. **Additiivinen rotaatio:** `AnimationProcessor` tekee
   `setRotX(lerp(rotX) + initialSnapshot.getRotX())` — GeckoLib LISÄÄ
   animaatiorotaation geometrian rest-rotaatioon. Siksi luut joilla on
   nollasta poikkeava rest (skeletonBody [0,90,0], stalkerin kynnet ±5–10°)
   vaativat additiivisen käsittelyn (vanilja-Bedrock korvaa, mutta siellä
   rest on nollia → ei eroa).
5. **Positio:** `translateMatrixToBone` = `T(−posX, posY, posZ)` — positiotrackit
   ovat OFFSETTEJA pivotin päälle vanhemman avaruudessa (editori: `base + track`).

**Toteutus:** `js/main.js` (hierarkkinen rebuildModel, 'ZYX'), `js/animation.js`
(additiivinen rotaatio, parent-relatiivinen positio), `js/formats/bedrock.js`
(parseri säilyttää `parent`-kentän), `tools/generate-weaver.js`
(`additiveRotation`-lippu + hierarkkinen computeFit THREE:lla).

**Varmistettu livenä:** stalkerin slowIdle (vasen käsi ylös, oikea alas —
pelin oikea epäsymmetrinen asento), attack (hyökkäys), weaverin idle
(4 luurankouhria rinnassa), chained weaverin roikkuminen (body −90°),
wardenin kävely (jalat ±25.8°). Rotaatiojärjestys ja additiivisuus
vastaavat nyt GeckoLibia täsmälleen.

---

## ✅ Toteutettu: Emissiivinen glow-kerros (modimobien hehku)

**Ongelma:** aiemmin glow-kerros poltettiin pohjatekstuuriin
(`compositeGlow`) — silmät näkyivät kirkkaina, mutta eivät HOHTANEET:
ne tummuivat valaistuksen mukana kuten mikä tahansa pintaväri.

**Faktat (modin layer-luokista, dekompiloitu):**

- `ManiacRenderer` → `ManiacLayer` → `textures/entities/maniac_glow.png`
- `StalkerRenderer` → `StalkerLayer` → `textures/entities/stalkernew_eyesnsouls.png`
- `WatchingStalkerRenderer` → `WatchingStalkerLayer` → `stalkernew_eyes.png`
- `WeaverOfSoulsBossRenderer` → `WeaverOfSoulsBossLayer` → `fallen_weaver_glow.png`
- `CentigazeLayer` / `CentigazeHiddenLayer` → `eye_centipede_glow.png`
- False Hydralla EI ole glow-layeria (rendererissä ei ole addRenderLayer-kutsua)
  — sen hehkuvat silmät ovat valmiiksi valkoisina pohjatekstuurissa
  (pikselianalyysi: 51 kirkasta pikseliä yhdessä silmäalueessa (156–167, 1–17)).

**Toteutus:**

1. Generaattori (`tools/generate-weaver.js`) tekee nyt **erillisen emissiivisen
   kartan**: glow-kerroksen pikselit (alfa ≥ 8) sellaisinaan, muu musta —
   `emissiveDataURL`. Pohjatekstuuri pysyy **puhtaana pelin PNG:nä**
   (ei polttoa), aivan kuten peli renderöi (pohja + glow-kerros päällä).
   False Hydralle kartta johdetaan tekstuurin kirkkaista pikseleistä
   (`deriveEmissive`, luminanssi ≥ 0.75) — ei keksittyä dataa, vaan pelin
   omat valkoiset silmäpikselit.
2. Editori (`js/main.js`): mobin `emissiveDataURL` ladataan
   **emissiveMap**-karttana (MeshStandardMaterial: `emissive 0xffffff`,
   `emissiveIntensity 1.0`). Emissiivinen kanava lisätään valaistuksen
   JÄLKEEN — silmät hohtavat täysin valaistuksesta riippumatta, kuten pelin
   `glowRenderType` (RenderType.eyes). Autosave/save-tiedostot säilyttävät
   kartan (avain bumpattu v5:een).

**Varmistettu livenä (pikselitason renderöintimittauksella):** stalkerin
valkoiset silmät (2 pikseliä pään pohjoiskasvolla) renderöityvät maxLum
255:een; maniac 763 kirkasta pikseliä; eye centipeden segmentit hohtavat
(1983 kirkasta pikseliä). Huom: pelin mobien kasvot osoittavat −Z:aan
(north), joten edestä katselu vaatii kameran −Z-puolelle.

---

## ✅ Voxeloidut oikeat eläimet (lohikäärme + eläimet kirjastossa)

**Kysymys:** voitaisiinko oikeista eläimistä toteuttaa mobeja, jotka
muutetaan neliöiksi ja Minecraftin näköisiksi?

**Vastaus: kyllä — ja se on toteutettu** (`tools/voxelize.mjs`):

1. **Lähdemallit:** oikeat 3D-eläinmallit three.js -esimerkeistä ja
   Khronos glTF-Sample-Assetsista (CC-BY 4.0): **DragonAttenuation**
   (lohikäärme), Horse, Fox, Flamingo, Parrot, Stork. Kenney Animal Pack
   on 2D (ei sovellu); Quaternius-paketit eivät ole suoraan ladattavissa;
   poly.pizza vaatii kirjautumisen. Legendary Monsters -modissa EI ole
   lohikäärmeitä (Java-malleja, ei geo.json) ja Ice and Fire -lohikäärmeet
   ovat Java-luokkia — siksi reitti on vokselointi CC-BY-malleista.
2. **GLB-parseri ilman kolmannen osapuolen kirjastoja:** node-hierarkia +
   maailmanmatriisit, POSITION/COLOR_0/TEXCOORD_0-accessorit, materiaalin
   baseColorFactor, upotetut PNG-tekstuurit (oma zlib-unfiltteröinti) ja
   JPEG-tekstuurit (sips-konversio). Tekstuurit sampletaan UV:stä —
   värit ovat MALLIN OIKEITA värejä, ei keksittyjä.
3. **Vokselointi:** pintasolut etäisyydellä kolmioista (< 1 voxel),
   ulkopuoli tulvii reunasta (flood fill), sisäosa = loput. Värit
   täytetään pylväittäin pinnalta. Y-juoksut yhdistetään laatikoksi.
4. **Bedrock-geometria:** 16 yksikköä = 1 lohko; malli keskitetään X/Z:aan,
   jalat y=0:aan, käännetään −Z:aan (pelin konventio). Jokainen kuutio
   kantaa oikean värin + hyllypakatun UV-offsetin (kokonaislukuoffsetit +
   1 px rako — estää liukulukuoverlapit UV-varmentajassa). Editori luo
   tekstuurin automaattisesti (varjostetut sivut + rakeisuus).
5. **Kamera:** jokaiselle mobille lasketaan `fit` (keskipiste + säde).

**Tulokset:** Voxel Dragon 1153 kuutiota / 4.5 lohkoa (👑 BOSSI), Horse
293 / 2.2, Fox 109 / 1.1 (oranssi + kerma, 14 väriä), Flamingo 148 / 1.6,
Parrot 99 / 1.0, Stork 246 / 1.8. Kaikki kirjastossa `Voxel-eläimet`
-suodattimen alla; UV- ja render-varmentajat menevät läpi; varmistettu
livenä (lohikäärme harmaana kivisenä, kettu oranssina).

## ✅ Vokselimobien automaattinen luujako + animaatiot (18.8.2026)

`tools/voxel-parts.mjs` jakaa vokseliristikon **geometrisesti** luihin ilman
solmuinformaatiota (lähde-GLB:issä ei ole hyödyllisiä solmunimiä):

- **Pedestali pois**: tasainen taustalevy (dragonin "Cloth Backdrop") leikataan
  pohjasta ennen luokittelua.
- **Suuntaus**: ylhäältä alkava BFS-probe löytää pään; jos pää on −Z-puolella,
  ruudukko flipataan (pää → +Z → maailmassa −Z eli eteen).
- **Jalat**: maanpinnan kapeat pylväät kasvavat ylöspäin (leveys ≤7 solua);
  leveät pitkät blobit (lohikäärmeen kyljet, joissa etu+takajalka sulautuvat)
  jaetaan etu/taka -osiin rungon z-keskipisteestä.
- **Pää**: BFS alaspäin, pysähtyy kun poikkileikkaus täyttää ≥60 % mallin
  ulottuvuudesta.
- **Siivet**: tiheän ydinrungon ulkopuoliset x-pylväät yläalueella; ryhmitelty
  per puoli. **≥60 solua + molemmat puolet** = oikeat siivet; sirpaleet
  (lohikäärme 21) sulautetaan vartaloon, ettei irtonainen läppä heilu.
- **Häntä**: z-probe pysähtyy kun poikkileikkaus täyttää ≥60 % — mutta vain
  jos probe **oikeasti pysähtyi** (ei kävellyt läpi koko rungon; pienten
  lintujen kohdalla probe läpäisee → häntää ei eroteta, kaikki jää
  vartaloon). Tämä korjasi storkin, jonka probe söi koko rungon.

**Animaatiot** (editorin formaatti, 20 fps):
- `idle` (60 fr): rungon hengitys ±1.5°, pään katselu (nyökkäys + kääntö),
  hännän heilunta rotation.y ±4°.
- `walk` (40 fr): ristikkäiset jalkaparit ±22° rotation.x (positiivinen =
  eteen −Z:aan), rungon keinunta + bob (posTracks), pään vastaliike,
  hännän sivuhuilaus ±6°.
- `fly` (40 fr): lentoonlähtö + räpyttely. Siipien alas-isku on
  synkronoitu jalkojen painonottoon (12/32): x-siivet rullaavat ±26°
  rotation.z (vasen −, oikea +), taaksepäin laskostetut z-siivet
  (lohikäärme, haikara) pitchaavat −26°…+26° rotation.x samaan tahtiin.
  Jalat tekevät lentoonlähtöjuoksun (vuorottaiset askeleet) SAMALLA
  lattia-kompensoinnilla kuin walkissa (dipAt + nosto) — lentoonlähdössä
  jalkaterät eivät uppoa maahan. Vartalo nyökkää alas-iskuun ja kohoaa
  työnnöllä; pää vastanyökkää.

**Z-laskostetut (taaksepäin) siivet** — lohikäärmeen laskostetut siivet
olivat aiemmin x-pylväsetsinnän ulottumattomissa (2 solua paksuja,
z-suuntaan pitkiä sivulaattoja, jotka imeytyivät vartaloon). Uusi
`findZSweptWings` löytää ne: sivulaatta rungon tiheän x-ytimen
ulkopuolelta, paksuus 2–5 solua, pituus ≥30 % mallin pituudesta, ≤15 %
leveydestä ja maan yläpuolella. Rungon 1-solun kylkisolut (wolf/lion/
horse), maassa olevat reisimassat ja dino's T-rex-kyynärvarret (2 solua
8 leveässä mallissa = 25 %) eivät osu rajoihin — vain oikeat siivet.
Lisäksi korjattu siipityypin tunnistus: laskostetun siiven vertailu oli
Set-identiteettivertailu (aina false) — nyt sisältöpohjainen (zSwept ≥ 70 %
sivun klusterista) → lohikäärmeen siivet pitchaavat pystysuunnassa
oikean lentoliikkeen sijaan rullauksen.

**Varmistettu livenä**: jokainen 6 mobista latautuu (lohikäärme 7 luuta/710
kuutiota, hevonen 8/367, kettu 7/150, flamingo 8/180, papukaija 5/126,
haikara 8/329 + fly), rot-, pos- ja siipitrackit lukevat oikein asteina
(left_front +22° f0 ↔ −22° f20, siivet −22° ylös ↔ +22° alas), jalkaterät
liikkuvat vastakkaisissa vaiheissa, pixelitason vertailu f0/f20 näyttää
12 % pikseleistä muuttuvan (siipien räpyttely), konsoli puhdas, UV-varmentaja
läpäisee.

## ✅ Oma malli → vokselointi suoraan selaimessa (drag & drop) (18.8.2026)

Kirjaston pohjaan lisättiin pudotusalue (`js/voxelizer.js`): käyttäjä voi
vetää minkä tahansa GLB/OBJ-mallin ja se vokseloidaan **selaimessa** ilman
Node-työkaluja.

**Selainportti** (sama putki kuin `tools/voxelize.mjs`, matematiikka
synkronissa):
- GLB-parseri + **PNG-dekoodaus `DecompressionStream('deflate')`-putkella**
  (oma unfilter-looppi, kaikki 5 PNG-filteriä) ja JPEG `createImageBitmap` +
  canvas → ImageData. Tekstuurit sampletaan UV:stä — värit ovat mallin
  oikeita värejä.
- OBJ-parseri: v/vt/f (fan-triangulointi), `usemtl` + mukana pudotettu .mtl
  (Kd-värit) ja map_Kd-tekstuuri (jos kuva pudotettu mukaan).
- Luokittelija **jaetaan Node-generaattorin kanssa**: `tools/voxel-parts.mjs`
  on puhdasta ESM:ää (ei Node-importteja), joten esbuild bundlaa sen
  suoraan selaimelle. Ainoa rivi joka tarvitsi korjauksen: `process.env`
  -debug-tarkistus → `typeof process !== 'undefined' && …`.

**Korjattu matkan varrella:**
- Selainversiosta puuttui korkeusreskaala (targetHeightUnits) → malli jäi
  alkuperäiskokoonsa; lisätty sama `factor`-lasku kuin CLI:ssä.
- OBJ-kasvojen indeksit ovat [vi, ti]-pareja — verts-haku käytti taulukkoa
  indeksinä → 0 kolmiota; korjattu `f.a[0]`-hakuun.
- `dropPedestal` söi **tasaiset muodot** (esim. pelkkä laatikko): se pudotti
  kerroksia niin kauan kuin ne olivat leveitä, ja laatikon jokainen kerros
  on yhtä leveä → koko malli katosi. Uusi sääntö: pohjalevy pudotetaan vain
  jos jalkajälki **kaventuu jyrkästi** ylempänä (≤3 kerroksen sisällä
  <70 % leveydestä) — laatikko säilyy, lohikäärmeen "Cloth Backdrop" poistuu.

**Varmistettu livenä** (synteettinen drop-tapahtuma, oikea käyttäjäpolku):
- GLB (test-quad, 7 laatikkoa): 8 luuta (vartalo + pää + 4 jalkaa + häntä),
  154 kuutiota, täsmälleen pyydetty korkeus (2 lohkoa), idle+walk, lisätty
  kirjastoon (139. mobi) oikein metadataan (2 lohkoa, ⚔️ minioni, 🧍 Keskikoko).
- OBJ (test-box): 648 kuutiota, 2 lohkoa, latautuu editoriin.
- Pixelitason tarkistus: malli renderöityy (koko canvas valaistu), konsoli
  puhdas, build + UV-varmentaja menevät läpi.

## 📊 Deep Void -bossi-statit (pelin bytecodesta, versio 1.98.1)

Statit purettiin suoraan modin `.class`-tiedostoista (ei wikitietoa — Deep Voidilla
ei ole omaa wikiä). Putki:

1. `tools/read-mob-stats.py` — JVM-luokkaparserit ilman JVM:ää (constant pool + opcode-walker).
2. `tools/scan-attributes.py` — `createAttributes`-metodin arvot slotittain.
   Slottien tunnistus on empiirinen fakta: MCreator generoi SAMAAN järjestykseen
   jokaiselle entiteetille [speed, health, armor, toughness, follow, knockback, (damage/fly)].
   Jakautumat varmistavat tulkinnan: health 7–999 (bossit korkeat), speed 0.17–0.5,
   knockback 0–999 (999 = bossi), flySpeed vain lentäjillä.
3. `tools/scan-entity-facts.py` — `registerGoals` → AI-kyvyt, `<init>` → bossbar
   (ServerBossEvent-konstruktio), animaatiokontrollerien nimet.
4. `assets/the_deep_void/lang/en_us.json` → oikeat rekisteri-id:t kutsumista varten.

### Varmistetut bossiarvot (bytecode → MAX_HEALTH)

| Mobi | HP | sydämet | bossbar | muuta |
|---|---|---|---|---|
| Apostle of Catastrophe | 720 | 360 | ✅ | armor 14, follow 74 |
| False Hydra | 600 | 300 | ✅ | armor 10, follow 48, knockback 999 |
| Primordial Bone Crawler | 600 | 300 | ✅ | armor 14, knockback 999 |
| Weaver of Souls | 500 | 250 | ✅ | armor 8, toughness 12, damage 4 |
| Stalker | 500 | 250 | ❌ | speed 0.4, follow 100 |
| Flesh Worm | 500 | 250 | ❌ | armor 15, knockback 999 |
| Misanthropic Hivemind | 420 | 210 | ✅ | armor 17, damage 6.5 |
| Hive's Watcher | 440 | 220 | ✅ | knockback 999 |
| Executioner | 350 | 175 | ❌ | armor 15, knockback 99 |
| Everhunger | 300 | 150 | ❌ | follow 80 |
| Saw Thrower | 180 | 90 | ❌ | knockback 999 |
| Skull Smasher | 160 | 80 | ❌ | knockback 999 |

Huom: False Hydran `<init>`-metodissa näkyvä `sipush 250` EI ole HP — oikea
maksimielämä on `createAttributes`in 600.0 (bossbar-progress päivittyy
`m_8024_`:ssä getHealth/getMaxHealth -kutsuilla).

## Vokselimobien korjauskierros (CC0-eläimet + kasassa pysyvä luusto)

**Uudet CC0-lähteet (Poly Pizza, CC0, upotetut PNG-tekstuurit):**
karhu (BlackBear, 445 tri), susi, leijona, tiikeri, dinosaurus ja uusi
lohikäärme. Poly Pizza -latauskaava: `static.poly.pizza/<uuid>.glb.br`
(huom: tiedosto on oikeasti tavallinen GLB, vain päätteessä ".br").

**Löydetyt luokittelubugit ja korjaukset (`tools/voxel-parts.mjs`):**

1. **Nelijalkaisten väärät "siivet"** — karhu/susi/leijona/tiikeri saivat
   swept-wings-luokittelun: kuono + takamus näyttivät z-probeista siiviltä.
   Korjaus: swept-wings vain lintumaisille malleille (leveys > 1.6 × korkeus).
   Nyt z-probe = häntä, kuono jää vartaloon. Varmistettu: susi 4 jalkaa
   (95–99 solua per jalka) + häntä 38, leijona 4 jalkaa + häntä 64.

2. **Lentävän linnun siivet "jalkoina"** — papukaija (lentävä, siivet
   levällään) sai siipensä jaloiksi, koska siivet ulottuvat maatasoon.
   Korjaus: lintumaisten mallien jalkoja ei etsitä maasta; x-pylväät
   luokitellaan siiviksi. Papukaija: siipi + häntä + pää erottuvat nyt.
   Haikara säilytti molemmat z-siipensä (fly-animaatio toimii).

3. **Flamingon suunta** — pään tunnistus nappasi hännän (joka yltää
   ylös), joten flip ei lauennut; jalkojen uusi lintu-ehto korjasi tämän
   (head -z-päähän, vanilja-konvention mukaisesti).

4. **Lohikäärme**: vanha DragonAttenuation (harmaakivipatsas, "pylväs")
   korvattu CC0-vihreä/punainen lohikäärmeellä — pää, 4 jalkaa ja iso
   takakäyrä (häntä). 1427 kuutiota, 10 luuta.

**Kasassa pysyminen varmistettu numerisesti:**
`tools/check-anim-detach.mjs` simuloi editorin matriisiketjun (hierarkia +
ZYX-rotaatiot + animaatiot) jokaiselle keyframelle ja varmistaa, ettei
yksikään luu irtoa rungosta (kaikki 11 mobia × idle/walk/fly läpäisevät).
Myös render- ja UV-varmentajat vihreät; selaimen drag & drop -vokselointi
toimii edelleen (testi-GLB: 8 luuta, 154 kuutiota, 2 lohkoa).
