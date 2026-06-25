package za.companycup;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import za.companycup.model.InputModels;
import za.companycup.model.OutputModels;
import za.companycup.planner.StrategyPlanner;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

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
            String resource = "/level/" + inputArg + ".txt";
            try (InputStream is = Main.class.getResourceAsStream(resource)) {
                if (is == null) {
                    System.err.println("Bundled resource not found: " + resource);
                    System.exit(1);
                }
                inputPath = Files.createTempFile("level" + inputArg, ".json");
                inputPath.toFile().deleteOnExit();
                Files.write(inputPath, is.readAllBytes());
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
        System.out.println("Submission written to: " + outputPath.toAbsolutePath());

        // Always regenerate the source zip so it reflects the latest code.
        Path projectRoot = Path.of(".").toAbsolutePath().normalize();
        Path zipPath = zipSourceForSubmission(projectRoot);
        System.out.println("Submission zip updated:  " + zipPath);
    }

    /**
     * Zips the entire project source tree (excluding the {@code target/} build directory)
     * into {@code submission_source.zip} placed one level above the project root.
     * The previous zip is silently replaced.
     *
     * @param projectRoot  absolute path to the java project folder
     * @return             path of the written zip file
     */
    private static Path zipSourceForSubmission(Path projectRoot) throws Exception {
        // Place the zip next to the java/ folder so it is easy to find for submission.
        Path zipPath = projectRoot.getParent().resolve("submission_source.zip");

        try (ZipOutputStream zos = new ZipOutputStream(
                Files.newOutputStream(zipPath, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING));
             var walk = Files.walk(projectRoot)) {

            walk.filter(p -> {
                        Path rel = projectRoot.relativize(p);
                        String first = rel.getName(0).toString();
                        // Exclude target/ and any hidden dot-directories at the root level.
                        return !first.equals("target") && !first.startsWith(".");
                    })
                    .filter(Files::isRegularFile)
                    .forEach(file -> {
                        // Entry path always uses forward slashes and is rooted at "java/"
                        String entry = "java/" + projectRoot.relativize(file).toString().replace('\\', '/');
                        try {
                            zos.putNextEntry(new ZipEntry(entry));
                            Files.copy(file, zos);
                            zos.closeEntry();
                        } catch (Exception e) {
                            throw new RuntimeException("Failed to zip " + file, e);
                        }
                    });
        }
        return zipPath;
    }
}
