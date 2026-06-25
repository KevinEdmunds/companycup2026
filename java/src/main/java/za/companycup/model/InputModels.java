package za.companycup.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

public final class InputModels {
    private InputModels() {
    }

    public static class LevelInput {
        public Car car;
        public Race race;
        public Track track;
        public Tyres tyres;
        @JsonProperty("available_sets")
        public List<AvailableSet> availableSets;
        public Weather weather;
    }

    public static class Car {
        @JsonProperty("max_speed_m/s")
        public double maxSpeed;
        @JsonProperty("accel_m/se2")
        public double accel;
        @JsonProperty("brake_m/se2")
        public double brake;
        @JsonProperty("limp_constant_m/s")
        public double limpSpeed;
        @JsonProperty("crawl_constant_m/s")
        public double crawlSpeed;
        @JsonProperty("fuel_tank_capacity_l")
        public double fuelTankCapacity;
        @JsonProperty("initial_fuel_l")
        public double initialFuel;
        @JsonProperty("fuel_consumption_l/m")
        public double fuelConsumption;
    }

    public static class Race {
        public String name;
        public int laps;
        @JsonProperty("base_pit_stop_time_s")
        public double basePitStopTime;
        @JsonProperty("pit_tyre_swap_time_s")
        public double pitTyreSwapTime;
        @JsonProperty("pit_refuel_rate_l/s")
        public double pitRefuelRate;
        @JsonProperty("corner_crash_penalty_s")
        public double cornerCrashPenalty;
        @JsonProperty("pit_exit_speed_m/s")
        public double pitExitSpeed;
        @JsonProperty("fuel_soft_cap_limit_l")
        public double fuelSoftCapLimit;
        @JsonProperty("starting_weather_condition_id")
        public int startingWeatherConditionId;
        @JsonProperty("time_reference_s")
        public double timeReference;
    }

    public static class Track {
        public String name;
        public List<Segment> segments;
    }

    public static class Segment {
        public int id;
        public String type;
        @JsonProperty("length_m")
        public double length;
        @JsonProperty("radius_m")
        public Double radius;
    }

    public static class Tyres {
        public Map<String, TyreProperty> properties;
    }

    public static class TyreProperty {
        @JsonProperty("life_span")
        public double lifeSpan;
        @JsonProperty("base_friction")
        public double baseFriction;
        @JsonProperty("dry_friction_multiplier")
        public double dryFrictionMultiplier;
        @JsonProperty("cold_friction_multiplier")
        public double coldFrictionMultiplier;
        @JsonProperty("light_rain_friction_multiplier")
        public double lightRainFrictionMultiplier;
        @JsonProperty("heavy_rain_friction_multiplier")
        public double heavyRainFrictionMultiplier;
        @JsonProperty("dry_degradation")
        public double dryDegradation;
        @JsonProperty("cold_degradation")
        public double coldDegradation;
        @JsonProperty("light_rain_degradation")
        public double lightRainDegradation;
        @JsonProperty("heavy_rain_degradation")
        public double heavyRainDegradation;
    }

    public static class AvailableSet {
        public List<Integer> ids;
        public String compound;
    }

    public static class Weather {
        public List<Condition> conditions;
    }

    public static class Condition {
        public int id;
        public String condition;
        @JsonProperty("duration_s")
        public double duration;
        @JsonProperty("acceleration_multiplier")
        public double accelerationMultiplier;
        @JsonProperty("deceleration_multiplier")
        public double decelerationMultiplier;
    }
}

