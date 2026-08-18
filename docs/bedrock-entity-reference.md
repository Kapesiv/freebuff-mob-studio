# Bedrock bossi-entiteettidatan referenssi

Tämä dokumentti tiivistää, miten Minecraft Bedrock Editionissa määritellään
bossi-entiteetti **datana (JSON)** — lähde: Mojangin virallinen
[`Mojang/bedrock-samples`](https://github.com/Mojang/bedrock-samples) -repo,
jossa on kaikki vanilja behavior- ja resource-packit.

Kun tällä editorilla exporttaa Bedrock-geometrian, se on vain puolet
työstä: jotta mobi elää pelissä, se tarvitsee (1) behavior packin
`entities/<nimi>.json` (mitä se tekee) ja (2) resource packin
`entity/<nimi>.entity.json` (miten se renderöityy + mikä geometria siihen
sidotaan).

## Mistä data löytyy

| Tiedosto | Sisältö |
|---|---|
| `behavior_pack/entities/ender_dragon.json` | Ender Dragon -bossin käytös (referenssi) |
| `behavior_pack/entities/wither.json` | Wither (referenssi) |
| `behavior_pack/entities/elder_guardian.json` | Elder Guardian (minibossi) |
| `resource_pack/entity/ender_dragon.entity.json` | Dragonin client-määrittely (renderöinti + geometria) |

## Behavior pack: `entities/ender_dragon.json`

Rakenne on aina sama: `format_version` → `minecraft:entity` →
`description` + `components` (+ valinnaiset `component_groups` ja `events`).

```jsonc
{
  "format_version": "1.26.0",
  "minecraft:entity": {
    "description": {
      "identifier": "minecraft:ender_dragon",
      "is_summonable": true,
      "is_spawnable": true,
      "spawn_category": "monster"
    },
    "components": {
      "minecraft:attack": { "damage": 3 },
      "minecraft:boss": {
        "hud_range": 125,          // bossbar näkyy tältä etäisyydeltä
        "should_darken_sky": false // taivas tummenee bossin lähellä
      },
      "minecraft:collision_box": { "height": 4, "width": 13 },
      "minecraft:health": { "max": 200, "value": 200 },
      "minecraft:knockback_resistance": { "max": 100, "value": 100 },
      "minecraft:flying_speed": { "value": 0.6 },
      "minecraft:movement": { "value": 0.3 },
      "minecraft:fire_immune": {},
      "minecraft:dimension_bound": {},          // ei voi vaihtaa dimensiota
      "minecraft:physics": { "has_collision": false, "has_gravity": false },
      "minecraft:type_family": { "family": ["dragon", "mob"] },
      "minecraft:on_death": { "event": "minecraft:start_death", "target": "self" }
    },
    "component_groups": {
      "dragon_flying": {
        "minecraft:behavior.dragonchargeplayer": { "priority": 1 },
        "minecraft:behavior.dragonstrafeplayer": { "priority": 2 },
        "minecraft:behavior.dragonholdingpattern": { "priority": 3 },
        "minecraft:shooter": { "def": "minecraft:dragon_fireball" }
      },
      "dragon_sitting": {
        "minecraft:behavior.dragonflaming": { "priority": 1 },
        "minecraft:behavior.dragonlanding": { "priority": 0 }
      },
      "dragon_death": {
        "minecraft:behavior.dragondeath": { "priority": 0 }
      }
    },
    "events": {
      "minecraft:entity_spawned": {
        "add": { "component_groups": ["dragon_flying"] },
        "remove": {}
      },
      "minecraft:start_fly": {
        "add": { "component_groups": ["dragon_flying"] },
        "remove": { "component_groups": ["dragon_sitting"] }
      },
      "minecraft:start_land": {
        "add": { "component_groups": ["dragon_sitting"] },
        "remove": { "component_groups": ["dragon_flying"] }
      },
      "minecraft:start_death": {
        "add": { "component_groups": ["dragon_death"] },
        "remove": { "component_groups": ["dragon_sitting", "dragon_flying"] }
      }
    }
  }
}
```

### Avainkomponentit — mitä jokainen tekee

| Komponentti | Tarkoitus |
|---|---|
| `minecraft:boss` | Bossbar: `hud_range` = näkyvyysetäisyys, `should_darken_sky` |
| `minecraft:health` | Max HP (`max` + `value`) |
| `minecraft:attack` | Perusiskun vahinko |
| `minecraft:knockback_resistance` | Työntöresistenttiys (bossit: 100) |
| `minecraft:collision_box` | Fyysinen koko |
| `minecraft:type_family` | Perhe/tagit, joihin muut mekaniikat viittaavat |
| `minecraft:behavior.*` | AI-goalit (prioriteettijärjestyksessä, pienin = tärkein) |
| `minecraft:shooter` | Ammus, jota bossi ampuu (esim. `minecraft:dragon_fireball`) |
| `minecraft:dimension_bound` | Bossi ei seuraa pelaajaa dimensioiden yli |
| `minecraft:on_death` | Tapahtuma, joka käynnistyy kuollessa (esim. kuolinsinema) |
| `minecraft:persistent` | Ei despawnaa |
| `minecraft:physics` | `has_gravity: false` = lentävä bossi |

**Component_groups + events** ovat Bedrockin tapa toteuttaa "faset": bossi
vaihtaa käytösryhmää tapahtumien avulla (spawn → lentää, laskeutuu → istuu,
kuolee → kuolinanimaatio). Tämä vastaa Java-puolen `BossEvent`/AI-state -
ajattelua.

## Resource pack: `resource_pack/entity/ender_dragon.entity.json`

Client-puoli kertoo **mikä geometria ja tekstuuri** entiteetille piirretään —
tämä on kohta, johon tämän editorin Bedrock-export kytketään:

```jsonc
{
  "format_version": "1.10.0",
  "minecraft:client_entity": {
    "description": {
      "identifier": "minecraft:ender_dragon",
      "materials": { "default": "ender_dragon" },
      "textures": { "default": "textures/entity/dragon/dragon" },
      "geometry": { "default": "geometry.dragon" },   // ← tämä linkki!
      "scripts": {
        "pre_animation": [
          // MoLang: esim. siipien räpyttely query.wing_flap_position -muuttujasta
          "variable.flap_time = query.wing_flap_position * 360.0;"
        ]
      }
    }
  }
}
```

## Miten tämä liittyy editorin exporttiin

1. Editorin **Export Bedrock** tuottaa `geometry.json`-tiedoston, jonka avain
   on `geometry.<modelId>` (esim. `geometry.void_warden`) ja jossa on
   `description.identifier` samalla nimellä.
2. Sijoita se resource packiin: `models/entity/<nimi>.geometry.json`.
3. Luo `entity/<nimi>.entity.json`, jonka `geometry.default` viittaa
   **samaan** tunnisteeseen: `"default": "geometry.void_warden"`.
4. Luo behavior packiin `entities/<nimi>.json` yllä olevan rakenteen
   mukaisesti (bossi: `minecraft:boss` + `minecraft:health` + AI-goalit).
5. Jos geometriassa on animoitavia luurankoja, niitä liikutetaan clientin
   `animations`-osiolla (animatioiden nimet viittaavat luiden nimiin) tai
   `pre_animation`-MoLangilla — tässä editorissa tehdyt keyframe-animaatiot
   voi viedä pohjaksi ja muuttaa Bedrock-animaatioformaatiksi.

## Lisää referenssidataa

- Vanilja-spawnisäännöt: `behavior_pack/spawn_rules/` (esim.
  `ender_dragon.json` → miten ja missä bossi spawnaa).
- Loot: `behavior_pack/loot_tables/entities/` (dragon: `ender_dragon.json`).
- Witherin kaksivaiheinen taistelu (`minecraft:behavior.wither_random_attack_pos`,
  `minecraft:boss` + `minecraft:on_death`) on hyvä esimerkki fasetoidusta bossista.
