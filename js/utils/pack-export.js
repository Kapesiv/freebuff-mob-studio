/**
 * Resurssipaketin kokoaja — kokoaa mallin, tekstuurit ja animaatiot
 * valmiiksi kansiorakenteeksi, joka menee suoraan peliin:
 *
 *   ☕ Java (GeckoLib-modit):
 *     pack.mcmeta
 *     assets/<ns>/geo/<id>.geo.json
 *     assets/<ns>/animations/<id>.animation.json
 *     assets/<ns>/textures/entity/<id>.png
 *     assets/<ns>/textures/entity/<id>_glow.png         (jos glow)
 *     assets/freebuff/models/item/<id>.json            (Java-edition item-malli)
 *     assets/freebuff/textures/item/<id>.png
 *
 *   🎮 Bedrock (addon — resource_pack + behavior_pack, tuodaan suoraan
 *      Minecraftiin; mobi spawnaa heti):
 *     resource_pack/manifest.json
 *     resource_pack/entity/<id>.entity.json            (client-entity)
 *     resource_pack/models/entity/<id>.geo.json
 *     resource_pack/render_controllers/<id>.render_controllers.json
 *     resource_pack/textures/entity/<id>.png
 *     resource_pack/textures/entity/<id>_glow.png      (jos glow)
 *     resource_pack/animations/<id>.animation.json     (jos animaatioita)
 *     behavior_pack/manifest.json                      (riippuvuus RP:stä)
 *     behavior_pack/entities/<id>.json                 (behavior-entity)
 *     behavior_pack/spawn_rules/<id>.json              (spawn-säännöt)
 */
import { exportBedrockGeometry } from '../formats/bedrock.js';
import { exportJavaModel } from '../formats/java.js';
import { exportBedrockAnimations, exportJavaAnimations } from '../formats/animation.js';

const enc = new TextEncoder();

function jsonBytes(obj) {
    return enc.encode(JSON.stringify(obj, null, 2));
}

/** PNG-kuva Uint8Array:na canvasista tai dataURL:stä. */
export function pngBytesFromTexture(textureCanvas) {
    if (!textureCanvas) return null;
    let dataUrl = typeof textureCanvas.toDataURL === 'function'
        ? textureCanvas.toDataURL('image/png')
        : textureCanvas;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) return null;
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

function bedrockManifest(name, moduleUuid) {
    return {
        format_version: 2,
        header: {
            name: `${name} (Freebuff Mob Studio)`,
            description: 'Malli, tekstuurit ja animaatiot — Freebuff Mob Studio',
            uuid: uuid(),
            version: [1, 0, 0],
            min_engine_version: [1, 16, 0],
        },
        modules: [
            { type: 'resources', uuid: moduleUuid || uuid(), version: [1, 0, 0] },
        ],
    };
}

function behaviorManifest(name, rpModuleUuid) {
    return {
        format_version: 2,
        header: {
            name: `${name} Behavior (Freebuff Mob Studio)`,
            description: 'Mobin käyttäytyminen ja spawn — Freebuff Mob Studio',
            uuid: uuid(),
            version: [1, 0, 0],
            min_engine_version: [1, 16, 0],
        },
        modules: [
            { type: 'data', uuid: uuid(), version: [1, 0, 0] },
        ],
        dependencies: [
            { uuid: rpModuleUuid, version: [1, 0, 0] },
        ],
    };
}

function packMcmeta(name) {
    return {
        pack: {
            pack_format: 15,
            description: `Freebuff Mob Studio — ${name}`,
        },
    };
}

/** Datapakin pack.mcmeta (pack_format 48 = Java 1.21). */
function datapackMcmeta(name) {
    return {
        pack: {
            pack_format: 48,
            description: `Freebuff Mob Studio — ${name} (summon + spawn)`,
        },
    };
}

/**
 * Paper-item override: paper + custom_model_data 1001 → mobin malli.
 * Toimii Java 1.19.4–1.21.4 (1.21.5+ käyttää components-predikaattia).
 */
