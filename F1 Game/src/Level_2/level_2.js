import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/* ------------------------------------------------------------------ */
/* Tunables / constants                                               */
/* ------------------------------------------------------------------ */
const GRAVITY = 9.8;
/** Fuel drag coefficient (spec constant K_drag, l/m). */
const K_DRAG = 0.0000000015;
/**
 * Corner-speed formula is inconsistent in the spec (one section adds
 * `+ crawl_constant`, the other does not). A crash is catastrophic, so we use
 * the conservative form by default. Flip to `true` only if your simulator
 * implements the crawl bonus.
 */
const USE_CRAWL_CORNER_BONUS = false;
/** Speed safety buffer (m/s) subtracted from the theoretical corner limit. */
const CORNER_SPEED_SAFETY = 0.1;
/** Fuel (L) kept in reserve at the end of every refuelling stint. */
const STINT_FUEL_RESERVE = 10;
/** Fuel (L) we aim to still have crossing the finish line. */
const FINISH_FUEL_RESERVE = 5;
const WEATHER_FRICTION_KEY = {
    dry: "dry_friction_multiplier",
    cold: "cold_friction_multiplier",
    light_rain: "light_rain_friction_multiplier",
    heavy_rain: "heavy_rain_friction_multiplier",
};
/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
const floor2 = (v) => Math.floor(v * 100) / 100;
const ceil2 = (v) => Math.ceil(v * 100) / 100;
function getActiveWeather(level) {
    const id = level.race.starting_weather_condition_id;
    const found = level.weather.conditions.find((w) => w.id === id);
    return (found ??
        level.weather.conditions[0] ?? {
        id: 1,
        condition: "dry",
        acceleration_multiplier: 1,
        deceleration_multiplier: 1,
    });
}
function tyreFriction(props, weather) {
    const key = WEATHER_FRICTION_KEY[weather.condition] ?? "dry_friction_multiplier";
    return props.base_friction * props[key];
}
/** Pick the compound with the highest available friction for the active weather. */
function pickBestTyre(level, weather) {
    let best;
    for (const set of level.available_sets) {
        const props = level.tyres.properties[set.compound];
        const firstId = set.ids[0];
        if (!props || firstId === undefined)
            continue;
        const friction = tyreFriction(props, weather);
        if (!best || friction > best.friction)
            best = { id: firstId, friction };
    }
    if (!best)
        throw new Error("No usable tyre set found in level file.");
    return best;
}
function cornerSafeSpeed(radius, friction, crawl) {
    const bonus = USE_CRAWL_CORNER_BONUS ? crawl : 0;
    const limit = Math.sqrt(friction * GRAVITY * radius) + bonus;
    return Math.max(crawl, limit - CORNER_SPEED_SAFETY);
}
/**
 * Maximum speed allowed at the END of every segment (the hand-off speed to the
 * next segment), propagated backwards around the lap. This naturally:
 *   - carries full speed across consecutive straights (only braking on the last
 *     straight(s) before a corner), and
 *   - forces a chain of consecutive corners to share the slowest corner's speed.
 */
function computeSpeedCaps(segments, friction, maxSpeed, crawl, brake) {
    const n = segments.length;
    const entryCap = new Array(n).fill(maxSpeed);
    const exitCap = new Array(n).fill(maxSpeed);
    // Periodic track: a few backward passes let braking zones propagate across
    // the start/finish line and across multi-segment chains.
    for (let pass = 0; pass < 3; pass += 1) {
        for (let k = n - 1; k >= 0; k -= 1) {
            const seg = segments[k];
            if (!seg)
                continue;
            const nextEntry = entryCap[(k + 1) % n] ?? maxSpeed;
            if (seg.type === "corner") {
                if (seg.radius_m === undefined)
                    throw new Error(`Corner ${seg.id} missing radius_m.`);
                const speed = Math.min(cornerSafeSpeed(seg.radius_m, friction, crawl), nextEntry);
                exitCap[k] = speed;
                entryCap[k] = speed; // constant speed through a corner
            }
            else {
                const ex = Math.min(maxSpeed, nextEntry);
                exitCap[k] = ex;
                entryCap[k] = Math.min(maxSpeed, Math.sqrt(ex * ex + 2 * brake * seg.length_m));
            }
        }
    }
    return exitCap;
}
/** Peak speed reachable on a straight: accelerate from `entry`, brake to `exit`, capped at `maxSpeed`. */
function peakSpeed(entry, exit, length, accel, brake, maxSpeed) {
    if (length <= 0 || accel <= 0 || brake <= 0)
        return Math.min(maxSpeed, Math.max(entry, exit));
    const sq = (2 * accel * brake * length + brake * entry ** 2 + accel * exit ** 2) / (accel + brake);
    const peak = sq <= 0 ? 0 : Math.sqrt(sq);
    return Math.min(maxSpeed, peak);
}
/**
 * Per-segment fuel, matching the simulator exactly:
 *   - corner:   (K_base + K_drag * v^2) * length
 *   - straight: (K_base + K_drag * ((entry + peak)/2)^2) * (length - brakeDistance)
 *     i.e. the braking portion of a straight burns NO fuel.
 */
