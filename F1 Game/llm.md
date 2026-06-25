# Entelect Grand Prix
### An F1 Inspired Race Simulation Problem
**Entelect Hackathons — Company Cup**
*June 2026 | 1st Edition*

---

## Introduction

Welcome to the start of the brand new Entelect Racing Season! Your task is to create the optimal race strategy given information about the racetrack layout, your car and the various tyre compounds available. Your strategy must be resource-efficient and well optimized for speed around the track to maximize points.

## Goal

As the race strategist, you must develop a program that generates the actions that your car will take during the race, namely:

- What tyres to use
- Target speed on straights
- When to brake along straights
- When to take a pit stop to change tyres and/or refuel

You will need to consider weather conditions when selecting tyres to optimize how fast you can safely go around the track. If you take corners too quickly based on your current tyres, their health, and weather conditions, you will suffer a time penalty and greater tyre wear.

You will ultimately be rewarded for completing the race in the fastest time possible while managing your tyres and fuel effectively; you will receive further score multipliers based on how close you are to the limit of the resources available to you. Going over the limit will result in a lower score.

### Visual Aid for Example Level Track

The example track consists of 8 segments, alternating between straights and corners, forming a closed loop:

| Segment ID | Type | Target Speed | Notes |
|---|---|---|---|
| ID1 | Straight | 70 m/s | Has a braking point before ID2 |
| ID2 | Corner | — | |
| ID3 | Straight | 50 m/s | Has a braking point before ID4 |
| ID4 | Corner | — | |
| ID5 | Corner | — | |
| ID6 | Corner | — | |
| ID7 | Straight | 60 m/s | Has a braking point before ID8 |
| ID8 | Corner | — | |

The layout flows: ID1 (straight) → ID2 (corner) → ID3 (straight) → ID4 (corner) → ID5 (corner) → ID6 (corner) → ID7 (straight) → ID8 (corner) → back to ID1.

---

## Assumptions

1. **Constant Acceleration** — The car accelerates at a constant rate, defined in the JSON level file.
2. **Constant Deceleration** — The car decelerates at a constant rate, defined in the JSON level file.
3. **Limp Mode Trigger** — If the car runs out of fuel or a tyre blows during a track segment, the car enters limp mode. The affected segment and all following segments remain in limp mode until a pit stop is made to fix the issue.
4. **Limp Mode Speed** — While in limp mode, the car moves at a slow constant speed. There is no acceleration or deceleration during this time. Limp mode speed is defined in the JSON level file.
5. **Corner Speed** — When entering a corner, the entry speed remains constant for the entire corner. No acceleration or deceleration occurs while taking the corner.
6. **Realism** — The racetracks are fictional and are not necessarily realistic in terms of length, corners, laps, or track layout from start to finish. Tyre compound properties are also fictional and not necessarily realistic.
7. **Race Start Speed** — The race begins with the car at a speed of 0 m/s.
8. **Pit Stop Exit Speed** — After completing a pit stop, the car exits the pit lane at the pit lane speed, defined in the JSON level file.
9. **Crawl Mode Trigger** — If you take a corner too quickly, the car veers off the track and crashes. The car is then set to travel at a slow constant speed (no acceleration) for any subsequent corners until a straight is encountered to start accelerating again.
10. **Minimum Speed = Crawl Speed** — During the race, the slowest you can travel is crawl speed, defined in the JSON level file.
11. **Speed Follow-through** — If you specify a target speed that is slower than your entry speed for a straight, you will just continue at that entry speed for the rest of that straight.
12. **SI Units** — All values are represented using SI (meters and seconds) units. The JSON properties also specify the unit of measurement used for the value.

---

## Constraints

### Car

**Acceleration / Deceleration**
- Acceleration is constant on straights. The car accelerates at a constant rate until the target speed you specify is met, after which the car travels at constant speed until the braking point.
- Deceleration (braking) is constant on straights. The car starts slowing down at a constant rate for the remainder of the straight after the braking point.
- Both values are defined in the JSON file.
- Both values are affected by weather; there is a multiplier that positively or negatively affects acceleration and deceleration.

