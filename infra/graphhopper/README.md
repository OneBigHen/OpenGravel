# Separate Pennsylvania hike router (GraphHopper 11)

This is an experimental graph and server. It is independent of the rider router and is not connected to the app. It imports the full Geofabrik Pennsylvania extract, not the filtered motorcycle extract. It requires the same GraphHopper 11 web jar used on powerplex, Java 17 and adequate disk and RAM. Verify ports 8995 and 8996 are free first. Never point this config at the rider graph cache.

From the repository root on powerplex (after downloading the full PBF to the indicated location):

```sh
mkdir -p /mnt/wsl/ogv-data/ghbuild-hike/custom-models
python3 -m venv /mnt/wsl/ogv-data/ghbuild-hike/venv
/mnt/wsl/ogv-data/ghbuild-hike/venv/bin/pip install osmium==4.3.2
/mnt/wsl/ogv-data/ghbuild-hike/venv/bin/python infra/graphhopper/test_hike_access.py
/mnt/wsl/ogv-data/ghbuild-hike/venv/bin/python infra/graphhopper/hike-access.py \
  /mnt/wsl/ogv-data/trails/pennsylvania-latest.osm.pbf \
  /mnt/wsl/ogv-data/ghbuild-hike/pennsylvania-hike-strict.osm.pbf
cp infra/graphhopper/hike.yml /mnt/wsl/ogv-data/ghbuild-hike/config.yml
cp infra/graphhopper/custom-models/ogv-hike.json /mnt/wsl/ogv-data/ghbuild-hike/custom-models/
ln -s /home/zachary/ghbuild/graphhopper-web-11.0.jar /mnt/wsl/ogv-data/ghbuild-hike/graphhopper-web-11.0.jar
cd /mnt/wsl/ogv-data/ghbuild-hike
java -Xmx16g -jar graphhopper-web-11.0.jar server config.yml
```

The first start imports and prepares landmarks in `ghbuild-hike/graph-cache-strict`; subsequent starts load that cache. The application listens only on localhost:8995 and the admin listener on localhost:8996. Test with `curl 'http://127.0.0.1:8995/route?profile=hike&point=40.62,-75.99&point=40.63,-75.98'`. Rebuilding with another extract requires a new empty graph directory; do not delete or reuse the rider graph.

The model uses GraphHopper's foot access, speed, priority and hiking-network encoding; it favors mapped hiking networks and paths, footways and tracks relative to ordinary roads, penalizes busy roads, disallows foot access marked no or private, and rejects `sac_scale` demanding mountain hiking or higher (`hike_rating >= 3`). Unknown `sac_scale` is not a difficulty rating. The preprocessing sets `foot=no` on every object carrying `access=no`, including objects with a foot-specific override. This is intentionally stricter than normal OSM access precedence and leaves the original PBF unchanged. GraphHopper applies way and barrier-node restrictions; this pre-pass does not propagate a relation-level access tag to its members. Other restrictions use GraphHopper's foot interpretation. OSM data and restrictions can be incomplete. This fixed profile does not yet expose a user-selectable SAC limit. No elevation graph is enabled.
