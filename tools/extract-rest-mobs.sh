#!/bin/bash
# Puree loput Deep Void -mobien assetit JARista assets/deepvoid/-kansioon.
set -e
cd /Users/kasperi/spore
JAR=/tmp/deepvoid.jar
GEO="abductor alphacrawlerremodel beholder bigeye bogwalker bone_cage bonecrawlerremodel crosseye damned deathmaw devourer everhunger fleshcube fleshfangs fleshlamprey fleshwormnew fool_eater forsaken foureyes gaoler giantshadowhand gore_spitter gravekeeper harvestmen hive_brain hivefangs hivemindrework hollowed lickerremodeled lurker madcultist maggot mothercrawlerremodel mourner_animated multipleeyes overseer penitent preserver prisonguard rooted rottencorpse saw_thrower scarecrow seeker shadowhand skull_smasher smallfleshcube sporespewer spittercrawlerremodel swarmer thumper tombstone void_tentacle voidborntentacles voidfly voidwatcher vulture wanderer"
for g in $GEO; do
    unzip -o -q -j "$JAR" "assets/the_deep_void/geo/$g.geo.json" -d assets/deepvoid
    unzip -o -q -j "$JAR" "assets/the_deep_void/animations/$g.animation.json" -d assets/deepvoid
done
# Tekstuurit (pelin entity-id:stä johdetut nimet)
TEX="abductor.png alphacrawlerremodelnew.png beholder.png bigeye.png bog_walker.png bone_cage.png bonecrawlerremodel.png crosseye.png damned.png death_maw.png death_maw_glow.png devourernew.png everhungernew.png fleshcube.png flesh_fangs.png fleshlamprey.png fleshwormnew.png fool_eater_newer.png fool_eater_newer_glow.png forsaken.png forsaken_glow.png foureyes.png gaoler.png giantshadowhand.png giantshadowhand_glow.png gore_spitter.png gravekeeper.png harvestmen.png hive_brain.png hivefangs.png hivemindrework.png hollowed.png lickerremodeled.png lurker_texture.png madcultist.png void_fly_maggot.png mothercrawlerremodel.png mourner_remodel.png multipleeyes.png overseernew.png penitent_and_shank.png preserver_new.png prison_guard.png rooted_rework.png rooted_rework_glow.png rotten_corpse_new.png saw_thrower.png scarecrow.png seeker.png seeker_glow.png shadowhand.png skull_smasher.png small_flesh_cube.png sporespewernew.png spittercrawlerremodel.png swarmer.png thumper.png tombstone.png tombstone_glow.png void_tentacle.png voidborntentacles.png voidfly.png void_dweller_texture.png death_vulture.png death_vulture_glow.png wanderer_texture.png"
for t in $TEX; do
    unzip -o -q -j "$JAR" "assets/the_deep_void/textures/entities/$t" -d assets/deepvoid
done
echo "OK — assetit purettu"
ls assets/deepvoid/*.png | wc -l
du -sh assets/deepvoid
