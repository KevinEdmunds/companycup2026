import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  dry_degradation: number;
  cold_degradation: number;
  light_rain_degradation: number;
  heavy_rain_degradation: number;
}

interface TyresConfig {
  properties: Record<string, TyreProperties>;
}

interface TyreSet {
  ids: number[];
  compound: string;
}

interface WeatherCondition {
  id: number;
  condition: string;
  duration_s: number;
  acceleration_multiplier: number;
  deceleration_multiplier: number;
}

interface Segment {
  id: number;
  type: "straight" | "corner";
  length_m: number;
  radius_m?: number;
}

interface TrackConfig {
  name: string;
  segments: Segment[];
}

interface RaceConfig {
  name: string;
  laps: number;
  base_pit_stop_time_s: number;
  "pit_refuel_rate_l/s": number;
  corner_crash_penalty_s: number;
  "pit_exit_speed_m/s": number;
  fuel_soft_cap_limit_l: number;
  starting_weather_condition_id: number;
  time_reference_s?: number;
}

interface LevelFile {
  car: CarConfig;
  race: RaceConfig;
  track: TrackConfig;
  tyres: TyresConfig;
  available_sets: TyreSet[];
  weather: { conditions: WeatherCondition[] };
}

const GRAVITY = 9.8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

function getActiveWeather(level: LevelFile): WeatherCondition {
  const first = level.weather.conditions[0];
  if (!first) {
    return {
      id: 1,
      condition: "dry",
      duration_s: Infinity,
      acceleration_multiplier: 1,
      deceleration_multiplier: 1,
    };
  }
  return first;
}

function getTyreFriction(properties: TyreProperties, weather: WeatherCondition): number {
  const multiplierKeyMap: Record<string, keyof TyreProperties> = {
    dry: "dry_friction_multiplier",
    cold: "cold_friction_multiplier",
    light_rain: "light_rain_friction_multiplier",
    heavy_rain: "heavy_rain_friction_multiplier",
  };

  const multiplierKey = multiplierKeyMap[weather.condition] ?? "dry_friction_multiplier";
  const multiplier = properties[multiplierKey] as number;
  return properties.base_friction * multiplier;
}

function computeSafeCornerSpeed(radius: number, tyreFriction: number): number {
  return Math.sqrt(tyreFriction * GRAVITY * radius);
}

function computeMaxReachableSpeed(
  initialSpeed: number,
  finalSpeed: number,
  distance: number,
  accel: number,
  brake: number,
  maxTarget: number
): number {
  if (distance <= 0) {
    return Math.min(initialSpeed, maxTarget);
  }

  const numerator = 2 * accel * brake * distance + brake * initialSpeed ** 2 + accel * finalSpeed ** 2;
  const denominator = accel + brake;

  if (denominator <= 0) {
    return Math.min(initialSpeed, maxTarget);
  }

  const reachableSquared = numerator / denominator;
  const reachable = reachableSquared <= 0 ? 0 : Math.sqrt(reachableSquared);
  return Math.min(reachable, maxTarget);
}

function computeBrakingDistance(initialSpeed: number, finalSpeed: number, brake: number): number {
  if (brake <= 0) {
    return Infinity;
  }
  if (initialSpeed <= finalSpeed) {
    return 0;
  }
  return (initialSpeed ** 2 - finalSpeed ** 2) / (2 * brake);
}

function getCornerChainSpeed(segments: Segment[], startIndex: number, tyreFriction: number): number {
  let minSpeed = Infinity;
  for (let offset = 1; offset < segments.length; offset += 1) {
    const index = (startIndex + offset) % segments.length;
    const segment = segments[index]!;
    if (segment.type !== "corner") {
      break;
    }
    if (segment.radius_m === undefined) {
      throw new Error(`Corner segment ${segment.id} is missing radius_m.`);
    }
    const safeSpeed = computeSafeCornerSpeed(segment.radius_m, tyreFriction);
    minSpeed = Math.min(minSpeed, safeSpeed);
  }
  return minSpeed === Infinity ? 0 : minSpeed;
}

function buildStrategy(level: LevelFile): unknown {
  const weather = getActiveWeather(level);
  const tyreSet = level.available_sets.find((set) => set.compound.toLowerCase() === "soft") ?? level.available_sets[0];
  if (!tyreSet) {
    throw new Error("No available tyre sets in level file.");
  }
  const initialTyreId = tyreSet.ids[0];
  const tyreProps = level.tyres.properties[tyreSet.compound];
  if (!tyreProps) {
    throw new Error(`Tyre properties missing for compound ${tyreSet.compound}`);
  }
  const tyreFriction = getTyreFriction(tyreProps, weather);

  const trackSegments = level.track.segments;
  const laps = level.race.laps;
  const car = level.car;

  const output: any = {
    initial_tyre_id: initialTyreId,
    laps: [] as any[],
  };

  let currentSpeed = 0;

  for (let lap = 1; lap <= laps; lap += 1) {
    const segments: any[] = [];

    for (let index = 0; index < trackSegments.length; index += 1) {
      const segment = trackSegments[index];
      if (!segment) {
        continue;
      }

      if (segment.type === "straight") {
        const safeEntrySpeed = getCornerChainSpeed(trackSegments, index, tyreFriction);
        const maxTargetSpeed = car["max_speed_m/s"];
        const targetSpeed = clamp(
          computeMaxReachableSpeed(currentSpeed, safeEntrySpeed, segment.length_m, car["accel_m/se2"], car["brake_m/se2"], maxTargetSpeed),
          currentSpeed,
          maxTargetSpeed
        );

        const brakeDistance = computeBrakingDistance(targetSpeed, safeEntrySpeed, car["brake_m/se2"]);
        const brakeStart = Math.max(0, segment.length_m - brakeDistance);

        segments.push({
          id: segment.id,
          type: "straight",
          "target_m/s": roundTo(targetSpeed, 2),
          "brake_start_m_before_next": roundTo(brakeStart, 2),
        });

        currentSpeed = safeEntrySpeed;
      } else {
        segments.push({
          id: segment.id,
          type: "corner",
        });
      }
    }

    output.laps.push({
      lap,
      segments,
      pit: {
        enter: false,
      },
    });
  }

  return output;
}

function main(): void {
  const levelPath = path.join(__dirname, "..", "1.txt");
  const outputPath = path.join(__dirname, "..", "output.json");

  const raw = fs.readFileSync(levelPath, "utf8");
  const level = JSON.parse(raw) as LevelFile;
  const strategy = buildStrategy(level);

  fs.writeFileSync(outputPath, JSON.stringify(strategy, null, 2), "utf8");
  process.stdout.write(`Strategy generated: ${outputPath}\n`);
}

main();
