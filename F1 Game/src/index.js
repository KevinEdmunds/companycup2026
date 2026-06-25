import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GRAVITY = 9.8;
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function roundTo(value, precision) {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
}
function getActiveWeather(level) {
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
function getTyreFriction(properties, weather) {
    const multiplierKeyMap = {
        dry: "dry_friction_multiplier",
        cold: "cold_friction_multiplier",
        light_rain: "light_rain_friction_multiplier",
        heavy_rain: "heavy_rain_friction_multiplier",
    };
    const multiplierKey = multiplierKeyMap[weather.condition] ?? "dry_friction_multiplier";
    const multiplier = properties[multiplierKey];
    return properties.base_friction * multiplier;
}
function computeSafeCornerSpeed(radius, tyreFriction) {
    return Math.sqrt(tyreFriction * GRAVITY * radius);
}
function computeMaxReachableSpeed(initialSpeed, finalSpeed, distance, accel, brake, maxTarget) {
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
function computeBrakingDistance(initialSpeed, finalSpeed, brake) {
    if (brake <= 0) {
        return Infinity;
    }
    if (initialSpeed <= finalSpeed) {
        return 0;
    }
    return (initialSpeed ** 2 - finalSpeed ** 2) / (2 * brake);
}
function getCornerChainSpeed(segments, startIndex, tyreFriction) {
    let minSpeed = Infinity;
    for (let offset = 1; offset < segments.length; offset += 1) {
        const index = (startIndex + offset) % segments.length;
        const segment = segments[index];
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
function buildStrategy(level) {
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
    const output = {
        initial_tyre_id: initialTyreId,
        laps: [],
    };
    let currentSpeed = 0;
    for (let lap = 1; lap <= laps; lap += 1) {
        const segments = [];
        for (let index = 0; index < trackSegments.length; index += 1) {
            const segment = trackSegments[index];
            if (!segment) {
                continue;
            }
            if (segment.type === "straight") {
                const safeEntrySpeed = getCornerChainSpeed(trackSegments, index, tyreFriction);
                const maxTargetSpeed = car["max_speed_m/s"];
                const targetSpeed = clamp(computeMaxReachableSpeed(currentSpeed, safeEntrySpeed, segment.length_m, car["accel_m/se2"], car["brake_m/se2"], maxTargetSpeed), currentSpeed, maxTargetSpeed);
                const brakeDistance = computeBrakingDistance(targetSpeed, safeEntrySpeed, car["brake_m/se2"]);
                const brakeStart = Math.max(0, segment.length_m - brakeDistance);
                segments.push({
                    id: segment.id,
                    type: "straight",
                    "target_m/s": roundTo(targetSpeed, 2),
                    "brake_start_m_before_next": roundTo(brakeStart, 2),
                });
                currentSpeed = safeEntrySpeed;
            }
            else {
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
function main() {
    const levelPath = path.join(__dirname, "..", "1.txt");
    const outputPath = path.join(__dirname, "..", "output.json");
    const raw = fs.readFileSync(levelPath, "utf8");
    const level = JSON.parse(raw);
    const strategy = buildStrategy(level);
    fs.writeFileSync(outputPath, JSON.stringify(strategy, null, 2), "utf8");
    process.stdout.write(`Strategy generated: ${outputPath}\n`);
}
main();
//# sourceMappingURL=index.js.map