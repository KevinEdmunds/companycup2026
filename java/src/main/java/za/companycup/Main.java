package za.companycup;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import za.companycup.model.InputModels;
import za.companycup.model.OutputModels;
import za.companycup.planner.StrategyPlanner;

import java.nio.file.Files;
import java.nio.file.Path;

public final class Main {
    private Main() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("Usage: java -jar f1-level1-strategist.jar <input-level-json> <output-json>");
            System.exit(1);
        }

        Path inputPath = Path.of(args[0]);
        Path outputPath = Path.of(args[1]);

        ObjectMapper mapper = new ObjectMapper();
        mapper.enable(SerializationFeature.INDENT_OUTPUT);

        InputModels.LevelInput input = mapper.readValue(inputPath.toFile(), InputModels.LevelInput.class);
        OutputModels.Submission submission = StrategyPlanner.plan(input);

        if (outputPath.getParent() != null) {
            Files.createDirectories(outputPath.getParent());
        }
        mapper.writeValue(outputPath.toFile(), submission);
    }
}