**Speed Constraints**
- The car cannot exceed the Maximum Speed defined in the JSON file.
- Car speed remains constant for the entire corner.
- Maximum allowed corner speed is determined by:

$$
\text{max corner speed} = \sqrt{\text{tyre friction} \times \text{gravity} \times \text{radius}} + \text{crawl\_constant\_m/s}
$$

**Limp Mode**
- Triggered if fuel reaches 0 during a segment OR tyre life span drops to 0 (a blowout occurs).
- Speed becomes constant, defined by Limp Mode Maximum Speed in the JSON file.
- No acceleration or deceleration.
- Applies to all subsequent segments until a pit stop is taken.

**Crawl Mode**
- Triggered if your car takes a corner too quickly (i.e. crashes).
- You travel at the specified crawl mode constant speed, defined in the JSON file.
- Because you can only accelerate on a straight, you travel at crawl mode speed for any subsequent corners leading up to the next straight after a crash.

**Time to accelerate from initial speed to final speed:**

$$
time = \frac{final\ speed - initial\ speed}{accel\_m/se^2}
$$

---

### Tyres

There are 5 tyre types available: **Soft, Medium, Hard, Intermediate, Wet**.

Each tyre compound behaves differently on the track, providing varying levels of friction that affect how fast a car can take corners. Weather conditions also influence the available friction. If no weather condition is specified, it defaults to dry.

As tyres wear down, their available friction and life span gradually decrease. When the life span reaches zero, the tyre blows out and the car enters limp mode. The car remains in limp mode until a pit stop is taken and the tyres are replaced.

If you choose to change tyres during a pit stop, the tyre's unique identifier must be referenced in the pit stop section of the JSON submission. You may switch to a set that is not fully worn by referencing its unique identifier.

#### Tyre Properties Table

| Property | Soft | Medium | Hard | Intermediate | Wet |
|---|---|---|---|---|---|
| Base Friction Coefficient | 1.8 | 1.7 | 1.6 | 1.2 | 1.1 |
| Dry Multiplier | 1.18 | 1.08 | 0.98 | 0.90 | 0.72 |
| Cold Multiplier | 1.00 | 0.97 | 0.92 | 0.96 | 0.88 |
| Light Rain Multiplier | 0.92 | 0.88 | 0.82 | 1.08 | 1.02 |
| Heavy Rain Multiplier | 0.80 | 0.74 | 0.68 | 1.02 | 1.20 |
| Dry Rate of Degradation | 0.14 | 0.10 | 0.07 | 0.11 | 0.16 |
| Cold Rate of Degradation | 0.11 | 0.08 | 0.06 | 0.09 | 0.12 |
| Light Rain Rate of Degradation | 0.12 | 0.09 | 0.07 | 0.08 | 0.09 |
| Heavy Rain Rate of Degradation | 0.13 | 0.10 | 0.08 | 0.09 | 0.05 |

**Use cases:**
- **Wet tyres** — Great in rainy weather, outperformed by other tyres in dry weather.
- **Hard tyres** — Great if planning a late pit stop, as they have the longest life span among the dry tyres.
- **Soft tyres** — Great if planning an early pit stop, as they have the shortest life span among the dry tyres.

#### Degradation Constants

| Degradation Type | Value |
|---|---|
| K_STRAIGHT | 0.0000166 |
| K_BRAKING | 0.0398 |
| K_CORNER | 0.000265 |

**Straights — tyre degradation formula:**

$$
\text{Total Straight Degradation} = \text{tyre degradation rate} \times \text{track segment length} \times K\_STRAIGHT
$$

**Braking — tyre degradation while braking on a straight:**

$$
\text{Degradation while Braking} = \left[\left(\frac{\text{initial speed}}{100}\right)^2 - \left(\frac{\text{final speed}}{100}\right)^2\right] \times K\_BRAKING \times \text{tyre degradation rate}
$$

**Corners — tyre degradation formula:**

$$
\text{Total Corner Degradation} = K\_CORNER \times \frac{\text{speed}^2}{\text{radius}} \times \text{tyre degradation rate}
$$

**Tyre Friction formula:**

