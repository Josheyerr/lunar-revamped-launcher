---
name: create-lunar-client-module
description: >-
  Add a new Lunar Revamped in-game client module (AbstractFeature). Use when
  the user asks for a new mod, HUD, mechanic, or Lunar feature — not Forge/Fabric.
---

# Create a Lunar Revamped client module

Root: `F:\Projects\LunarClientremake-main`. **Not** Forge or Fabric. Do not add loaders or new dependencies.

This is a client end-build (`lunar-revamped-client` / `lunar-localpatches.jar`). Do not release the launcher. Stay off `mod/skyblock/**` unless the user explicitly asks for Skyblock.

## Layout

```
src/reference/java/com/moonsworth/lunar/client/mod/<category>/<id>/YourMod.java
```

Categories: `combat`, `hud`, `misc`, `movement`, `player`, `render`.

Templates: `Hitbox`, `ReachDisplay`, `Ping`, `PvPOptimizer`.

## Skeleton

- `extends AbstractFeature`
- `super(false)` unless the user wants it on by default
- `getId()` → `SCREAMING_SNAKE` (e.g. `PVP_OPTIMIZER`)
- Options: `OptionFactory` in `method2(RootSettingsBuilder)`
- Events: `this.handle(EventTick.class, …)` or `LunarEventBus`
- HUD: `this.method2(ModTraits.field1, TypedHudRenderer.method22(…))`
- Optional: override `method20()` for `ModDetails` + `Calculator2Handler` (`field6` mechanic, `field4` hud)

## Register

Add `new YourMod()` in `ModsSettings.method1()` next to the same category (combat near `Combo` / `PvpInfo`). Persistence is `mods.json`. Do not invent a new config format unless hooks also need a sidecar file (see PvPOptimizer `pvpoptimizer.properties`).

## Runtime (Play actually loads it)

`src/reference/java` does **not** compile. Play uses `libs/` + `lunar-localpatches.jar` first on the classpath.

1. Put hook classes that the game must run under `tools/localpatches/src/…` (no AbstractFeature if it will not compile against `lunar.jar`).
2. `bash tools/build_localpatches.sh` → `libs/lunar-localpatches.jar`
3. Skill: `build-runtime-patches`

Do not run a full `mvn package` unless rescuing the feature into `src/main/java`.

## Hooks

Prefer Lunar bridges + existing events. Add mixins only when needed (`MinecraftEventMixin`, `v1_8`). MCP edits in `src/main/java/net/minecraft` help the deobf tree; still ship localpatches for Play.

No packet forging, reordering, or extra sends unless the user explicitly wants a non-legit combat cheat and the request is otherwise allowed.

## Afterward

Restart Play. Do not start a client GitHub release unless asked (batch same end-build).