function paperOverride(id) {
    return {
        parent: 'minecraft:item/generated',
        overrides: [
            { predicate: { custom_model_data: 1001 }, model: `freebuff:item/${id}` },
        ],
    };
}

/**
 * Summon-funktio: nimetty armor stand, joka kantaa mallia paperina.
 * Java ei voi luoda uutta entity-tyyppiä datapaketista, joten tämä on
 * vanilla-tapa "spawnata mobi komennolla heti". GeckoLib-modissa oikea
 * mobi olisi /summon <modid>:<id>.
 */
function summonFunction(name, id, ns) {
    const display = JSON.stringify({ text: name, italic: false });
    return [
        `# ── Freebuff Mob Studio — ${name} ─────────────────────────`,
        '# 1) Laita tämä resurssipaketti kansioon .../resourcepacks/',
        '# 2) Laita datapack-kansio .../saves/<maailma>/datapacks/',
        '# 3) Pelissä: /reload',
        `# Spawnaa mobi: /function ${ns}:summon_${id}`,
        '#',
        '# Java ei voi luoda uutta entity-tyyppiä datapaketista — tämä luo',
        '# nimetyn armor standin, joka näyttää mallin (paper + custom_model_data).',
        `# GeckoLib-modissa käytä /summon <modid>:${id} ja spawn/${id}.json on pohja.`,
        `summon armor_stand ~ ~1 ~ {CustomName:'${display}',CustomNameVisible:1b,NoGravity:0b,Small:0b,ShowArms:0b,ArmorItems:[{},{},{},{id:"minecraft:paper",Count:1b,tag:{CustomModelData:1001}}]}`,
        '',
    ].join('\n');
}