$$
\text{tyre friction} = (\text{base friction coefficient} - \text{total degradation}) \times \text{weather multiplier}
$$

**Example:** Soft tyre in dry weather with accumulated total degradation of 0.5:

$$
\text{tyre friction} = (1.8 - 0.5) \times 1 = 1.3 \times 1 = 1.3
$$

---

### Fuel

Fuel consumption depends on the speed of the car during the race. Driving at higher speeds results in higher fuel usage. You must balance speed and fuel efficiency to ensure the car can complete the race without running out of fuel.

> In **Level 1**, there are no fuel limitations, allowing you to become familiar with the race simulation. In later levels, fuel management becomes an important factor — you must make conscious choices about fuel usage.

**Fuel Usage Constants:**
- **K_base**: Base fuel consumption rate — 0.0005 l/m
- **K_drag**: Fuel consumption based on speed — 0.0000000015 l/m

**Fuel Usage Formula:**

$$
F_{used} = \left(K_{base} + K_{drag}\left(\frac{\text{initial speed} + \text{final speed}}{2}\right)^2\right) \times \text{distance}
$$

**Example:**
- Initial speed $v_i = 50$ m/s
- Final speed $v_f = 70$ m/s
- Distance $d = 800$ m

$$
F_{used} = \left(0.0005 + 0.0000000015 \left(\frac{50+70}{2}\right)^2\right) \times 800 = 0.40432 \text{ litres}
$$

**Refueling:**

When refueling during a pit stop, the time taken depends on the amount of fuel being filled.

$$
\text{refuel time (s)} = \frac{\text{amount to refuel (L)}}{\text{refuel rate (L/s)}}
$$

**Example:** Refuel 30L at a refuel rate of 10 L/s:

$$
\text{refuel time (s)} = \frac{30}{10} = 3 \text{ seconds}
$$

---

### Track

A track is an ordered list of segments (straights and corners). Each segment has the following properties:

- Length (m)
- Type
- Radius (corners only)

Refer to the **Tyres** section for the formula and examples of calculating tyre friction.

The track also includes a pit lane entry which is accessible only at the end of the lap.

**Straights:**
- You need to define your target speed for that straight.
- You must specify in your JSON submission the point in the straight (in m) at which braking begins.

**Corners:**
- Corners have a maximum speed at which the car can safely take them, based on current tyre friction and the radius of the corner.
- Exceeding this maximum speed causes the car to veer off track and crash, resulting in a time penalty and major tyre degradation.
- The time penalty for crashing is defined in the JSON file as `corner_crash_penalty_s`.
- Maximum allowed corner speed:

$$
\text{Max corner speed} = \sqrt{\text{tyre friction} \times \text{gravity} \times \text{radius}}
$$

**Example:** Tyre friction of 0.9, gravity constant of 9.8, corner radius of 50:

$$
\text{Max corner speed} = \sqrt{0.9 \times 9.8 \times 50} = 21 \text{ m/s}
$$

---

### Pit Stops

The pit lane is only accessible at the end of the lap. The pit lane is not a segment that forms part of the track but can optionally be entered at the end of the track.

**Available pit stop options:**
- Change tyres
- Refuel
- Both changing tyres and refueling

When making a pit stop, you must specify which tyres you are switching to (by tyre ID) and the amount of fuel you want to fill up. If either value is not provided or is zero, it is assumed you are not making that change.

The time taken for the pit stop depends on:
- Pit tyre swap time (defined in JSON)
- Amount to be refueled (rate in L/s, defined in JSON)
- Base pit stop time (defined in JSON)

**Formula:**

$$
\text{pit stop time (s)} = \text{refuel time} + \text{pit tyre swap time} + \text{base pit stop time}
$$

**Example:** Pit stop consisting of refueling 30L at a rate of 10 L/s, a tyre change taking 5s, and a base pit stop time of 20s:

$$
\text{pit stop time (s)} = \left(\frac{30}{10}\right) + 5 + 20 = 28 \text{ seconds}
$$

---

### Weather

During the race, weather conditions change at specific times, as provided in the level JSON file. If no weather condition is specified, it defaults to dry.

