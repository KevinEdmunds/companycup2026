import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

interface CarConfig {
  "max_speed_m/s": number;
  "accel_m/se2": number;
  "brake_m/se2": number;
  "limp_constant_m/s": number;
  "crawl_constant_m/s": number;
  "fuel_tank_capacity_l": number;
  "initial_fuel_l": number;
  "fuel_consumption_l/m": number;
}

interface TyreProperties {
  life_span: number;
  base_friction: number;
  dry_friction_multiplier: number;
  cold_friction_multiplier: number;
  light_rain_friction_multiplier: number;
  heavy_rain_friction_multiplier: number;
}

interface WeatherCondition {
  id: number;
  condition: string;
  acceleration_multiplier: number;
  deceleration_multiplier: number;
}

interface Segment {
  id: number;
  type: "straight" | "corner";
  length_m: number;
  radius_m?: number;
}

interface RaceConfig {
  laps: number;
  "pit_exit_speed_m/s": number;
  starting_weather_condition_id: number;
}

interface LevelFile {
  car: CarConfig;
  race: RaceConfig;
  track: { name: string; segments: Segment[] };
  tyres: { properties: Record<string, TyreProperties> };
  available_sets: Array<{ ids: number[]; compound: string }>;
  weather: { conditions: WeatherCondition[] };
}

/* ------------------------------------------------------------------ */
/* Tunables                                                           */
/* ------------------------------------------------------------------ */

const GRAVITY = 9.8;

/**
 * The spec is internally inconsistent about corner speed:
 *   - "Speed Constraints": max = sqrt(friction * g * r) + crawl_constant
 *   - "Track / Corners":   max = sqrt(friction * g * r)
 * Taking a corner over the limit is catastrophic (crash penalty + crawl),
 * so by default we use the conservative formula (no crawl bonus). Flip this
 * to `true` only if your simulator implements the crawl-bonus rule.
 */
const USE_CRAWL_CORNER_BONUS = false;

/** Speed safety buffer (m/s) subtracted from the theoretical corner limit. */
const CORNER_SPEED_SAFETY = 0.1;