function segmentFuel(kBase, s) {
    if (s.type === "corner") {
        return (kBase + K_DRAG * s.vIn * s.vIn) * s.length;
    }
    const peak = s.peak ?? s.vIn;
    const avg = (s.vIn + peak) / 2;
    const burnDistance = Math.max(0, s.length - (s.brakeStart ?? 0));
    return (kBase + K_DRAG * avg * avg) * burnDistance;
}
function computeLapProfile(segments, startSpeed, exitCaps, car, accel, brake) {
    const maxSpeed = car["max_speed_m/s"];
    const segs = [];
    let speed = startSpeed;
    for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i];
        if (!seg)
            continue;
        const exitSpeed = exitCaps[i] ?? maxSpeed;
        if (seg.type !== "straight") {
            const cornerSpeed = Math.min(speed, exitSpeed);
            segs.push({ id: seg.id, type: "corner", vIn: cornerSpeed, vOut: cornerSpeed, length: seg.length_m });
            speed = cornerSpeed;
            continue;
        }
        const cruise = floor2(Math.max(peakSpeed(speed, exitSpeed, seg.length_m, accel, brake, maxSpeed), exitSpeed));
        const brakeFrom = Math.max(cruise, speed);
        const rawBrake = brakeFrom > exitSpeed ? (brakeFrom ** 2 - exitSpeed ** 2) / (2 * brake) : 0;
        const brakeStart = Math.min(seg.length_m, ceil2(rawBrake));
        segs.push({
            id: seg.id,
            type: "straight",
            target: cruise,
            brakeStart,
            peak: brakeFrom,
            vIn: speed,
            vOut: exitSpeed,
            length: seg.length_m,
        });
        speed = exitSpeed;
    }
    return { segs, endSpeed: speed };
}
/* ------------------------------------------------------------------ */
/* Pit / fuel planning                                                */
/* ------------------------------------------------------------------ */
/**
 * Decide which laps to pit on and how much to refuel. Splits the race into the
 * fewest possible stints that each fit in the tank, then refuels only enough to
 * reach the next stop (plus a reserve) so we finish near-empty.
 */
