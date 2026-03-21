# Decibels - Hubbard Forest Data Jam

## Project Overview

An immersive multisensory generative audiovisual web experience linking Hubbard Brook Experimental Forest datasets with geospatial data. The project focuses on **precipitation and streamflow**, blending generative art visualization with sonification techniques.

**Core narrative:** How the forest responds to storms.

## Key Features

### Visual
- Elevation map of the forest using **flow field techniques** driven by slope angle to visualize the watershed
- Hourly data depicting a year of the forest (March 2024 – March 2025)
- Flow lines that swell with rainfall; streamflow data shows water transit time through the system
- **Timeline** at the bottom with blue precipitation intensity bars and yellow clickable storm event markers

### Audio
- Data sonification turning storm events into generative music
- Parameters mapped: precipitation, streamflow, evapotranspiration, soil moisture
- Air temperature used to differentiate rainfall vs snowfall events
- Audio file synced to timeline playback via Web Audio API

### Storytelling
- Embedded voices of people living/working near the forest
- Stories about experiencing storms in the area, interspersed in the timeline
- Team member located in Burlington, VT for potential in-person interviews

## Goals
- Engage multiple communities: nature lovers, local residents, researchers, and the **blind/low vision (BLV) community**
- Make data accessible and multisensory
- Strengthen data communication skills across the team
- Create something useful for researchers and local communities

## Target Audiences
- Nature enthusiasts
- Local community members
- Researchers
- BLV community (accessibility through sonification)
- Data science students

## Data
- Datasets provided by the Forest Data Jam program (hourly resolution, 8760 rows)
- Key variables: precipitation, streamflow, evapotranspiration, soil moisture, air temperature, plus wind, pressure, humidity, solar radiation
- Three versions: unnormalized (raw units + dates), normalized (0-1), MIDI
- Additional geospatial data to be sourced externally (elevation/DEM)

## Tech Stack
- Vanilla JS + WebGL (no framework, no build system)
- Web Audio API for MP3 playback
- Papa Parse (CDN) for CSV loading
- Space Grotesk font (Google Fonts)

## Architecture

### Files
- `index.html` — semantic HTML with splash screen, shader canvas, timeline, controls
- `app.js` — main orchestrator: data loading, playback engine, audio sync, info dialog
- `shader.js` — WebGL boilerplate: shader compilation, fullscreen quad, uniform management
- `timeline.js` — timeline bar rendering (canvas) and interaction (mouse/touch/keyboard)
- `style.css` — dark theme, responsive layout, accessibility styles
- `draw.frag` — placeholder fragment shader (swap with final shader later)
- `rect.vert` — passthrough vertex shader
- `vars.json` — all text content, credits, and configuration constants

### Configuration
All tuneable values are in `vars.json`:
- `playback.hoursPerSecond` — playback speed (default: 2)
- `playback.stormThreshold` — mm/hr to flag storm events (default: 5)
- `playback.audioPath` — path to sonification audio file
- `splash.*` — splash screen text
- `info.*` — info dialog text and credits list
- `data.*` — CSV file paths

### Shader Uniforms
The fragment shader receives these uniforms each frame:
- `u_res`, `u_time`, `u_progress`
- `u_precipitation`, `u_streamflow`, `u_evapotranspiration`
- `u_soil_moisture`, `u_snow`, `u_temperature`

### Accessibility
- Skip link, ARIA slider on timeline, keyboard navigation (arrows, shift+arrows, home/end)
- `aria-live` regions for date changes and storm announcements
- Focus management on splash dismissal
- `prefers-reduced-motion` respected
- All controls meet minimum touch target sizes

## Running Locally
```
python3 -m http.server 8080
```
Then open http://localhost:8080

## Team
- Duncan Geere
- Simon Rydén
- Ben Dexter Cooley
- Max Graze
- Micah Lewis
