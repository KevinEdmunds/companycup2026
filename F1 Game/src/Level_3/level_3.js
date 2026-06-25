import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/* ------------------------------------------------------------------ */
/* Constants / tunables                                               */
/* ------------------------------------------------------------------ */
const GRAVITY = 9.8;
const K_DRAG = 0.0000000015;
const USE_CRAWL_CORNER_BONUS = false;
const CORNER_SPEED_SAFETY = 0.1;
/**
 * Half-window (s) around a corner's estimated arrival time over which we take
 * the WORST tyre friction. It absorbs the small uncertainty between our planned
 * time and the simulator's actual time so that timing drift near a weather
 * change can never make us enter a corner too fast.
 */
const CORNER_WEATHER_HALF_WINDOW_S = 60;
const STINT_FUEL_RESERVE = 8;
const FINISH_FUEL_RESERVE = 5;
const FUEL_SAFETY_FACTOR = 1.05;
const COND_FRICTION_KEY = {
    dry: "dry_friction_multiplier",
    cold: "cold_friction_multiplier",
    light_rain: "light_rain_friction_multiplier",
    heavy_rain: "heavy_rain_friction_multiplier",
};
/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */
const floor2 = (v) => Math.floor(v * 100) / 100;
const ceil2 = (v) => Math.ceil(v * 100) / 100;
function frictionInCondition(props, condition) {
    const key = COND_FRICTION_KEY[condition] ?? "dry_friction_multiplier";
    return props.base_friction * props[key];
}
function cornerSafeSpeed(radius, friction, crawl) {
    const bonus = USE_CRAWL_CORNER_BONUS ? crawl : 0;
    return Math.max(crawl, Math.sqrt(friction * GRAVITY * radius) + bonus - CORNER_SPEED_SAFETY);
}
function peakSpeed(entry, exit, length, accel, brake, maxSpeed) {
    if (length <= 0 || accel <= 0 || brake <= 0)
        return Math.min(maxSpeed, Math.max(entry, exit));
    const sq = (2 * accel * brake * length + brake * entry ** 2 + accel * exit ** 2) / (accel + brake);
    const peak = sq <= 0 ? 0 : Math.sqrt(sq);
    return Math.min(maxSpeed, peak);
}
function buildSchedule(conditions, startingId) {
    const ordered = [...conditions];
    const startIdx = ordered.findIndex((c) => c.id === startingId);
    const rotated = startIdx > 0 ? [...ordered.slice(startIdx), ...ordered.slice(0, startIdx)] : ordered;
    const phases = [];
    let t = 0;
    for (const w of rotated) {
        phases.push({ start: t, end: t + w.duration_s, w });
        t += w.duration_s;
    }
    return { total: t, phases };
}
function weatherAt(time, schedule) {
    const first = schedule.phases[0];
    if (!first || schedule.total <= 0) {
        return first?.w ?? { id: 1, condition: "dry", duration_s: Infinity, acceleration_multiplier: 1, deceleration_multiplier: 1 };
    }
    let tt = time % schedule.total;
    if (tt < 0)
        tt += schedule.total;
    for (const p of schedule.phases)
        if (tt >= p.start && tt < p.end)
            return p.w;
    return schedule.phases[schedule.phases.length - 1].w;
}
/** Worst (lowest) tyre friction over [center-half, center+half]. */
function worstFrictionAround(center, half, schedule, soft) {
    let worst = Number.POSITIVE_INFINITY;
    for (let s = -half; s <= half + 1e-9; s += half / 2) {
        worst = Math.min(worst, frictionInCondition(soft, weatherAt(center + s, schedule).condition));
    }
    return worst;
}
/** Worst (lowest) deceleration multiplier over [start, start+window] — brake early to stay safe. */
function worstDecelMult(start, window, schedule) {
    let worst = Number.POSITIVE_INFINITY;
    for (let s = 0; s <= window + 1e-9; s += window / 4) {
        worst = Math.min(worst, weatherAt(start + s, schedule).deceleration_multiplier);
    }
    return worst;
}
function buildStrategy(level) {
    const car = level.car;
    const segments = level.track.segments;
    const n = segments.length;
    const laps = level.race.laps;
    const maxSpeed = car["max_speed_m/s"];
    const crawl = car["crawl_constant_m/s"];
    const baseAccel = car["accel_m/se2"];
    const baseBrake = car["brake_m/se2"];
    const kBase = car["fuel_consumption_l/m"];
    const tank = car["fuel_tank_capacity_l"];
    const schedule = buildSchedule(level.weather.conditions, level.race.starting_weather_condition_id);
    // Soft has the highest friction in every weather here and tyres do not degrade
    // in Level 3, so we run Soft the whole race and pit only for fuel.
    const softProps = level.tyres.properties["Soft"];
    if (!softProps)
        throw new Error("Soft tyre properties missing.");
    const softSet = level.available_sets.find((s) => s.compound === "Soft") ?? level.available_sets[0];
    const initialTyreId = softSet?.ids[0] ?? 1;
    /** Min safe speed across the corner chain after `straightIndex`, each corner
     *  evaluated at its (live) estimated arrival time with a safety window. */
    const cornerChainExitSpeed = (straightIndex, arrivalTime) => {
        let idx = (straightIndex + 1) % n;
        let t = arrivalTime;
        let minSp = Number.POSITIVE_INFINITY;
        for (let c = 0; c < n; c += 1) {
            const seg = segments[idx];
            if (!seg || seg.type !== "corner")
                break;
            if (seg.radius_m === undefined)
                throw new Error(`Corner ${seg.id} missing radius_m.`);
            const fr = worstFrictionAround(t, CORNER_WEATHER_HALF_WINDOW_S, schedule, softProps);
            const sp = cornerSafeSpeed(seg.radius_m, fr, crawl);
            minSp = Math.min(minSp, sp);
            t += seg.length_m / Math.max(sp, crawl);
            idx = (idx + 1) % n;
        }
        return Number.isFinite(minSp) ? minSp : maxSpeed;
    };
    let time = 0;
    let fuel = car["initial_fuel_l"];
    let speed = 0;
    let totalFuelUsed = 0;
    let pitCount = 0;
    let totalRefuel = 0;
    const lapList = [];
    for (let lap = 1; lap <= laps; lap += 1) {
        const segActions = [];
        for (let i = 0; i < n; i += 1) {
            const seg = segments[i];
            const wEntry = weatherAt(time, schedule);
            const accelEff = baseAccel * wEntry.acceleration_multiplier;
            if (seg.type === "straight") {
                const nextSeg = segments[(i + 1) % n];
                let exitSpeed;
                if (nextSeg.type === "straight") {
                    exitSpeed = maxSpeed; // carry full speed into the next straight
                }
                else {
                    const arrivalEst = time + seg.length_m / 50; // rough; safety window absorbs error
                    exitSpeed = cornerChainExitSpeed(i, arrivalEst);
                }
                // brake point: worst-case decel over the run-up so we brake early enough
                const decelSafe = baseBrake * worstDecelMult(time, seg.length_m / 40 + 45, schedule);
                const decelTime = baseBrake * wEntry.deceleration_multiplier; // for accurate timing
                const cruise = floor2(Math.max(peakSpeed(speed, exitSpeed, seg.length_m, accelEff, decelSafe, maxSpeed), exitSpeed));
                const brakeFrom = Math.max(cruise, speed);
                const rawBrake = brakeFrom > exitSpeed ? (brakeFrom ** 2 - exitSpeed ** 2) / (2 * decelSafe) : 0;
                const brakeStart = Math.min(seg.length_m, ceil2(rawBrake));
                const accelDist = Math.max(0, seg.length_m - brakeStart);
                const vPeak = Math.min(Math.sqrt(speed * speed + 2 * accelEff * accelDist), Math.max(cruise, speed), maxSpeed);
                const exit = Math.max(Math.sqrt(Math.max(0, vPeak * vPeak - 2 * decelTime * brakeStart)), crawl);
                const tAccel = accelEff > 0 ? (vPeak - speed) / accelEff : 0;
                const tBrake = decelTime > 0 ? (vPeak - exit) / decelTime : 0;
                const dAccel = ((speed + vPeak) / 2) * tAccel;
                const dBrake = ((vPeak + exit) / 2) * tBrake;
                const tCruise = vPeak > 0 ? Math.max(0, seg.length_m - dAccel - dBrake) / vPeak : 0;
                const used = (kBase + K_DRAG * ((speed + vPeak) / 2) ** 2) * accelDist;
                fuel -= used;
                totalFuelUsed += used;
                time += tAccel + tCruise + tBrake;
                speed = exit;
                segActions.push({ id: seg.id, type: "straight", "target_m/s": cruise, brake_start_m_before_next: brakeStart });
            }
            else {
                if (seg.radius_m === undefined)
                    throw new Error(`Corner ${seg.id} missing radius_m.`);
                const fr = frictionInCondition(softProps, wEntry.condition);
                const safe = cornerSafeSpeed(seg.radius_m, fr, crawl);
                const cornerSp = Math.min(speed, safe);
                speed = cornerSp;
                const used = (kBase + K_DRAG * cornerSp * cornerSp) * seg.length_m;
                fuel -= used;
                totalFuelUsed += used;
                time += seg.length_m / Math.max(cornerSp, crawl);
                segActions.push({ id: seg.id, type: "corner" });
            }
        }
        // Pit decision at end of lap (fuel only).
        let pit = { enter: false };
        const lapsRemaining = laps - lap;
        const perLapForecast = (totalFuelUsed / lap) * FUEL_SAFETY_FACTOR;
        if (lapsRemaining > 0 && fuel < perLapForecast + STINT_FUEL_RESERVE) {
            const remainingNeed = perLapForecast * lapsRemaining + FINISH_FUEL_RESERVE;
            const refuel = ceil2(Math.min(tank - fuel, Math.max(0, remainingNeed - fuel)));
            if (refuel > 0) {
                fuel += refuel;
                totalRefuel += refuel;
                pitCount += 1;
                time += level.race.base_pit_stop_time_s + refuel / level.race["pit_refuel_rate_l/s"];
                speed = level.race["pit_exit_speed_m/s"];
                pit = { enter: true, fuel_refuel_amount_l: refuel };
            }
        }
        lapList.push({ lap, segments: segActions, pit });
    }
    const softCap = level.race.fuel_soft_cap_limit_l;
    const fuelBonus = -1_000_000 * (1 - totalFuelUsed / softCap) ** 2 + 1_000_000;
    const summary = `Tyre: Soft (id ${initialTyreId}) the whole race (highest friction in every condition, no degradation in L3).\n` +
        `Race time: ${time.toFixed(1)} s | total fuel used: ${totalFuelUsed.toFixed(1)} L (soft cap ${softCap})\n` +
        `Pit stops: ${pitCount} | total refuel: ${totalRefuel.toFixed(1)} L | est. fuel bonus: ${Math.round(fuelBonus).toLocaleString()}`;
    return { output: { initial_tyre_id: initialTyreId, laps: lapList }, summary };
}
/* ------------------------------------------------------------------ */
/* Entry point                                                        */
/* ------------------------------------------------------------------ */
function main() {
    const levelPath = path.join(__dirname, "3.txt");
    const outputPath = path.join(__dirname, "output.txt");
    const level = JSON.parse(fs.readFileSync(levelPath, "utf8"));
    const { output, summary } = buildStrategy(level);
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");
    process.stdout.write(`Level 3 strategy written to ${outputPath}\n${summary}\n`);
}
main();
//# sourceMappingURL=level_3.js.map