**Weather change properties:**
- Time of weather change
- Duration of weather conditions (if the race time is long enough that all weather conditions have cycled through, it starts again from the first condition)

**Weather affects:**
- Acceleration
- Deceleration
- Tyre wear

**Weather condition types:**
- Dry
- Cold
- Light Rain
- Heavy Rain

As seen in the Tyres section, each tyre compound has different wear rates and friction multipliers based on weather.

---

### Penalties

You will incur penalties for the following:

- **Taking a corner too fast** results in increased tyre wear, a time penalty, and the car entering crawl mode.
  - The time penalty is configured in the JSON as `corner_crash_penalty_s` and is added to your current lap time at the time of the crash.
  - The tyre penalty is a flat 0.1 degradation to the current tyre set.
  - Crawl mode causes the car to travel at a constant speed until another straight is encountered to start accelerating again.
- **Running out of fuel OR experiencing a tyre blowout** results in the car entering limp mode.
  - Limp mode causes the car to travel at limp mode constant speed until a pit stop is taken to refuel and/or change tyres.

---

## Levels

Each level file defines the characteristics of the race, including the car, track, tyres, and other parameters. All race factors must be considered when developing your race strategy for submission. **Each level adds new factors while building on the previous ones** (i.e. Level 2 contains the rules from Level 1, in addition to its own).

### Level 1
Basic rules to help get you familiar with the problem and achieve the best possible race time. Focus on:
- Navigating the track.
- Choosing when to brake on straights.
- Defining the target speed on straights.
- Entering corners at an appropriate speed to safely take them.
- Choosing the appropriate tyre compound to start the race with — tyres do not degrade in Level 1.

### Level 2
Fuel management and pit stops are introduced. In addition to Level 1, focus on:
- Managing fuel usage by adjusting your target speeds per segment.
- Tracking fuel usage.
- Taking pit stops to refuel.
- Avoiding running out of fuel during the race to prevent entering limp mode.
- Optimizing race time and fuel usage to maximize the fuel efficiency multiplier at the end for scoring.
- The fuel allowance for the race is a "soft cap" — it may be exceeded, but the more you go over, the more negatively your score is affected.

### Level 3
Weather is introduced, which greatly affects tyre and pit stop strategies. In addition to previous levels, focus on:
- Keeping track of the race time and when the weather will change.
- Choosing the correct tyre for the weather conditions.
- Pitting for tyre changes when the weather conditions change.
- Adjusting target speeds and braking points as the friction of the tyres are affected by weather changes.

### Level 4
A large focus on tyre degradation and how tyre performance changes the more it gets used. In addition to previous levels, focus on:
- Keeping track of tyre degradation and overall tyre health.
- Adjusting target speeds and braking points as tyres degrade.
- Taking pit stops to avoid tyre blowouts and entering limp mode.
- Managing a limited set of available tyres and tyre compounds.
- Optimizing race time and tyre usage to use as much tyre health as possible to maximize the tyre efficiency multiplier at the end for scoring.

---

## Scoring

### Level 1

A time penalty is applied whenever a player has exceeded the maximum speed at which a corner can be taken. This time penalty is defined in the Level 1 JSON file as the `corner_crash_penalty_s` property under `race`.

$$
\text{base score} = \frac{1\,000\,000\,000}{time}
$$

### Level 2 & Level 3

$$
\text{fuel bonus} = -1\,000\,000\left(1 - \frac{\text{fuel used}}{\text{fuel\_soft\_cap\_limit\_l}}\right)^2 + 1\,000\,000
$$

$$
\text{final score} = \text{base score} + \text{fuel bonus}
$$

### Level 4

$$
\text{tyre bonus} = 100\,000 \times \sum \text{tyre degradation} - 50\,000 \times \text{number of blowouts}
$$

$$
\text{final score} = \text{base score} + \text{tyre bonus} + \text{fuel bonus}
$$

---

## Submissions

Participants must submit their solution on the Entelect Hackathon website. The submission must include two items:

1. A ZIP of the source code.
2. A `.txt` file containing the output.

The solution must be **deterministic** — given the same input, the program must always produce the same output. During validation, the submitted source code will be executed to reproduce the results provided in the submission. If the source code does not produce the same output as the submitted file, the submission will be considered invalid.