/** GeckoLib-modiohje Java-pakettiin (juuressa GECKOLIB-OHJE.md). */
function geckoLibReadme(name, id, ns) {
    const upper = name.charAt(0).toUpperCase() + name.slice(1);
    const ClassName = (id.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(''));
    return `# ☕ GeckoLib-ohje — ${name} (${id})

Tässä paketissa on GeckoLib-malli valmiina Java-modiasi varten.
Kopioi tiedostot omaan modiisi näin:

\`\`\`
assets/${ns}/geo/${id}.geo.json                     → src/main/resources/assets/<modid>/geo/
assets/${ns}/animations/${id}.animation.json       → src/main/resources/assets/<modid>/animations/
assets/${ns}/textures/entity/${id}.png             → src/main/resources/assets/<modid>/textures/entity/
\`\`\`

> HUOM: \`assets/freebuff/...\` on vanilla-resurssipaketin item-malli
> (ei GeckoLib) — voit jättää sen huomiotta modissa.

## 1) Riippuvuus

GeckoLib 4 (CurseForge / Modrinth). Esim. Forge 1.20.1:
\`\`\`gradle
implementation fg.deobf("software.bernie.geckolib:geckolib-forge-1.20.1:4.4.9")
\`\`\`

## 2) Entity-luokka

\`\`\`java
public class ${ClassName}Entity extends PathfinderMob {
    public ${ClassName}Entity(EntityType<? extends PathfinderMob> type, Level level) {
        super(type, level);
    }
    public static AttributeSupplier.Builder createAttributes() {
        return PathfinderMob.createMobAttributes()
            .add(Attributes.MAX_HEALTH, 20.0D)
            .add(Attributes.MOVEMENT_SPEED, 0.25D)
            .add(Attributes.ATTACK_DAMAGE, 4.0D);
    }
}
\`\`\`

## 3) Malli + renderöijä

\`\`\`java
// ${ClassName}Model.java
public class ${ClassName}Model extends GeoModel<${ClassName}Entity> {
    @Override
    public ResourceLocation getModelResource(${ClassName}Entity obj) {
        return new ResourceLocation("${ns}", "geo/${id}.geo.json");
    }
    @Override
    public ResourceLocation getTextureResource(${ClassName}Entity obj) {
        return new ResourceLocation("${ns}", "textures/entity/${id}.png");
    }
    @Override
    public ResourceLocation getAnimationResource(${ClassName}Entity obj) {
        return new ResourceLocation("${ns}", "animations/${id}.animation.json");
    }
}
\`\`\`

\`\`\`java
// ${ClassName}Renderer.java
public class ${ClassName}Renderer extends GeoEntityRenderer<${ClassName}Entity> {
    public ${ClassName}Renderer(EntityRendererProvider.Context ctx) {
        super(ctx, new ${ClassName}Model());
    }
}
\`\`\`

## 4) Rekisteröinti

**Forge:**
\`\`\`java
public static final DeferredRegister<EntityType<?>> ENTITY_TYPES =
    DeferredRegister.create(ForgeRegistries.ENTITY_TYPES, "${ns}");

public static final RegistryObject<EntityType<${ClassName}Entity>> ${ClassName.toUpperCase()} =
    ENTITY_TYPES.register("${id}", () -> EntityType.Builder
        .of(${ClassName}Entity::new, MobCategory.CREATURE)
        .sized(1.0f, 1.0f).build("${id}"));

// Attribuutit (EntityAttributeCreationEvent):
// event.put(ModEntities.${ClassName.toUpperCase()}.get(), ${ClassName}Entity.createAttributes().build());
// Renderöijä (EntityRenderersEvent.RegisterRenderers):
// event.registerEntityRenderer(ModEntities.${ClassName.toUpperCase()}.get(), ${ClassName}Renderer::new);
\`\`\`

**Fabric:**
\`\`\`java
public static final EntityType<${ClassName}Entity> ${ClassName.toUpperCase()} = Registry.register(
    Registries.ENTITY_TYPE, new Identifier("${ns}", "${id}"),
    FabricEntityTypeBuilder.create(MobCategory.CREATURE, ${ClassName}Entity::new)
        .dimensions(EntityDimensions.fixed(1.0f, 1.0f)).build());

// Alustus: FabricDefaultAttributeRegistry.register(${ClassName.toUpperCase()},
//     ${ClassName}Entity.createAttributes());
// Client (ClientModInitializer):
//     EntityRendererRegistry.register(ModEntities.${ClassName.toUpperCase()}, ${ClassName}Renderer::new);
\`\`\`

## 5) Spawnaus

Komennolla heti kun entity on rekisteröity:
\`\`\`
/summon ${ns}:${id} ~ ~ ~
\`\`\`

Luonnollinen spawn (Fabric-esimerkki):
\`\`\`java
BiomeModifications.addSpawn(BiomeSelectors.spawnsOneOf(RegistryKey.of(
        RegistryKeys.BIOME, new Identifier("minecraft", "plains"))),
    MobCategory.CREATURE, ${ClassName}Entity.class, 10, 1, 2);
\`\`\`

## 6) Vinkkejä

- \`geo/${id}.geo.json\` sisältää jo oikean geometrianimen \`geometry.${id}\`.
- Animaatiot ovat muodossa \`animation.${id}.<nimi>\` — GeckoLib lukee ne suoraan.
- Jos animaatio ei pyöri: varmista että \`getAnimationResource\` palauttaa
  oikean tiedoston ja että animaatio on ajossa (\`triggerAnim\` tai \`setAnimation\`).
- Glow-tekstuuri (\`${id}_glow.png\`): käytä sitä emissiivisenä karttana
  tai lisää oma render-kerros, jos haluat hehkuvat osat.

Generoi: Freebuff Mob Studio — ${new Date().toISOString()}
`;
}

/**
 * Spawn-säännöt Java 1.21.2+ -muodossa (data/<ns>/spawn/<id>.json).
 * Minecraft hyväksyy //-kommentit data-JSONeissa. Tämä on valmis pohja:
 * Java ei voi luoda uutta entity-tyyppiä datapaketista, joten type on
 * vaihdettava modin rekisteröityyn entity-tyyppiin (esim. <modid>:<id>).
 */
