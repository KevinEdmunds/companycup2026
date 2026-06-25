package za.companycup.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.ArrayList;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public final class OutputModels {
    private OutputModels() {
    }

    public static class Submission {
        @JsonProperty("initial_tyre_id")
        public int initialTyreId;
        public List<LapPlan> laps = new ArrayList<>();
    }

    public static class LapPlan {
        public int lap;
        public List<SegmentAction> segments = new ArrayList<>();
        public Pit pit;
    }

    public static class SegmentAction {
        public int id;
        public String type;

        @JsonProperty("target_m/s")
        public Double targetSpeed;

        @JsonProperty("brake_start_m_before_next")
        public Double brakeStartBeforeNext;
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Pit {
        public boolean enter;
        @JsonProperty("tyre_change_set_id")
        public Integer tyreChangeSetId;
        @JsonProperty("fuel_refuel_amount_l")
        public Double fuelRefuelAmount;
    }
}

