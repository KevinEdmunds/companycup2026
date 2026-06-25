package za.companycup.planner;

import za.companycup.model.InputModels;
import za.companycup.model.OutputModels;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class StrategyPlanner {
    private static final double GRAVITY = 9.8;

    private StrategyPlanner() {
    }

    public static OutputModels.Submission plan(InputModels.LevelInput input) {
        OutputModels.Submission submission = new OutputModels.Submission();
        submission.initialTyreId = pickInitialTyreSetId(input);

        List<InputModels.Segment> segments = input.track.segments;
        Map<Integer, Double> safeCornerSpeeds = buildSafeCornerSpeedMap(input, submission.initialTyreId);
        double[] requiredCornerEntrySpeedByIndex = buildRequiredCornerEntryByIndex(segments, safeCornerSpeeds);

        double lapStartSpeed = 0.0;

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
                            input.car.maxSpeed
                    );
                    action.targetSpeed = round2(straightPlan.targetSpeed);
                    action.brakeStartBeforeNext = (int) Math.ceil(Math.max(0.0, straightPlan.brakeDistance));
                    entrySpeed = straightPlan.exitSpeed;
                } else {
                    entrySpeed = Math.min(entrySpeed, requiredCornerEntrySpeedByIndex[i]);
                }

                lapPlan.segments.add(action);
            }

            OutputModels.Pit pit = new OutputModels.Pit();
            pit.enter = false;
            lapPlan.pit = pit;
            submission.laps.add(lapPlan);

            lapStartSpeed = entrySpeed;
        }

        return submission;
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

    private static boolean dryLikeCondition(InputModels.LevelInput input) {
        if (input.weather == null || input.weather.conditions == null || input.weather.conditions.isEmpty()) {
            return true;
        }
        String condition = input.weather.conditions.get(0).condition;
        return condition != null && condition.toLowerCase(Locale.ROOT).contains("dry");
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