function spawnTemplate(name, id, ns) {
    return [
        '{',
        `  // Freebuff Mob Studio — ${name} — luonnolliset spawn-säännöt (Java 1.21.2+)`,
        '  // HUOM: Java ei voi luoda uutta entity-tyyppiä datapaketista.',
        `  // Vaihda "type" modisi entity-tyyppiin (esim. "<modid>:${id}" GeckoLib-modissa),`,
        '  // niin mobi alkaa spawnata luonnosta. Tämä on valmis pohja.',
        '  "spawns": [',
        '    {',
        '      "type": "minecraft:zombie",',
        '      "weight": 10,',
        '      "minCount": 1,',
        '      "maxCount": 2',
        '    }',
        '  ]',
        '}',
        '',
    ].join('\n');
}

/** Mallin maailmankoordinaattien ulottuvuus → törmäyslaatikko. */
function modelBounds(model) {
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (const bone of model.bones || []) {
        for (const cube of bone.cubes || []) {
            const o = cube.origin, s = cube.size;
            if (!o || !s) continue;
            for (let i = 0; i < 3; i++) {
                min[i] = Math.min(min[i], o[i]);
                max[i] = Math.max(max[i], o[i] + s[i]);
            }
        }
    }
    if (!isFinite(min[0])) return { width: 1, height: 1 };
    const w = Math.max(0.2, Math.min(8, Math.max(max[0] - min[0], max[2] - min[2])));
    const h = Math.max(0.2, Math.min(12, max[1] - min[1]));
    return { width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100 };
}

/** Animaatioiden lyhyet nimet + viittaukset client-entityä varten. */
function animationEntries(animations, id) {
    const map = animations && animations.tracks ? { animation: animations } : (animations || {});
    const entries = {};
    const animate = [];
    for (const key of Object.keys(map)) {
        const short = key.replace(/^animation\.[^.]+\./, '') || key;
        // Bedrockin client-entity viittaa animaatiotiedoston KOKONAISIIN
        // avaimiin ("animation.<id>.<nimi>") — pelkkä lyhyt nimi ei täsmää,
        // joten animaatio ei muuten pyörisi pelissä.
        entries[short] = `animation.${id}.${short}`;
        animate.push(short);
    }
    return { entries, animate };
}

/**
 * Valitse pelissä automaattisesti soitettava animaatio: käyttäjän valitsema
 * (jos se on idle/kävely/lento-tyyppinen), sitten idle-tyyppinen, sitten
 * kävely/lento, lopuksi ensimmäinen — ei KAIKKIA yhtä aikaa (ne sotkisivat
 * toisensa, esim. walk + idle taistelevat samoista luista).
 */
function pickPrimaryAnimation(animations, preferred) {
    const map = animations && animations.tracks ? { animation: animations } : (animations || {});
    const names = Object.keys(map);
    if (!names.length) return null;
    const prefer = (re) => names.find((n) => re.test(n));
    return (
        (preferred && /idle|walk|fly|run|ambient|swim/i.test(preferred) && map[preferred] ? preferred : null) ||
        prefer(/idle|ambient/i) ||
        prefer(/walk|fly|run|swim/i) ||
        (preferred && map[preferred] ? preferred : null) ||
        names[0]
    );
}

/** RP:n client-entity — sitoo geometrian, tekstuurit, animaatiot ja spawn-eggin. */
function bedrockEntityFile(model, id, ns, animations, eggColors, opts = {}) {
    const { entries } = animationEntries(animations, id);
    const hasGlow = !!opts.hasGlow;
    const desc = {
        identifier: `${ns}:${id}`,
        materials: { default: 'entity_alphatest' },
        textures: { default: `textures/entity/${id}` },
        geometry: { default: `geometry.${id}` },
        render_controllers: ['controller.render.default'],
        spawn_egg: {
            base_color: (eggColors && eggColors.base) || '#7da06a',
            overlay_color: (eggColors && eggColors.overlay) || '#4a5f3f',
        },
    };
    if (hasGlow) {
        // Glow-kerros: toinen material (entity_emissive_alpha hehkuu
        // valaistuksesta riippumatta) + glow-tekstuuri + toinen
        // render-controller — vain glow-pikselit näkyvät toisella ajolla.
        desc.materials.glow = 'entity_emissive_alpha';
        desc.textures.glow = `textures/entity/${id}_glow`;
        desc.render_controllers.push('controller.render.glow');
    }
    if (Object.keys(entries).length) {
        desc.animations = entries;
        // Yksi ensisijainen animaatio pelissä (ei kaikki yhtä aikaa)
        const chosen = pickPrimaryAnimation(animations, opts.primaryAnimation) || Object.keys(entries)[0];
        desc.scripts = { animate: [chosen] };
    }
    return {
        format_version: '1.10.0',
        'minecraft:client_entity': { description: desc },
    };
}

