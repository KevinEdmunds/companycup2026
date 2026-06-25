# Company Cup 2026 - Level 1 Deterministic Strategist

This Maven project reads a Level JSON file and writes a deterministic strategy JSON output.

## What it does

- Picks an initial tyre set deterministically (best dry friction, first available id)
- Computes safe corner entry speeds using tyre friction and corner radius
- For each straight, computes:
  - `target_m/s`
  - `brake_start_m_before_next`
- Repeats the same valid lap strategy for all race laps
- Produces `pit.enter = false` for Level 1

## Build and test

```bash
mvn -f C:/Development/companycup2026/java/pom.xml test
mvn -f C:/Development/companycup2026/java/pom.xml package
```

## Run

```bash
java -jar C:/Development/companycup2026/java/target/f1-level1-strategist-1.0.0-jar-with-dependencies.jar C:/Development/companycup2026/Spec/1.txt C:/Development/companycup2026/java/out/submission.json
```

Output file:
- `C:/Development/companycup2026/java/out/submission.json`

