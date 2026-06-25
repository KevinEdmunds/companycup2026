package za.companycup.planner;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import za.companycup.model.InputModels;
import za.companycup.model.OutputModels;

import java.io.InputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StrategyPlannerTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void producesDeterministicAndValidLevel1Plan() throws Exception {
        InputModels.LevelInput input = read("/level1.json");

        OutputModels.Submission s1 = StrategyPlanner.plan(input);
        OutputModels.Submission s2 = StrategyPlanner.plan(input);

        assertEquals(mapper.writeValueAsString(s1), mapper.writeValueAsString(s2));
        assertEquals(1, s1.initialTyreId);
        assertEquals(50, s1.laps.size());

        OutputModels.LapPlan lap = s1.laps.get(0);
        assertEquals(15, lap.segments.size());
        assertNotNull(lap.pit);
        assertTrue(!lap.pit.enter);

        // Ensure all straight actions include deterministic targets and braking points.
        lap.segments.stream()
                .filter(seg -> "straight".equals(seg.type))
                .forEach(seg -> {
                    assertNotNull(seg.targetSpeed);
                    assertNotNull(seg.brakeStartBeforeNext);
                    assertTrue(seg.brakeStartBeforeNext >= 0);
                });
    }

    @Test
    void producesDeterministicAndValidLevel2Plan() throws Exception {
        InputModels.LevelInput input = read("/level2.json");

        OutputModels.Submission s1 = StrategyPlanner.plan(input);
        OutputModels.Submission s2 = StrategyPlanner.plan(input);

        // Must be deterministic
        assertEquals(mapper.writeValueAsString(s1), mapper.writeValueAsString(s2));

        // Must contain exactly 60 laps
        assertEquals(60, s1.laps.size(), "Level 2 must produce exactly 60 laps");

        // Every lap must have all 25 segments
        s1.laps.forEach(lap -> assertEquals(25, lap.segments.size()));

        // Verify at least one pit stop with refuelling occurs (tank cannot cover 60 laps)
        long pitLaps = s1.laps.stream().filter(l -> l.pit != null && l.pit.enter).count();
        assertTrue(pitLaps >= 1, "Level 2 must have at least one pit stop to refuel");

        // Straight segments must have targets and brake points
        s1.laps.get(0).segments.stream()
                .filter(seg -> "straight".equals(seg.type))
                .forEach(seg -> {
                    assertNotNull(seg.targetSpeed);
                    assertNotNull(seg.brakeStartBeforeNext);
                    assertTrue(seg.brakeStartBeforeNext >= 0);
                });
    }

    private InputModels.LevelInput read(String resourcePath) throws Exception {
        try (InputStream is = getClass().getResourceAsStream(resourcePath)) {
            assertNotNull(is);
            return mapper.readValue(is, InputModels.LevelInput.class);
        }
    }
}