/**
 * BP:n behavior-entity — peruskomponentit, joilla mobi toimii ja taistelee.
 * @param opts { type, health, damage, speed, jump, flying }
 *   speed 0.05–1.0 (minecraft:movement), jump true/false (jump.static),
 *   flying true → can_fly + navigation.fly + movement.fly + random_fly.
 *   HUOM: Bedrock ei säädä hyppykorkeutta erikseen — se seuraa nopeutta.
 */
function bedrockEntityBehavior(model, id, ns, opts = {}) {
    const box = modelBounds(model);
    const type = opts.type || 'neutral';
    const health = Math.max(1, Math.round(opts.health ?? 20));
    const damage = Math.max(0, Math.round(opts.damage ?? 4));
    const speed = Math.min(1, Math.max(0.05, opts.speed ?? 0.25));
    const canJump = opts.jump !== false;
    const flying = !!opts.flying;

    const components = {
        'minecraft:type_family': { family: ['freebuff', 'mob'] },
        'minecraft:health': { value: health, max: health },
        'minecraft:movement': { value: Math.round(speed * 100) / 100 },
        'minecraft:collision_box': { width: box.width, height: box.height },
        'minecraft:physics': {},
        'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
        'minecraft:nameable': {},
        'minecraft:despawn': {
            despawn_from_distance: { min_distance: 32, max_distance: 128 },
        },
        'minecraft:behavior.float': { priority: 0 },
        'minecraft:behavior.look_at_player': { priority: 5, probability: 0.02 },
        'minecraft:damage_sensor': {
            triggers: [{ cause: 'fall', deals_damage: false }],
        },
        'minecraft:scale': { value: 1.0 },
    };

    if (flying) {
        // Lentävä mobi — parrotin resepti: ei kävele eikä hyppää
        components['minecraft:can_fly'] = {};
        components['minecraft:navigation.fly'] = { can_path_over_water: true, can_path_from_air: true };
        components['minecraft:movement.fly'] = {};
        components['minecraft:behavior.random_fly'] = { priority: 4, speed_multiplier: 1.0 };
    } else {
        components['minecraft:movement.basic'] = {};
        if (canJump) components['minecraft:jump.static'] = {};
        components['minecraft:behavior.random_stroll'] = { priority: 4, speed_multiplier: 1.0 };
    }

    if (type === 'passive') {
        // Lempeä: pakenee kun sattuu, ei hyökkää
        components['minecraft:behavior.panic'] = { priority: 1, speed_multiplier: 1.25 };
    } else {
        components['minecraft:behavior.hurt_by_target'] = { priority: 2 };
        if (type === 'hostile') {
            // Vihamielinen: hyökkää pelaajan nähdessään
            components['minecraft:behavior.nearest_attackable_target'] = {
                priority: 1,
                entity_types: [{
                    filters: { test: 'is_family', subject: 'other', value: 'player' },
                    max_dist: 16,
                    must_see: true,
                }],
            };
            components['minecraft:behavior.melee_attack'] = { priority: 3, speed_multiplier: 1.25 };
        } else {
            components['minecraft:behavior.melee_attack'] = { priority: 3, speed_multiplier: 1.0 };
        }
        if (damage > 0) {
            components['minecraft:attack'] = { damage };
        }
    }

    return {
        format_version: '1.16.0',
        'minecraft:entity': {
            description: {
                identifier: `${ns}:${id}`,
                is_spawnable: true,
                is_summonable: true,
                is_experimental: false,
            },
            components,
        },
    };
}

