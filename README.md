# Decibels

An immersive audiovisual web experience exploring how the Hubbard Brook Experimental Forest responds to storms. Built for the [Forest Data Jam](https://hubbardbrook.org/) program.

## What it does

Decibels visualises a full year of hourly hydrological data (March 2024 - March 2025) from the Hubbard Brook Experimental Forest. A WebGL shader renders a generative map of the watershed, while a sonification audio track plays alongside. Users can scrub through the year on a timeline bar, jump to storm events, and hear how precipitation, streamflow, and other variables evolve over time.

## Running locally

Serve the project directory with any static file server:

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

No build step or `npm install` required.

## Audio

Place your sonification audio file at `audio/sonification.mp3`. The app will run without it, but playback won't produce sound until the file is provided.

## Configuration

All text, credits, and tuneable constants live in `vars.json`. Key settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `playback.hoursPerSecond` | 2 | How many data-hours pass per real second |
| `playback.stormThreshold` | 5 | Precipitation (mm/hr) to flag as a storm event |
| `playback.audioPath` | `audio/sonification.mp3` | Path to sonification audio |

## Accessibility

Designed with the blind/low-vision community in mind:

- Full keyboard navigation (arrow keys to scrub, space to play/stop)
- ARIA slider on the timeline with live date announcements
- Screen reader storm event announcements
- Skip link, focus management, and `prefers-reduced-motion` support

## Team

- Duncan Geere
- Simon Ryden
- Ben Dexter Cooley
- Max Graze
- Micah Lewis