const WEATHER_FRICTION_KEY: Record<string, keyof TyreProperties> = {
  dry: "dry_friction_multiplier",
  cold: "cold_friction_multiplier",
  light_rain: "light_rain_friction_multiplier",
  heavy_rain: "heavy_rain_friction_multiplier",
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const floor2 = (v: number): number => Math.floor(v * 100) / 100;
const ceil2 = (v: number): number => Math.ceil(v * 100) / 100;

function getActiveWeather(level: LevelFile): WeatherCondition {
  const id = level.race.starting_weather_condition_id;
  const found = level.weather.conditions.find((w) => w.id === id);
  return (
    found ??
    level.weather.conditions[0] ?? {
      id: 1,
      condition: "dry",
      acceleration_multiplier: 1,
      deceleration_multiplier: 1,
    }
  );
}

function tyreFriction(props: TyreProperties, weather: WeatherCondition): number {
  const key = WEATHER_FRICTION_KEY[weather.condition] ?? "dry_friction_multiplier";
  return props.base_friction * (props[key] as number);
}

/** Pick the compound with the highest available friction for the active weather. */
function pickBestTyre(level: LevelFile, weather: WeatherCondition): { id: number; friction: number } {
  let best: { id: number; friction: number } | undefined;
  for (const set of level.available_sets) {
    const props = level.tyres.properties[set.compound];
    const firstId = set.ids[0];
    if (!props || firstId === undefined) continue;
    const friction = tyreFriction(props, weather);
    if (!best || friction > best.friction) {
      best = { id: firstId, friction };
    }
  }
  if (!best) throw new Error("No usable tyre set found in level file.");
  return best;
}

/** Maximum safe speed for a single corner. */
function cornerSafeSpeed(radius: number, friction: number, crawl: number): number {
  const bonus = USE_CRAWL_CORNER_BONUS ? crawl : 0;
  const limit = Math.sqrt(friction * GRAVITY * radius) + bonus;
  return Math.max(crawl, limit - CORNER_SPEED_SAFETY);
}

/**
 * Slowest safe speed across the chain of consecutive corners that follows a
 * straight. The car cannot accelerate or brake mid-corner, so a run of
 * back-to-back corners must all be taken at the minimum of their limits.
 */
function cornerChainSpeed(segments: Segment[], straightIndex: number, friction: number, crawl: number): number {
  let min = Number.POSITIVE_INFINITY;
  for (let offset = 1; offset < segments.length; offset += 1) {
    const seg = segments[(straightIndex + offset) % segments.length];
    if (!seg || seg.type !== "corner") break;
    if (seg.radius_m === undefined) throw new Error(`Corner ${seg.id} missing radius_m.`);
    min = Math.min(min, cornerSafeSpeed(seg.radius_m, friction, crawl));
  }
  return Number.isFinite(min) ? min : crawl;
}

/**
 * Peak speed reachable on a straight: accelerate from `entry`, then brake to
 * `exit`, within `length`. Capped at `maxSpeed`.
 */
function peakSpeed(entry: number, exit: number, length: number, accel: number, brake: number, maxSpeed: number): number {
  if (length <= 0 || accel <= 0 || brake <= 0) return Math.min(maxSpeed, Math.max(entry, exit));
  const sq = (2 * accel * brake * length + brake * entry ** 2 + accel * exit ** 2) / (accel + brake);
  const peak = sq <= 0 ? 0 : Math.sqrt(sq);
  return Math.min(maxSpeed, peak);
}

/* ------------------------------------------------------------------ */
/* Strategy                                                           */
/* ------------------------------------------------------------------ */

interface StraightAction {
  id: number;
  type: "straight";
  "target_m/s": number;
  brake_start_m_before_next: number;
}
interface CornerAction {
  id: number;
  type: "corner";
}
type SegmentAction = StraightAction | CornerAction;

function buildStrategy(level: LevelFile): unknown {
  const weather = getActiveWeather(level);
  const tyre = pickBestTyre(level, weather);

  const car = level.car;
  const maxSpeed = car["max_speed_m/s"];
  const crawl = car["crawl_constant_m/s"];
  const accel = car["accel_m/se2"] * weather.acceleration_multiplier;
  const brake = car["brake_m/se2"] * weather.deceleration_multiplier;

  const segments = level.track.segments;

  // One lap is identical to the next in Level 1 (no fuel/tyre/weather change),
  // so compute a single lap template, then replicate it.
  const lapTemplate: SegmentAction[] = [];
  let speed = 0; // race starts from a standstill

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (!seg) continue;

    if (seg.type !== "straight") {
      lapTemplate.push({ id: seg.id, type: "corner" });
      continue;
    }

    const exitSpeed = cornerChainSpeed(segments, i, tyre.friction, crawl);
    const cruise = floor2(Math.max(peakSpeed(speed, exitSpeed, seg.length_m, accel, brake, maxSpeed), exitSpeed));

    // Speed at the brake point: the cruise speed, or the entry speed if the
    // straight is too short to accelerate (spec "speed follow-through").
    const brakeFrom = Math.max(cruise, speed);
    const rawBrake = brakeFrom > exitSpeed ? (brakeFrom ** 2 - exitSpeed ** 2) / (2 * brake) : 0;
    const brakeStart = Math.min(seg.length_m, ceil2(rawBrake));

    lapTemplate.push({
      id: seg.id,
      type: "straight",
      "target_m/s": cruise,
      brake_start_m_before_next: brakeStart,
    });

    // The chain speed is carried through the following corner(s).
    speed = exitSpeed;
  }

  const laps = Array.from({ length: level.race.laps }, (_, idx) => ({
    lap: idx + 1,
    segments: lapTemplate,
    pit: { enter: false },
  }));

  return { initial_tyre_id: tyre.id, laps };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                        */
/* ------------------------------------------------------------------ */

function main(): void {
  const levelPath = path.join(__dirname, "1.txt");
  const outputPath = path.join(__dirname, "output.txt");

  const level = JSON.parse(fs.readFileSync(levelPath, "utf8")) as LevelFile;
  const strategy = buildStrategy(level);

  fs.writeFileSync(outputPath, JSON.stringify(strategy, null, 2), "utf8");
  process.stdout.write(`Level 1 strategy written to ${outputPath}\n`);
}

main();
