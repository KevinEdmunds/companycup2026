import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const level = JSON.parse(fs.readFileSync(path.join(dir, "3.txt"), "utf8"));
const sub = JSON.parse(fs.readFileSync(path.join(dir, "output.txt"), "utf8"));

const G = 9.8;
const K_DRAG = 0.0000000015;
const car = level.car;
const A0 = car["accel_m/se2"];
const B0 = car["brake_m/se2"];
const MAX = car["max_speed_m/s"];
const CRAWL = car["crawl_constant_m/s"];
const LIMP = car["limp_constant_m/s"];
const K_BASE = car["fuel_consumption_l/m"];
const TANK = car["fuel_tank_capacity_l"];
const PENALTY = level.race.corner_crash_penalty_s;
const BASE_PIT = level.race.base_pit_stop_time_s;
const REFUEL_RATE = level.race["pit_refuel_rate_l/s"];
const PIT_EXIT = level.race["pit_exit_speed_m/s"];
const SOFTCAP = level.race.fuel_soft_cap_limit_l;

const soft = level.tyres.properties.Soft;
const condKey = {
  dry: "dry_friction_multiplier",
  cold: "cold_friction_multiplier",
  light_rain: "light_rain_friction_multiplier",
  heavy_rain: "heavy_rain_friction_multiplier",
};

// weather schedule (rotated to starting id)
const conds = level.weather.conditions;
const startIdx = conds.findIndex((c) => c.id === level.race.starting_weather_condition_id);
const ordered = startIdx > 0 ? [...conds.slice(startIdx), ...conds.slice(0, startIdx)] : conds;
const phases = [];
let tt = 0;
for (const w of ordered) {
  phases.push({ start: tt, end: tt + w.duration_s, w });
  tt += w.duration_s;
}
const TOTAL = tt;
function weatherAt(t) {
  let x = t % TOTAL;
  if (x < 0) x += TOTAL;
  for (const p of phases) if (x >= p.start && x < p.end) return p.w;
  return phases[phases.length - 1].w;
}
const frictionAt = (t) => soft.base_friction * soft[condKey[weatherAt(t).condition]];

const segById = new Map(level.track.segments.map((s) => [s.id, s]));

let speed = 0;
let time = 0;
let fuel = car["initial_fuel_l"];
let crashes = 0;
let limp = false;
let minFuel = fuel;
let totalUsed = 0;
const weatherSeen = new Set();

for (const lap of sub.laps) {
  for (const action of lap.segments) {
    const seg = segById.get(action.id);
    const L = seg.length_m;
    const w = weatherAt(time);
    weatherSeen.add(w.condition);
    const A = A0 * w.acceleration_multiplier;
    const B = B0 * w.deceleration_multiplier;

    if (seg.type === "straight") {
      const brakeStart = action["brake_start_m_before_next"];
      const target = action["target_m/s"];
      const accelDist = Math.max(0, L - brakeStart);
      if (limp) {
        time += L / LIMP;
        speed = LIMP;
        totalUsed += (K_BASE + K_DRAG * LIMP * LIMP) * L;
        fuel -= (K_BASE + K_DRAG * LIMP * LIMP) * L;
      } else {
        const vPeak = Math.min(Math.sqrt(speed * speed + 2 * A * accelDist), Math.max(target, speed), MAX);
        const exit = Math.max(Math.sqrt(Math.max(0, vPeak * vPeak - 2 * B * brakeStart)), CRAWL);
        const tAccel = (vPeak - speed) / A;
        const tBrake = (vPeak - exit) / B;
        const dAccel = ((speed + vPeak) / 2) * tAccel;
        const dBrake = ((vPeak + exit) / 2) * tBrake;
        const tCruise = Math.max(0, L - dAccel - dBrake) / vPeak;
        time += tAccel + tCruise + tBrake;
        const used = (K_BASE + K_DRAG * ((speed + vPeak) / 2) ** 2) * accelDist;
        fuel -= used;
        totalUsed += used;
        speed = exit;
      }
    } else {
      if (!limp) {
        const limit = Math.sqrt(frictionAt(time) * G * seg.radius_m); // strict, no margin
        if (speed > limit + 1e-9) {
          crashes += 1;
          time += PENALTY;
          speed = CRAWL;
        }
      } else {
        speed = LIMP;
      }
      time += L / Math.max(speed, CRAWL);
      const used = (K_BASE + K_DRAG * speed * speed) * L;
      fuel -= used;
      totalUsed += used;
    }

    if (fuel < minFuel) minFuel = fuel;
    if (fuel <= 0 && !limp) {
      limp = true;
      fuel = 0;
    }
  }

  if (lap.pit && lap.pit.enter) {
    const amt = lap.pit.fuel_refuel_amount_l ?? 0;
    fuel = Math.min(TANK, fuel + amt);
    time += BASE_PIT + amt / REFUEL_RATE + (lap.pit.tyre_change_set_id ? level.race.pit_tyre_swap_time_s : 0);
    if (limp && fuel > 0) limp = false;
    speed = PIT_EXIT;
  }
}

const baseScore = 1e9 / time;
const fuelBonus = -1_000_000 * (1 - totalUsed / SOFTCAP) ** 2 + 1_000_000;
console.log("weather seen:", [...weatherSeen].join(", "));
console.log("total time (s):", time.toFixed(2));
console.log("crashes:", crashes, "| ran out of fuel:", limp);
console.log("min fuel (L):", minFuel.toFixed(2), "| total fuel used (L):", totalUsed.toFixed(2), "| soft cap:", SOFTCAP);
console.log("base score:", Math.round(baseScore).toLocaleString(), "| fuel bonus:", Math.round(fuelBonus).toLocaleString());
console.log("FINAL (base+fuel):", Math.round(baseScore + fuelBonus).toLocaleString());