The `.txt` file must contain a valid JSON object describing the race configuration, which should include:

- Initial tyre id
- Actions taken during each segment in each lap

### Example Submission

```json
{
  "initial_tyre_id": 1,
  "laps": [
    {
      "lap": 1,
      "segments": [
        {
          "id": 1,
          "type": "straight",
          "target_m/s": 70,
          "brake_start_m_before_next": 800
        },
        {
          "id": 2,
          "type": "corner"
        },
        {
          "id": 3,
          "type": "straight",
          "target_m/s": 50,
          "brake_start_m_before_next": 500
        },
        {
          "id": 4,
          "type": "corner"
        },
        {
          "id": 5,
          "type": "corner"
        },
        {
          "id": 6,
          "type": "corner"
        },
        {
          "id": 7,
          "type": "straight",
          "target_m/s": 60,
          "brake_start_m_before_next": 500
        },
        {
          "id": 8,
          "type": "corner"
        }
      ],
      "pit": {
        "enter": false
      }
    },
    {
      "lap": 2,
      "segments": [
        {
          "id": 1,
          "type": "straight",
          "target_m/s": 70,
          "brake_start_m_before_next": 800
        },
        {
          "id": 2,
          "type": "corner"
        },
        {
          "id": 3,
          "type": "straight",
          "target_m/s": 50,
          "brake_start_m_before_next": 500
        },
        {
          "id": 4,
          "type": "corner"
        },
        {
          "id": 5,
          "type": "corner"
        },
        {
          "id": 6,
          "type": "corner"
        },
        {
          "id": 7,
          "type": "straight",
          "target_m/s": 60,
          "brake_start_m_before_next": 500
        },
        {
          "id": 8,
          "type": "corner"
        }
      ],
      "pit": {
        "enter": true,
        "tyre_change_set_id": 3,
        "fuel_refuel_amount_l": 20
      }
    }
  ]
}
```

---

## Appendix

### Objects

#### Car

| Property Name | JSON Property Name | Unit of Measurement | Explanation |
|---|---|---|---|
| Maximum Speed | `max_speed_m/s` | Meters per second | The maximum speed the car can reach at any point on the track. |
| Acceleration | `accel_m/se2` | Meters per second² | The constant rate at which the car increases speed on straight segments. |
| Deceleration | `brake_m/se2` | Meters per second² | The constant rate at which the car reduces speed when slowing down for corners on straight segments. |
| Limp Mode Speed | `limp_constant_m/s` | Meters per second | The speed the car travels at while operating in limp mode. |
| Crawl Mode Speed | `crawl_constant_m/s` | Meters per second | The speed the car travels at while operating in crawl mode. |
| Fuel Tank Capacity | `fuel_tank_capacity_l` | Litres | The maximum amount of fuel the car's fuel tank can hold. |
| Initial Fuel | `initial_fuel_l` | Litres | The amount of fuel in the car at the start of the race. |

#### Race

| Property Name | JSON Property Name | Unit of Measurement | Explanation |
|---|---|---|---|
| Race Name | `name` | N/A | The name of the race. |
| Number of Laps | `laps` | N/A | The total number of laps for the race. |
| Pit Stop Tyre Change Time | `pit_tyre_swap_time_s` | Seconds | The time taken to change tyres during a pit stop. |
| Base Pit Stop Time | `base_pit_stop_time_s` | Seconds | The base time taken in the pit lane. |
| Pit Stop Tyre and Fuel Time | `pit_refuel_rate_l/s` | Litres/second | The rate at which refueling is done in litres per second. |
| Corner Crash Penalty | `corner_crash_penalty_s` | Seconds | A time penalty applied when a car takes a corner too fast and veers off the track. |
| Pit Exit Speed | `pit_exit_speed_m/s` | Meters/second | The speed at which you start at when exiting the pit lane. |
| Fuel Soft Cap Limit | `fuel_soft_cap_limit` | Litres | The soft cap limit for the fuel — if exceeded you will lose your fuel bonus. |
| Starting Weather Conditions | `starting_weather_condition` | N/A | The weather condition at the start of the race. |

