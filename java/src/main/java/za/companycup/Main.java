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
            System.err.println("Usage: java -jar f1-strategist.jar <input-level-json-OR-level-number> <output-json>");
            System.err.println("  e.g.: java -jar f1-strategist.jar 2 submission_level2.txt");
            System.exit(1);
        }

        // Allow passing a bare level number (1, 2, 3, 4) as first arg — reads from bundled resources.
        String inputArg = args[0];
        Path outputPath = Path.of(args[1]);

        Path inputPath;
        if (inputArg.matches("\\d+")) {
            // Copy bundled resource to a temp file so ObjectMapper can read it
            String resource = "/level/" + inputArg + ".txt";
            try (java.io.InputStream is = Main.class.getResourceAsStream(resource)) {
                if (is == null) {
                    System.err.println("Bundled resource not found: " + resource);
                    System.exit(1);
                }
                inputPath = java.nio.file.Files.createTempFile("level" + inputArg, ".json");
                inputPath.toFile().deleteOnExit();
                java.nio.file.Files.write(inputPath, is.readAllBytes());
            }
        } else {
            inputPath = Path.of(inputArg);
        }

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

