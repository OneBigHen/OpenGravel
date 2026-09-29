# Offline map builder

These scripts build a regional vector map archive from OpenStreetMap data. They are optional: the web app uses hosted OpenFreeMap tiles by default.

The current example targets Pennsylvania and New Jersey. Set its bounds and input sources in `regions/pa-nj.env`, then run:

```sh
bash infra/maps/scripts/fetch-osm.sh
bash infra/maps/scripts/build-vector.sh
python3 infra/maps/scripts/write-manifest.py
```

The downloaded source files and generated archives live under `infra/maps/data/` and are ignored by Git. Do not commit regional extracts or rider route files. Follow OpenStreetMap's attribution and ODbL requirements when redistributing derived data.