#### Track

| Property Name | JSON Property Name | Unit of Measurement | Explanation |
|---|---|---|---|
| Track Name | `name` | N/A | The name of the track. |
| Track Segments | `segments` | N/A | A list of all segments that make up the track. |
| Segment ID | `id` | N/A | The id of the track segment as they appear in order during the race. |
| Segment Type | `type` | N/A | The type of track segment. |
| Segment Length | `length_m` | Meters | The length of the track segment in m. |
| Corner Radius | `radius_m` | Meters | The radius of the corner. Used to calculate the maximum speed when taking the corner. |

#### Tyres

| Property Name | JSON Property Name | Unit of Measurement | Explanation |
|---|---|---|---|
| Available Tyre Sets | `available_sets` | N/A | List of available tyre sets. |
| Tyre IDs | `ids` | N/A | List of tyre IDs available per compound set. |
| Tyre Compound | `compound` | N/A | The type of tyre compound for the set. |
| Tyre Life Span | `life_span` | N/A | The amount of friction that the tyre set starts with. |
| Dry Friction Multiplier | `dry_friction_multiplier` | Multiplier | Multiplier used for friction when in dry weather conditions. |
| Cold Friction Multiplier | `cold_friction_multiplier` | Multiplier | Multiplier used for friction when in cold weather conditions. |
| Light Rain Friction Multiplier | `light_rain_friction_multiplier` | Multiplier | Multiplier used for friction when in light rain weather conditions. |
| Heavy Rain Friction Multiplier | `heavy_rain_friction_multiplier` | Multiplier | Multiplier used for friction when in heavy rain weather conditions. |
| Dry Degradation | `dry_degradation` | N/A | Rate at which tyres degrade in dry weather conditions. |
| Cold Degradation | `cold_degradation` | N/A | Rate at which tyres degrade in cold weather conditions. |
| Light Rain Degradation | `light_rain_degradation` | N/A | Rate at which tyres degrade in light rain weather conditions. |
| Heavy Rain Degradation | `heavy_rain_degradation` | N/A | Rate at which tyres degrade in heavy rain weather conditions. |

#### Weather

| Property Name | JSON Property Name | Unit of Measurement | Explanation |
|---|---|---|---|
| Weather Condition | `condition` | N/A | Type of weather condition. |
| Weather ID | `id` | N/A | The unique identifier for the weather condition. |
| Duration of Weather Conditions | `duration_s` | Seconds | The duration that the weather conditions will last for. |
| Acceleration Multiplier | `acceleration_multiplier` | N/A | The value by which the acceleration constant is affected due to weather. |
| Deceleration Multiplier | `deceleration_multiplier` | N/A | The value by which the deceleration constant is affected due to weather. |

---

### JSON File Example

A race is represented using a JSON file. An example of this file for Level 4 is shown below:

