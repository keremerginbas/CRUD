# Parsel drone videosu

Pulls the parcel boundary from the TKGM parcel query, draws it on Esri World Imagery, and renders a vertical (1080x1920) MP4 with the camera orbiting the parcel at an oblique angle, drone-style.

- If a tile returns "Map data not yet available" (or 404), it automatically drops one zoom level.
- The tilt angle and field of view are limited so the horizon never shows; the frame is filled with real imagery everywhere.

```bash
python3 tools/parsel-video/parsel_video.py \
  --il Ankara --ilce Etimesgut --mahalle Erler --ada 49079 --parsel 1 \
  --out erler_49079_1.mp4
```

Requirements: Python 3, numpy, Pillow, ffmpeg. Network access: `cbsapi.tkgm.gov.tr`, `server.arcgisonline.com`.
If you already have the boundary, you can pass it with `--geojson parsel.json`.