/** BP:n spawn-säännöt — mobi ilmestyy overworldin pinnalle. */
function bedrockSpawnRules(id, ns) {
    return {
        format_version: '1.8.0',
        'minecraft:spawn_rules': {
            description: {
                identifier: `${ns}:${id}`,
                population_control: 'misc',
            },
            conditions: [
                {
                    'minecraft:spawns_on_surface': {},
                    'minecraft:brightness_filter': {
                        min: 0, max: 15, adjust_for_weather: false,
                    },
                    'minecraft:height_filter': { min: 0, max: 256 },
                    'minecraft:weight': { default: 10 },
                    'minecraft:herd': { min_size: 1, max_size: 3 },
                    'minecraft:biome_filter': {
                        test: 'has_biome_tag', operator: '==', value: 'overworld',
                    },
                },
            ],
        },
    };
}

function bedrockRenderControllers(hasGlow) {
    const controllers = {
        'controller.render.default': {
            geometry: 'Geometry.default',
            materials: [{ '*': 'Material.default' }],
            textures: ['Texture.default'],
        },
    };
    if (hasGlow) {
        // Emissiivinen läpikäynti: sama geometria, mutta glow-tekstuurilla
        // + entity_emissive_alpha -materialilla — hehkuvat osat loistavat.
        controllers['controller.render.glow'] = {
            geometry: 'Geometry.default',
            materials: [{ '*': 'Material.glow' }],
            textures: ['Texture.glow'],
        };
    }
    return {
        format_version: '1.8.0',
        render_controllers: controllers,
    };
}

/** Asennusohje Bedrock-paketin juureen (.mcaddon — Minecraft ohittaa ylimääräiset tiedostot). */
function bedrockReadme(name, id, ns, hasAnims, primaryAnim, hasGlow) {
    const lines = [
        '==============================================================',
        `  ${name} — Minecraft Bedrock -addon (Freebuff Mob Studio)`,
        '==============================================================',
        '',
        'ASENNUS (2 tapaa):',
        '  1) Avaa ladattu .mcaddon-tiedosto (tuplaklikkaus) — Minecraft',
        '     asentaa resource_pack + behavior_pack automaattisesti.',
        '  2) Tai kopioi kansiot resource_pack/ ja behavior_pack/',
        '     manuaalisesti .../resource_packs/ ja .../behavior_packs/',
        '     ja ota ne käyttöön Maailman asetuksissa.',
        '',
        'KUTSU:',
        `  /summon ${ns}:${id} ~ ~ ~`,
        '',
        'SPAWN-EGGI:',
        '  Löytyy luovasta inventaariosta (spawn_egg-värit johdettu',
        '  mobin tekstuurista).',
        '',
        'ANIMAATIO:',
        `  ${hasAnims ? (primaryAnim ? 'Soitetaan automaattisesti: ' + primaryAnim : 'Animaatiotiedosto mukana.') : 'Ei animaatioita (staattinen malli).'}`,
        '',
        'GLOW:',
        `  ${hasGlow ? 'Emissiiviset osat hehkuvat (entity_emissive_alpha).' : 'Ei glow-kerrosta.'}`,
        '',
        'TIEDOSTOT:',
        `  resource_pack/models/entity/${id}.geo.json        (geometria)`,
        `  resource_pack/textures/entity/${id}.png          (tekstuuri)`,
        (hasGlow ? `  resource_pack/textures/entity/${id}_glow.png    (glow-kerros)` : ''),
        (hasAnims ? `  resource_pack/animations/${id}.animation.json  (animaatiot)` : ''),
        `  resource_pack/entity/${id}.entity.json           (client-entity)`,
        `  behavior_pack/entities/${id}.json                (käytös: HP, vahinko, nopeus)`,
        `  behavior_pack/spawn_rules/${id}.json             (spawn-säännöt)`,
        '',
        'Generoi: Freebuff Mob Studio — ' + new Date().toISOString(),
        '',
    ];
    return lines.filter((l) => l !== undefined).join('\n');
}