```json
{
  "car": {
    "max_speed_m/s": 90,
    "accel_m/se2": 10,
    "brake_m/se2": 20,
    "limp_constant_m/s": 20,
    "crawl_constant_m/s": 10,
    "fuel_tank_capacity_l": 150.0,
    "initial_fuel_l": 150.0,
    "fuel_consumption_l/m": 0.0005
  },
  "race": {
    "name": "Entelect GP Level 0",
    "laps": 2,
    "base_pit_stop_time_s": 20.0,
    "pit_tyre_swap_time_s": 10.0,
    "pit_refuel_rate_l/s": 5.0,
    "corner_crash_penalty_s": 10.0,
    "pit_exit_speed_m/s": 20.0,
    "fuel_soft_cap_limit_l": 1400.0,
    "starting_weather_condition_id": 1
  },
  "track": {
    "name": "Neo Kyalami Example",
    "segments": [
      {"id": 1, "type": "straight", "length_m": 850},
      {"id": 2, "type": "corner", "radius_m": 60, "length_m": 120},
      {"id": 3, "type": "straight", "length_m": 850},
      {"id": 4, "type": "corner", "radius_m": 60, "length_m": 120},
      {"id": 5, "type": "corner", "radius_m": 45, "length_m": 90},
      {"id": 6, "type": "corner", "radius_m": 80, "length_m": 140},
      {"id": 7, "type": "straight", "length_m": 650},
      {"id": 8, "type": "corner", "radius_m": 80, "length_m": 140}
    ]
  },
  "tyres": {
    "properties": {
      "Soft": {
        "life_span": 1,
        "dry_friction_multiplier": 1.18,
        "cold_friction_multiplier": 1.00,
        "light_rain_friction_multiplier": 0.92,
        "heavy_rain_friction_multiplier": 0.80,
        "dry_degradation": 0.14,
        "cold_degradation": 0.11,
        "light_rain_degradation": 0.12,
        "heavy_rain_degradation": 0.13
      },
      "Medium": {
        "life_span": 1,
        "dry_friction_multiplier": 1.08,
        "cold_friction_multiplier": 0.97,
        "light_rain_friction_multiplier": 0.88,
        "heavy_rain_friction_multiplier": 0.74,
        "dry_degradation": 0.10,
        "cold_degradation": 0.08,
        "light_rain_degradation": 0.09,
        "heavy_rain_degradation": 0.10
      },
      "Hard": {
        "life_span": 1,
        "dry_friction_multiplier": 0.98,
        "cold_friction_multiplier": 0.92,
        "light_rain_friction_multiplier": 0.82,
        "heavy_rain_friction_multiplier": 0.68,
        "dry_degradation": 0.07,
        "cold_degradation": 0.06,
        "light_rain_degradation": 0.07,
        "heavy_rain_degradation": 0.08
      },
      "Intermediate": {
        "life_span": 1,
        "dry_friction_multiplier": 0.90,
        "cold_friction_multiplier": 0.96,
        "light_rain_friction_multiplier": 1.08,
        "heavy_rain_friction_multiplier": 1.02,
        "dry_degradation": 0.11,
        "cold_degradation": 0.09,
        "light_rain_degradation": 0.08,
        "heavy_rain_degradation": 0.09
      },
      "Wet": {
        "life_span": 1,
        "dry_friction_multiplier": 0.72,
        "cold_friction_multiplier": 0.88,
        "light_rain_friction_multiplier": 1.02,
        "heavy_rain_friction_multiplier": 1.20,
        "dry_degradation": 0.16,
        "cold_degradation": 0.12,
        "light_rain_degradation": 0.09,
        "heavy_rain_degradation": 0.05
      }
    }
  },
  "available_sets": [
    {"ids": [1, 2, 3], "compound": "Soft"},
    {"ids": [4, 5, 6], "compound": "Medium"},
    {"ids": [7, 8, 9], "compound": "Hard"},
    {"ids": [10, 11, 12], "compound": "Intermediate"},
    {"ids": [13, 14, 15], "compound": "Wet"}
  ],
  "weather": {
    "conditions": [
      {
        "id": 1,
        "condition": "cold",
        "duration_s": 1000.0,
        "acceleration_multiplier": 0.95,
        "deceleration_multiplier": 0.95
      },
      {
        "id": 2,
        "condition": "light_rain",
        "duration_s": 3000.0,
        "acceleration_multiplier": 0.80,
        "deceleration_multiplier": 0.80
      }
    ]
  }
}
```
*Race Representation JSON*

---

### Terms

| Term | Explanation |
|---|---|
| Straight | A section of the track that is straight with no curves. |
| Pit Lane | The section of the racetrack where cars enter to switch tyres or refuel. |
| Corner | Section of the track that curves, where cars need to travel below a certain speed to safely take the turn. |
| Braking Point | The part of the straight at which you start braking to slow down. |

### Calculations & Algorithms

> N.B. All values are in SI units

**Speed required to cover a certain distance in a certain time:**

$$
speed = \frac{length\_m}{time}
$$

**Distance if final speed is known instead of time:**

$$
length = \frac{final\ speed^2 - initial\ speed^2}{2 \times accel\_mps^2}
$$

**Distance if time is known instead of final speed:**

$$
length = initial\ speed \times time + 0.5 \times accel\_mps^2 \times time^2
$$

### General Conversions

$$
m/s^2 \times 3.6 = km/h
$$