function planRefuelStops(perLapFuel, laps, tank, initialFuel) {
    const usablePerStint = tank - STINT_FUEL_RESERVE;
    const maxLapsPerStint = Math.max(1, Math.floor(usablePerStint / perLapFuel));
    const stintCount = Math.ceil(laps / maxLapsPerStint);
    // Even-ish stint sizes (in laps).
    const base = Math.floor(laps / stintCount);
    const remainder = laps - base * stintCount;
    const stintLaps = Array.from({ length: stintCount }, (_, i) => base + (i < remainder ? 1 : 0));
    // Lap number on which each stint ends; we pit at the end of all but the last.
    const stintEndLap = [];
    let acc = 0;
    for (const len of stintLaps) {
        acc += len;
        stintEndLap.push(acc);
    }
    const refuelByLap = new Map();
    let fuel = initialFuel;
    for (let s = 0; s < stintCount; s += 1) {
        const stintLen = stintLaps[s] ?? 0;
        fuel -= stintLen * perLapFuel; // burn this stint
        const isLast = s === stintCount - 1;
        if (isLast)
            break;
        const nextLen = stintLaps[s + 1] ?? 0;
        const nextIsLast = s + 1 === stintCount - 1;
        const targetAfter = nextLen * perLapFuel + (nextIsLast ? FINISH_FUEL_RESERVE : STINT_FUEL_RESERVE);
        const refuel = Math.min(tank - fuel, Math.max(0, targetAfter - fuel));
        const pitLap = stintEndLap[s];
        if (pitLap !== undefined)
            refuelByLap.set(pitLap, ceil2(refuel));
        fuel += refuel;
    }
    return refuelByLap;
}
function buildStrategy(level) {
    const weather = getActiveWeather(level);
    const tyre = pickBestTyre(level, weather);
    const car = level.car;
    const kBase = car["fuel_consumption_l/m"];
    const tank = car["fuel_tank_capacity_l"];
    const initialFuel = car["initial_fuel_l"];
    const accel = car["accel_m/se2"] * weather.acceleration_multiplier;
    const brake = car["brake_m/se2"] * weather.deceleration_multiplier;
    const laps = level.race.laps;
    const segments = level.track.segments;
    const maxSpeed = car["max_speed_m/s"];
    const crawl = car["crawl_constant_m/s"];
    // Backward-propagated speed cap at the end of every segment.
    const exitCaps = computeSpeedCaps(segments, tyre.friction, maxSpeed, crawl, brake);
    // Two passes so segment 1 uses the steady-state entry speed (laps 2..N).
    const firstPass = computeLapProfile(segments, 0, exitCaps, car, accel, brake);
    const steady = computeLapProfile(segments, firstPass.endSpeed, exitCaps, car, accel, brake);
    const perLapFuel = steady.segs.reduce((sum, s) => sum + segmentFuel(kBase, s), 0);
    const totalFuel = perLapFuel * laps;
    const refuelByLap = planRefuelStops(perLapFuel, laps, tank, initialFuel);
    // Shared per-lap segment actions (identical every lap in Level 2).
    const segmentActions = steady.segs.map((s) => s.type === "straight"
        ? {
            id: s.id,
            type: "straight",
            "target_m/s": s.target ?? 0,
            brake_start_m_before_next: s.brakeStart ?? 0,
        }
        : { id: s.id, type: "corner" });
    let totalRefuel = 0;
    const lapList = Array.from({ length: laps }, (_, idx) => {
        const lap = idx + 1;
        const refuel = refuelByLap.get(lap);
        let pit;
        if (refuel !== undefined && refuel > 0) {
            pit = { enter: true, fuel_refuel_amount_l: refuel };
            totalRefuel += refuel;
        }
        else {
            pit = { enter: false };
        }
        return { lap, segments: segmentActions, pit };
    });
    const refuelRate = level.race["pit_refuel_rate_l/s"];
    const pitCount = refuelByLap.size;
    const pitTime = pitCount * level.race.base_pit_stop_time_s + totalRefuel / refuelRate;
    const softCap = level.race.fuel_soft_cap_limit_l;
    const fuelBonus = -1_000_000 * (1 - totalFuel / softCap) ** 2 + 1_000_000;
    const summary = `Tyre: ${tyre.id} | per-lap fuel: ${perLapFuel.toFixed(3)} L | total fuel used: ${totalFuel.toFixed(1)} L\n` +
        `Pit stops: ${pitCount} on laps [${[...refuelByLap.keys()].join(", ")}] | total refuel: ${totalRefuel.toFixed(1)} L | added pit time: ${pitTime.toFixed(1)} s\n` +
        `Soft cap: ${softCap} L | est. fuel bonus: ${Math.round(fuelBonus).toLocaleString()}`;
    return { output: { initial_tyre_id: tyre.id, laps: lapList }, summary };
}
/* ------------------------------------------------------------------ */
/* Entry point                                                        */
/* ------------------------------------------------------------------ */
function main() {
    const levelPath = path.join(__dirname, "2.txt");
    const outputPath = path.join(__dirname, "output.txt");
    const level = JSON.parse(fs.readFileSync(levelPath, "utf8"));
    const { output, summary } = buildStrategy(level);
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");
    process.stdout.write(`Level 2 strategy written to ${outputPath}\n${summary}\n`);
}
main();
//# sourceMappingURL=level_2.js.map