/** Kevyt tiedostolista esikatseluun (ei generoi PNG:tä). */
export function previewPackFiles(formats, id, ns, hasAnims, hasGlow) {
    const out = [];
    if (formats.includes('bedrock')) {
        out.push(
            'ASENNUS-OHJE.txt',
            'resource_pack/manifest.json',
            'resource_pack/pack_icon.png',
            `resource_pack/entity/${id}.entity.json`,
            `resource_pack/models/entity/${id}.geo.json`,
            `resource_pack/textures/entity/${id}.png`,
        );
        if (hasGlow) out.push(`resource_pack/textures/entity/${id}_glow.png`);
        out.push(`resource_pack/render_controllers/${id}.render_controllers.json`);
        if (hasAnims) out.push(`resource_pack/animations/${id}.animation.json`);
        out.push(
            'behavior_pack/manifest.json',
            'behavior_pack/pack_icon.png',
            `behavior_pack/entities/${id}.json`,
            `behavior_pack/spawn_rules/${id}.json`,
        );
    }
    if (formats.includes('java')) {
        out.push('pack.mcmeta', 'pack.png', `assets/${ns}/geo/${id}.geo.json`, `assets/${ns}/textures/entity/${id}.png`);
        if (hasGlow) out.push(`assets/${ns}/textures/entity/${id}_glow.png`);
        if (hasAnims) out.push(`assets/${ns}/animations/${id}.animation.json`);
        out.push(
            `assets/freebuff/models/item/${id}.json`,
            `assets/freebuff/textures/item/${id}.png`,
            'assets/minecraft/models/item/paper.json',
            'GECKOLIB-OHJE.md',
            'datapack/pack.mcmeta',
            `datapack/data/${ns}/functions/summon_${id}.mcfunction`,
            `datapack/data/${ns}/spawn/${id}.json`,
        );
    }
    return out;
}

/**
 * @param model        editorin malli ({ modelId, textureWidth, textureHeight, bones })
 * @param opts.formats      ['java'] | ['bedrock'] | ['java','bedrock']
 * @param opts.namespace    modin namespace (oletus: modelId:n perusosa)
 * @param opts.projectName  paketin nimi (manifest/pack.mcmeta)
 * @param opts.animations   exportBedrockAnimations-objekti tai null (ei animaatioita)
 * @param opts.textureCanvas 2D-canvas (tai dataURL-merkkijono) tekstuurista
 * @param opts.emissiveDataURL   glow-kerroksen PNG dataURL-merkkijono (tai null)
 * @param opts.eggColors    { base, overlay } spawn-eggin värit (tai null → oletus)
 * @param opts.packIcon     ikonikuvan canvas tai dataURL (pack_icon.png / pack.png)
 * @param opts.behavior     { type: 'passive'|'neutral'|'hostile', health, damage, speed, jump, flying }
 * @returns { files: [{path, data}], filePaths: [string] }
 */
