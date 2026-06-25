package za.companycup.planner;

import za.companycup.model.InputModels;
import za.companycup.model.OutputModels;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class StrategyPlanner {

    // =========================================================================
    // STRATEGY TUNING — tweak these to explore different strategies
    // =========================================================================

    /**
     * Fraction of the car's max speed to target on every straight.
     *   Min: 0.1  → very slow, saves fuel, terrible race time
     *   Max: 1.0  → full speed, fastest lap, highest fuel consumption  (default)
     */
    private static final double STRAIGHT_SPEED_FRACTION = 1.0;

    /**
     * Multiplier applied to the fuel-per-lap estimate when planning pit laps.
     * A higher value makes the planner more conservative (pits earlier / more often).
     *   Min: 1.0  → no safety margin — may run dry if the estimate is slightly off
     *   Max: 1.5  → 50 % over-estimate — very safe, but forces extra pit stops
     */
    private static final double FUEL_ESTIMATE_MULTIPLIER = 1.05;

    /**
     * Pit when the fuel remaining falls below this many laps-worth of fuel.
     * Increase to pit earlier and carry a larger safety buffer.
     *   Min: 0.0  → pit only when the tank is truly empty (dangerous)
     *   Max: 5.0  → pit very early, many stops, slower overall race
     */
    private static final double FUEL_RESERVE_LAPS = 1.0;

    // =========================================================================
    // PHYSICS & SPEC CONSTANTS — defined by the problem specification; do not change
    // =========================================================================

    /** Gravitational constant (m/s²). Fixed: 9.8 */
    private static final double GRAVITY = 9.8;

    /** Base fuel consumption rate (l/m). Fixed by spec: 0.0005 */
    private static final double K_BASE  = 0.0005;

    /** Speed-dependent (drag) fuel consumption (l/m per (m/s)²). Fixed by spec: 0.0000000015 */
    private static final double K_DRAG  = 0.0000000015;

    private StrategyPlanner() {
    }

    public static OutputModels.Submission plan(InputModels.LevelInput input) {
        OutputModels.Submission submission = new OutputModels.Submission();
        submission.initialTyreId = pickInitialTyreSetId(input);

        List<InputModels.Segment> segments = input.track.segments;
        Map<Integer, Double> safeCornerSpeeds = buildSafeCornerSpeedMap(input, submission.initialTyreId);
        double[] requiredCornerEntrySpeedByIndex = buildRequiredCornerEntryByIndex(segments, safeCornerSpeeds);

        // Pre-simulate a steady-state lap to get a conservative (slightly high) fuel estimate.
        // Used only to decide WHICH laps to pit — refuel amounts are computed from actual fuel state.
        double fuelPerLapEstimate = estimateFuelPerLap(input, segments, requiredCornerEntrySpeedByIndex);
        java.util.Set<Integer> pitLapNumbers = planPitLaps(input, fuelPerLapEstimate);

        double lapStartSpeed = 0.0;
        double fuel = input.car.initialFuel;   // track actual fuel during generation

        for (int lap = 1; lap <= input.race.laps; lap++) {
            OutputModels.LapPlan lapPlan = new OutputModels.LapPlan();
            lapPlan.lap = lap;

            double entrySpeed = lapStartSpeed;
            for (int i = 0; i < segments.size(); i++) {
                InputModels.Segment segment = segments.get(i);
                InputModels.Segment next = segments.get((i + 1) % segments.size());

                OutputModels.SegmentAction action = new OutputModels.SegmentAction();
                action.id = segment.id;
                action.type = segment.type;

                if (isStraight(segment)) {
                    double desiredExit = isCorner(next)
                            ? requiredCornerEntrySpeedByIndex[(i + 1) % segments.size()]
                            : input.car.maxSpeed;
                    StraightPlan straightPlan = buildStraightPlan(
                            entrySpeed,
                            desiredExit,
                            segment.length,
                            input.car.accel,
                            input.car.brake,
                            input.car.maxSpeed * STRAIGHT_SPEED_FRACTION
                    );
                    action.targetSpeed = round2(straightPlan.targetSpeed);
                    action.brakeStartBeforeNext = Math.max(0.0, straightPlan.brakeDistance);

                    // Track actual fuel for this straight (accel + cruise + brake phases)
                    double accelDist = accelDistance(entrySpeed, straightPlan.targetSpeed, input.car.accel);
                    double brakeDist = brakeDistance(straightPlan.targetSpeed, straightPlan.exitSpeed, input.car.brake);
                    double cruiseDist = Math.max(0.0, segment.length - accelDist - brakeDist);
                    fuel -= fuelUsed(entrySpeed, straightPlan.targetSpeed, accelDist);
                    fuel -= fuelUsed(straightPlan.targetSpeed, straightPlan.targetSpeed, cruiseDist);
                    fuel -= fuelUsed(straightPlan.targetSpeed, straightPlan.exitSpeed, brakeDist);

                    entrySpeed = straightPlan.exitSpeed;
                } else {
                    double cornerSpeed = Math.min(entrySpeed, requiredCornerEntrySpeedByIndex[i]);
                    fuel -= fuelUsed(cornerSpeed, cornerSpeed, segment.length);
                    entrySpeed = cornerSpeed;
                }

                lapPlan.segments.add(action);
            }

            // Determine if we need to pit this lap (planned OR fuel critically low)
            boolean shouldPit = pitLapNumbers.contains(lap) || (fuel < fuelPerLapEstimate && lap < input.race.laps);

            OutputModels.Pit pit = new OutputModels.Pit();
            if (shouldPit && lap < input.race.laps) {
                int lapsRemaining = input.race.laps - lap;
                // Refuel just enough for remaining laps (based on actual fuel now), capped by tank
                double fuelNeeded = fuelPerLapEstimate * lapsRemaining;
                double refuelAmount = Math.max(0.0,
                        Math.min(fuelNeeded - fuel, input.car.fuelTankCapacity - fuel));
                if (refuelAmount > 0.0) {
                    pit.enter = true;
                    pit.fuelRefuelAmount = round2(refuelAmount);
                    fuel += refuelAmount;
                    lapStartSpeed = input.race.pitExitSpeed;
                } else {
                    pit.enter = false;
                    lapStartSpeed = entrySpeed;
                }
            } else {
                pit.enter = false;
                lapStartSpeed = entrySpeed;
            }
            lapPlan.pit = pit;
            submission.laps.add(lapPlan);
        }

        return submission;
    }

    // -----------------------------------------------------------------------
    // Fuel helpers
    // -----------------------------------------------------------------------

    /**
     * Simulate a lap starting from rest to estimate fuel consumption.
     * Intentionally conservative (slightly overestimates) to trigger pits early enough.
     */
    private static double estimateFuelPerLap(InputModels.LevelInput input,
                                             List<InputModels.Segment> segments,
                                             double[] requiredCornerEntry) {
        double fuel = 0.0;
        double entrySpeed = 0.0;

        for (int i = 0; i < segments.size(); i++) {
            InputModels.Segment segment = segments.get(i);
            InputModels.Segment next = segments.get((i + 1) % segments.size());

            if (isStraight(segment)) {
                double desiredExit = isCorner(next)
                        ? requiredCornerEntry[(i + 1) % segments.size()]
                        : input.car.maxSpeed;
                StraightPlan sp = buildStraightPlan(
                        entrySpeed, desiredExit, segment.length,
                        input.car.accel, input.car.brake, input.car.maxSpeed);

                double accelDist = accelDistance(entrySpeed, sp.targetSpeed, input.car.accel);
                double brakeDist = brakeDistance(sp.targetSpeed, sp.exitSpeed, input.car.brake);
                double cruiseDist = Math.max(0.0, segment.length - accelDist - brakeDist);

                fuel += fuelUsed(entrySpeed, sp.targetSpeed, accelDist);
                fuel += fuelUsed(sp.targetSpeed, sp.targetSpeed, cruiseDist);
                fuel += fuelUsed(sp.targetSpeed, sp.exitSpeed, brakeDist);
                entrySpeed = sp.exitSpeed;
            } else {
                double cornerSpeed = Math.min(entrySpeed, requiredCornerEntry[i]);
                fuel += fuelUsed(cornerSpeed, cornerSpeed, segment.length);
                entrySpeed = cornerSpeed;
            }
        }
        return fuel;
    }

    /** Fuel formula: F = (K_base + K_drag * avg_v²) * distance */
    private static double fuelUsed(double vi, double vf, double distance) {
        if (distance <= 0.0) return 0.0;
        double avgSpeed = (vi + vf) / 2.0;
        return (K_BASE + K_DRAG * avgSpeed * avgSpeed) * distance;
    }

    /**
     * Return the set of lap numbers where we should enter the pits.
     * Uses the conservative fuelPerLap estimate so we never run dry.
     */
    private static java.util.Set<Integer> planPitLaps(InputModels.LevelInput input, double fuelPerLap) {
        java.util.Set<Integer> pitLaps = new java.util.LinkedHashSet<>();
        int totalLaps = input.race.laps;
        double tankCapacity = input.car.fuelTankCapacity;
        double fuel = input.car.initialFuel;

        for (int lap = 1; lap <= totalLaps; lap++) {
            fuel -= fuelPerLap;
            // Pit if reserve falls below FUEL_RESERVE_LAPS and there are laps remaining
            if (fuel < fuelPerLap * FUEL_RESERVE_LAPS && lap < totalLaps) {
                pitLaps.add(lap);
                // Simulate refuel to full (conservative — actual may differ)
                fuel = tankCapacity;
            }
        }
        return pitLaps;
    }

    private static double[] buildRequiredCornerEntryByIndex(List<InputModels.Segment> segments,
                                                            Map<Integer, Double> safeCornerById) {
        double[] required = new double[segments.size()];
        for (int i = segments.size() - 1; i >= 0; i--) {
            InputModels.Segment segment = segments.get(i);
            if (!isCorner(segment)) {
                required[i] = Double.NaN;
                continue;
            }

            double ownLimit = safeCornerById.get(segment.id);
            int nextIndex = (i + 1) % segments.size();
            InputModels.Segment next = segments.get(nextIndex);

            if (isCorner(next) && !Double.isNaN(required[nextIndex])) {
                required[i] = Math.min(ownLimit, required[nextIndex]);
            } else {
                required[i] = ownLimit;
            }
        }
        return required;
    }

    private static boolean isStraight(InputModels.Segment segment) {
        return "straight".equalsIgnoreCase(segment.type);
    }

    private static boolean isCorner(InputModels.Segment segment) {
        return "corner".equalsIgnoreCase(segment.type);
    }

    private static Map<Integer, Double> buildSafeCornerSpeedMap(InputModels.LevelInput input, int initialTyreId) {
        Map<Integer, Double> map = new HashMap<>();

        String compound = findCompoundBySetId(input, initialTyreId);
        InputModels.TyreProperty tyre = input.tyres.properties.get(compound);
        double weatherMultiplier = getWeatherMultiplier(input, tyre);
        double friction = tyre.baseFriction * weatherMultiplier;

        for (InputModels.Segment segment : input.track.segments) {
            if (!isCorner(segment) || segment.radius == null) {
                continue;
            }
            double maxCorner = Math.sqrt(friction * GRAVITY * segment.radius);
            double safeCorner = Math.max(input.car.crawlSpeed, maxCorner);
            map.put(segment.id, safeCorner);
        }

        return map;
    }

    private static String findCompoundBySetId(InputModels.LevelInput input, int setId) {
        for (InputModels.AvailableSet set : input.availableSets) {
            if (set.ids != null && set.ids.contains(setId)) {
                return set.compound;
            }
        }
        throw new IllegalStateException("No tyre compound found for set id " + setId);
    }

    private static int pickInitialTyreSetId(InputModels.LevelInput input) {
        String bestCompound = null;
        double bestDryFriction = Double.NEGATIVE_INFINITY;

        for (Map.Entry<String, InputModels.TyreProperty> entry : input.tyres.properties.entrySet()) {
            double dryFriction = entry.getValue().baseFriction * entry.getValue().dryFrictionMultiplier;
            if (dryFriction > bestDryFriction) {
                bestDryFriction = dryFriction;
                bestCompound = entry.getKey();
            }
        }

        for (InputModels.AvailableSet set : input.availableSets) {
            if (set.compound.equals(bestCompound) && set.ids != null && !set.ids.isEmpty()) {
                return set.ids.get(0);
            }
        }

        throw new IllegalStateException("Could not select an initial tyre set.");
    }

    private static double getWeatherMultiplier(InputModels.LevelInput input, InputModels.TyreProperty tyre) {
        if (input.weather == null || input.weather.conditions == null || input.weather.conditions.isEmpty()) {
            return tyre.dryFrictionMultiplier;
        }
        String condition = input.weather.conditions.get(0).condition;
        if (condition == null) return tyre.dryFrictionMultiplier;
        return switch (condition.toLowerCase(Locale.ROOT)) {
            case "cold"        -> tyre.coldFrictionMultiplier;
            case "light_rain"  -> tyre.lightRainFrictionMultiplier;
            case "heavy_rain"  -> tyre.heavyRainFrictionMultiplier;
            default            -> tyre.dryFrictionMultiplier; // "dry" or unknown
        };
    }


    private static StraightPlan buildStraightPlan(double entrySpeed,
                                                  double desiredExit,
                                                  double length,
                                                  double accel,
                                                  double brake,
                                                  double maxSpeed) {
        double vi = clamp(entrySpeed, 0.0, maxSpeed);
        double ve = clamp(desiredExit, 0.0, maxSpeed);

        double candidateTarget = maxSpeed;
        double accelDistance = accelDistance(vi, candidateTarget, accel);
        double brakeDistance = brakeDistance(candidateTarget, ve, brake);

        if (accelDistance + brakeDistance > length) {
            double vp2 = ((2.0 * length) + (vi * vi / accel) + (ve * ve / brake))
                    / ((1.0 / accel) + (1.0 / brake));
            candidateTarget = clamp(Math.sqrt(Math.max(vp2, 0.0)), Math.max(vi, ve), maxSpeed);
            brakeDistance = brakeDistance(candidateTarget, ve, brake);
        }

        StraightPlan plan = new StraightPlan();
        plan.targetSpeed = candidateTarget;
        plan.brakeDistance = Math.min(length, Math.max(0.0, brakeDistance));
        plan.exitSpeed = ve;
        return plan;
    }

    private static double accelDistance(double vi, double vf, double accel) {
        if (vf <= vi) {
            return 0.0;
        }
        return (vf * vf - vi * vi) / (2.0 * accel);
    }

    private static double brakeDistance(double vi, double vf, double brake) {
        if (vi <= vf) {
            return 0.0;
        }
        return (vi * vi - vf * vf) / (2.0 * brake);
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private static final class StraightPlan {
        private double targetSpeed;
        private double brakeDistance;
        private double exitSpeed;
    }
}

