# MeetYourFight — bossimodin koodianalyysi

Lähde: [Lykrast/MeetYourFight](https://github.com/Lykrast/MeetYourFight)
(Forge, Java). Mod lisää 4 bossia, joita vastaan taistellaan
kutsumaesineillä; jokaisesta saa uniikkeja aseita/panssareita/curioksia.
Analyysi perustuu master-haaran lähdekoodiin.

## Bossit ja entiteetit

Rekisteröity `registry/MYFEntities.java`:

| Entiteetti | Tyyppi | Koko (w×h) |
|---|---|---|
| `bellringer` | Bossi | 0.6 × 1.95 |
| `dame_fortuna` | Bossi | 0.6 × 2.325 |
| `swampjaw` | Bossi | 2.6 × 1.6 |
| `rosalyne` | Bossi | 0.6 × 1.95 |
| `rose_spirit` | Minion (summon) | 0.75 × 1.3125 |
| `projectile_line`, `projectile_targeted`, `fortuna_bomb`, `fortuna_card`, `swamp_mine` | Ammukset/loukut | ~0.3–2.5 |

Bossit rekisteröidään `EntityType.Builder.of(..., MobCategory.MONSTER)`
- `.setUpdateInterval(1)` — entiteetti päivittyy joka tikissä
- `.setTrackingRange(128)` — bossit näkyvät kauas (muut: 64)
- Ominaisuudet (`createAttributes()`) rekisteröidään erikseen
  `EntityAttributeCreationEvent`-tapahtumassa.

## Bossin kanta: `entity/BossEntity.java`

Kaikki bossit perivät `BossEntity extends Monster`. Tämä on ydinkuvio, jota
mikä tahansa Java-bossi tarvitsee:

```java
private final ServerBossEvent bossInfo =
    new ServerBossEvent(getDisplayName(), BossEvent.BossBarColor.RED,
                        BossEvent.BossBarOverlay.PROGRESS);

// Bossbarin täyttyminen = HP-suhde, päivittyy joka serveritikki
@Override
protected void customServerAiStep() {
    super.customServerAiStep();
    bossInfo.setProgress(getHealth() / getMaxHealth());
}

// Pelaajat liitetään/irrotetaan bossbarista kun he tulevat näköpiiriin
@Override
public void startSeenByPlayer(ServerPlayer player) {
    super.startSeenByPlayer(player);
    bossInfo.addPlayer(player);
}
@Override
public void stopSeenByPlayer(ServerPlayer player) {
    super.stopSeenByPlayer(player);
    bossInfo.removePlayer(player);
}

// Bossi ei voi vaihtaa dimensiota (ei paeta portaaleilla)
@Override
public boolean canChangeDimensions() { return false; }

// Oma boss-musiikki: readSpawnData() toistaa getMusic()-äänen
// (idea kopioitu Botanian Dopplegangerista)
```

## Kutsuminen: `item/SummonItem.java`

Bossit eivät spawnaa luonnossa — pelaaja kutsuu ne esineellä:

1. `use()` → pelaaja alkaa "käyttää" esinettä (20 tikkiä, jousen animaatio).
2. `finishUsingItem()`:
   - Tarkistaa, ettei 32 säteen sisällä ole jo elävää bossia
     (`Tags.EntityTypes.BOSSES`).
   - Kutsuu `spawner.spawn(player, world)` (funktionaalinen rajapinta
     `BossSpawner`, jonka jokainen bossi toteuttaa omalla tavallaan).
   - Kuluttaa yhden esineen (ei luovassa tilassa).
3. Config voi ohittaa vaatimukset (`wasConfig`-lippu tooltipissä).

## AI: `entity/ai/`

Modi ei käytä vain vanilja-goaleja vaan omia, pieniä goal-luokkia:

- `MoveAroundTarget` / `MoveAroundTargetOrthogonal` — kiertää kohdetta
- `MoveFrontOfTarget` — pysyy kohteen edessä (esim. haukkamaiseen hyökkäykseen)
- `StationaryAttack` — pysähtyy paikalleen hyökätäkseen
- `PhantomAttackPlayer` — syöksyhyökkäys (phantom-tyyliin)
- `VexMoveRandomGoal` + `VexMovementController` — leijuminen lentävälle bossille

Jokainen bossi (esim. `BellringerEntity`, `DameFortunaEntity`,
`SwampjawEntity`, `RosalyneEntity`) kokoaa nämä goalit `registerGoals()`-
metodiin ja lisää oman hyökkäyslogiikkansa (projektiilit: `ProjectileLineEntity`,
`ProjectileTargetedEntity`, `FortunaBombEntity`, `FortunaCardEntity`,
`SwampMineEntity`).

## Data: loot-tables (JSON)

Loot on datapack-JSON, ei koodia — esim. Bellringer
(`data/meetyourfight/loot_tables/entities/bellringer.json`):

```json
{
  "type": "minecraft:entity",
  "pools": [
    { "name": "phantoplasm", "rolls": 1, "entries": [
        { "type": "minecraft:item", "name": "meetyourfight:phantoplasm", "weight": 1 }
    ]},
    { "name": "gold", "rolls": 1, "entries": [
        { "type": "minecraft:item", "name": "minecraft:gold_ingot", "weight": 1,
          "functions": [
            { "function": "minecraft:set_count", "count": { "min": 3, "max": 4, "type": "minecraft:uniform" } },
            { "function": "minecraft:looting_enchant", "count": { "min": 0, "max": 1 } }
          ]
        }
    ]}
  ]
}
```

## Mallit: Java-koodattuja, ei Blockbench-JSONeja

Mallit (`renderer/*.java`, esim. `SwampjawModel.java`, `DameFortunaModel.java`)
rakennetaan `LayerDefinition`-APIlla koodissa — toisin kuin tässä editorissa,
jossa malli on JSON (Bedrock-geometria) ja visualisoidaan suoraan. Tämä on
hyvä muistutus siitä, miksi editorin Bedrock-export on hyödyllinen: Java-mallin
kirjoittaminen käsin on työlästä, mutta sama BoxGeometry-rakenne voidaan viedä
geometria-JSONina ja liittää client_entity-tiedostolla.

## Yhteenveto: mitä bossi tarvitsee (Java-puolella)

1. **Entity-luokka** → `Monster` + bossbar (`ServerBossEvent`), dimensio-lukko.
2. **Attribuutit** → `createAttributes()` (HP, hyökkäys, nopeus, knockback-res).
3. **Rekisteröinti** → `EntityType` (koko, tracking range) + attributes-eventti.
4. **AI-goalit** → `registerGoals()`: liikkuminen, hyökkäykset, projektiilit.
5. **Kutsuminen** → esine, joka spawnaa bossin (ja estää tuplabossit).
6. **Loot** → datapack-JSON (`loot_tables/entities/<boss>.json`).
7. **Malli/renderöinti** → `LayerDefinition`-malli + `EntityRenderer` +
   mahdollinen glow-layer (`GenericGlowLayer`, `RosalyneGlowLayer`).