export function buildResourcePack(model, opts = {}) {
    const formats = opts.formats && opts.formats.length ? opts.formats : ['java'];
    const id = (model.modelId || 'custom_mob').replace('geometry.', '');
    const ns = String(opts.namespace || id).replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/gi, '').toLowerCase() || id;
    const name = opts.projectName || id;

    const files = [];
    const png = pngBytesFromTexture(opts.textureCanvas);
    const glow = opts.emissiveDataURL ? pngBytesFromTexture(opts.emissiveDataURL) : null;
    const icon = opts.packIcon ? pngBytesFromTexture(opts.packIcon) : null;
    const hasAnims = opts.animations && Object.keys(opts.animations).length > 0;

    if (formats.includes('bedrock')) {
        const rpModuleUuid = uuid();
        const primaryAnim = pickPrimaryAnimation(opts.animations, opts.primaryAnimation);
        files.push({ path: 'ASENNUS-OHJE.txt', data: enc.encode(bedrockReadme(name, id, ns, hasAnims, primaryAnim, !!glow)) });
        files.push({ path: 'resource_pack/manifest.json', data: jsonBytes(bedrockManifest(name, rpModuleUuid)) });
        if (icon) files.push({ path: 'resource_pack/pack_icon.png', data: icon });
        files.push({ path: `resource_pack/entity/${id}.entity.json`, data: jsonBytes(bedrockEntityFile(model, id, ns, opts.animations, opts.eggColors, { primaryAnimation: opts.primaryAnimation, hasGlow: !!glow })) });
        files.push({ path: `resource_pack/models/entity/${id}.geo.json`, data: jsonBytes(exportBedrockGeometry(model)) });
        files.push({ path: `resource_pack/render_controllers/${id}.render_controllers.json`, data: jsonBytes(bedrockRenderControllers(!!glow)) });
        if (png) files.push({ path: `resource_pack/textures/entity/${id}.png`, data: png });
        if (glow) files.push({ path: `resource_pack/textures/entity/${id}_glow.png`, data: glow });
        if (hasAnims) files.push({ path: `resource_pack/animations/${id}.animation.json`, data: jsonBytes(exportBedrockAnimations(model, opts.animations)) });
        // Behavior pack — mobi spawnaa pelissä
        files.push({ path: 'behavior_pack/manifest.json', data: jsonBytes(behaviorManifest(name, rpModuleUuid)) });
        if (icon) files.push({ path: 'behavior_pack/pack_icon.png', data: icon });
        files.push({ path: `behavior_pack/entities/${id}.json`, data: jsonBytes(bedrockEntityBehavior(model, id, ns, opts.behavior)) });
        files.push({ path: `behavior_pack/spawn_rules/${id}.json`, data: jsonBytes(bedrockSpawnRules(id, ns)) });
    }

    if (formats.includes('java')) {
        files.push({ path: 'pack.mcmeta', data: jsonBytes(packMcmeta(name)) });
        if (icon) files.push({ path: 'pack.png', data: icon });
        files.push({ path: `assets/${ns}/geo/${id}.geo.json`, data: jsonBytes(exportBedrockGeometry(model)) });
        if (png) files.push({ path: `assets/${ns}/textures/entity/${id}.png`, data: png });
        if (glow) files.push({ path: `assets/${ns}/textures/entity/${id}_glow.png`, data: glow });
        if (hasAnims) files.push({ path: `assets/${ns}/animations/${id}.animation.json`, data: jsonBytes(exportJavaAnimations(model, opts.animations)) });
        // Vanilla Java-edition item-malli (tekstuuriviittaukset ovat freebuff-namespacessa)
        files.push({ path: `assets/freebuff/models/item/${id}.json`, data: jsonBytes(exportJavaModel(model, id)) });
        if (png) files.push({ path: `assets/freebuff/textures/item/${id}.png`, data: png });
        // Java ei voi luoda uutta entity-tyyppiä datapaketista — paper-override
        // (custom_model_data 1001 → mobin malli) + datapakki, jolla mobi
        // spawnataan komennolla nimettynä armor standina. GeckoLib-modissa
        // oikea mobi on /summon <modid>:<id> ja spawn.json on valmis pohja.
        files.push({ path: 'assets/minecraft/models/item/paper.json', data: jsonBytes(paperOverride(id)) });
        files.push({ path: 'GECKOLIB-OHJE.md', data: enc.encode(geckoLibReadme(name, id, ns)) });
        files.push({ path: 'datapack/pack.mcmeta', data: jsonBytes(datapackMcmeta(name)) });
        files.push({ path: `datapack/data/${ns}/functions/summon_${id}.mcfunction`, data: enc.encode(summonFunction(name, id, ns)) });
        files.push({ path: `datapack/data/${ns}/spawn/${id}.json`, data: enc.encode(spawnTemplate(name, id, ns)) });
    }

    return { files, filePaths: files.map((f) => f.path) };
}
