# Cardio: runs and rides

**Stats → Cardio** (or Plan → ⋯ → Cardio) is a log for runs and bike rides. You plan a session for a
day, do it with your watch or Strava, and import the file afterwards. openGym then shows the route,
a pace for every kilometre, the laps your watch recorded, your best efforts and a few plain
observations about the session.

It is the **Cardio** module (Settings → Modules). Switched off, the screens and links go away; your
sessions are kept, backed up and synced as always ([Modules](MODULES.md)).

## Getting a file out of Strava or Garmin

openGym reads **FIT**, **GPX** and **TCX** files, each also gzipped (`.fit.gz`, which is what
Strava's archive contains). The format is read from the content, never the file name.

| From | How |
|---|---|
| Strava, one activity | On the website, open the activity, **⋯ → Export Original** (the FIT or GPX you uploaded) or **Export GPX** |
| Strava, everything | Settings → My Account → Download or Delete Your Account → Request Your Archive. The `activities` folder in the zip has one file per activity; unpack the zip and pick the files |
| Garmin Connect, one activity | On the website, open the activity, ⚙ → **Export Original** (a zip with one `.fit`: unpack it) or **Export to GPX** / **Export to TCX** |
| A watch or bike computer | Plug it in and copy the `.fit` files from its `Activity` folder |

A zip itself is refused with a message (openGym reads no zip but its own backups): unpack it first.

## Planning and importing

1. **Plan** a session: run or ride, the day, and optionally a distance, a time, a title and a note.
2. Do it.
3. Either **Import from Strava or Garmin** at the top and pick one or several files, or press
   **Import** on the planned session itself.

A file finds its own planned session when it is the same sport (a file with no sport matches either)
and planned for the same day, or one day either side; the closest day wins, then the closest planned
distance. Pressing Import on a session fills that one, whatever day the file is from. A file with no
planned session becomes a new activity. The plan is kept on the finished session, and the insights
say how the day compared with it.

The same file is never imported twice (same start time and sport). Picking ten files at once works;
the message tells how many were added, were already there or could not be read.

## What you get

- **Totals**: distance, moving time (stops are left out), average pace or speed, climb, heart rate,
  cadence. A run shows min/km, a ride shows km/h.
- **Kilometres**: the pace (or speed), climb and heart rate of every kilometre, the fastest and the
  slowest marked. A last stretch under 100 m is left out.
- **Laps from your watch**, when the file has them.
- **Route**: drawn from the file's own coordinates and coloured by speed, with the start's
  coordinates and a link that opens OpenStreetMap. No map tiles are loaded, so nothing leaves the
  device while you look at a route.
- **Pace and climb**: pace along the distance over the elevation profile.
- **Best efforts** over 1, 5, 10 km, a half and a full marathon, found anywhere inside the
  activity, not only at the start.
- **Insights**, only when the file backs them up: a new personal best, a negative split or a fade,
  even pacing, fastest and slowest kilometre, heart rate drifting up at a steady pace, a hilly
  route, the session against its plan, the longest so far, the week against your usual week.
- **This week** and the last eight weeks on the list.

## What it does not do

- **No live sync with Strava or Garmin.** Both would need an application registered with them and a
  link to your account; openGym has no third-party account on purpose. Import a file instead.
- **No place names.** Looking up "which street is that" means sending coordinates to a service, so
  the screen shows the coordinates and the route shape.
- **Metric only.** Kilometres, whatever the weight unit says.
- **Run and ride only.** Swims, walks and the rest are not read as either (a file with no sport is
  taken for a ride above 16 km/h on average, otherwise a run).

## How it is stored

`S.cardio` is a map from an id to a session, and syncs one session at a time like programmes
([sync](ARCHITECTURE.md)): a ride planned on the laptop and a run imported on the phone both
survive. Only a summary is kept of each file: totals, the kilometre splits, the laps, the best
efforts and about 150 points for the route and the chart (about 4 KB), not every trackpoint, so
hundreds of sessions fit comfortably in the profile document (5 MB limit). The original file is not
kept; keep it where you got it if you want it.

Running cadence is shown in steps a minute. Watches store it per leg, so a value under 120 on a run
is doubled.

## For developers

All of it is pure code in `frontend/src/lib/`, each file with a test beside it:

| File | Does |
|---|---|
| `cardio-parse.js` | GPX and TCX reading, gzip, and `parseActivity` (format sniffing) |
| `cardio-fit.js` | The FIT reader (record, lap, session; compressed timestamps; developer fields skipped) |
| `cardio-analyze.js` | Distance, moving time, kilometre splits, laps, best efforts, climb, the stored profile |
| `cardio-insights.js` | `insightsOf(session, state)`: the observations, as ids and numbers |
| `cardio.js` | Planning, matching an import to a plan, duplicates, formatting, week totals |
| `cardio-import.js` | A batch of picked files to sessions, one result per file |
| `cardio-fixtures.js` | Test helper: synthetic activities with an exactly known pace |

`views/Cardio.jsx` holds the screens. A new insight is an id in `cardio-insights.js` and its sentence in
`insightText`. `cardio` is in `PER_KEY` of both `lib/sync-merge.js` and `api/sync-stamps.js`.
