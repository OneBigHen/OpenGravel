# The frozen new road map (round 2b)

Frozen 2026-11-13. No profile number changes without a new decision. Built on the Windows PC
(WSL) at `/mnt/wsl/ogv-data/ghbuild-moto-v2/graph-v2-r2`, from commit `0a18f5d7` of the old
`routing/rm2` branch. The profile files in this folder were compared with the files that map was
built from (sha256, byte for byte): all seven profile files and `config-v2.yml` are identical, so
nothing had to be committed from the PC.

| Thing | sha256 |
|---|---|
| Map input `pa-nj-motorcycle.osm.pbf` (496,414,180 bytes, same file as production) | `bcf75b9308da24ab6942afc9fdbfa1abbd4e464f7cf20e426e594b1910dbc76a` |
| GraphHopper jar `graphhopper-web-11.0.jar` (47,346,509 bytes) | `b59c024afe172ec6ec85b6327006c3138ec58c7d0bcd26253d0e42853f613def` |
| Extension `og-ext/og-ext.jar` (30,739 bytes) | `fb1d6b8324bc0a26b71f84331eb4bd0b654f8cf36e4712775dc6d27cbed10339` |
| `config-v2.yml` | `6b19658345fa3b889d93065737e30f4fa2b81d2aa192cc7c89ae8938446ea286` |
| `custom-models/motorcycle-fastest.json` | `dc0e507b1469a8c68736d55de8f8e9d10abfbc89a8f83aac730d6e261fc87d2c` |
| `custom-models/motorcycle-twisty.json` | `7a629de1088ce8b3f4d6a53f85ad988f91666dcc4a3c1ca33a74c41bdc7a0769` |
| `custom-models/motorcycle-scenic.json` | `fca5c27664fa02ecdcb8a8468c349185f32cf2357640092cdc13001ceeb26d1d` |
| `custom-models/motorcycle-adventure.json` | `45637ee2c081d3ffbaefaace2c823c476c449ffd1d1e07127b1f5a083e20a674` |
| `custom-models/og-clock.json` | `b66343e821cd553defd2f7f9ec3041dd42000a522af0db6978363db4c7c530d2` |
| `custom-models/motorcycle-base.json` | `14438caaacd94f7431d4e86db77fe6f8cdd8d76483c4d104d25204b4c58dbbea` |
| `custom-models/prefer-curvature.json` | `b1611dd890d2a9e737892cd568b0e49f58e278f0e5e9606d8335986582ed07ff` |

(`motorcycle-base.json` and `prefer-curvature.json` are kept for reference; the twisty and scenic
profiles no longer load them.)

**Graph import date** (from the router's `/info`): `2026-11-12T16:19:17Z`. Production's is
`2026-10-04T12:12:19Z`, which is how you tell the two apart in one call:
`curl -s localhost:8989/info | grep -o '"import_date":"[^"]*"'`.

**Graph folder `graph-cache-v2`** (1,350,620,321 bytes, `turn_costs` 1,048,676 bytes): each file's
sha256, as written by the build and re-checked on 2026-11-13 (17 of 17 match).

```
eaad3426ca28e8a04bbcc3e39348b69a78990ab4fedd50ac363f2ff20c1fa4d8  edgekv_keys
35600e25b810710a4f119ddfa53e0c8b0b62836e9484e29eb16951f5ff62a712  edgekv_vals
e86cb50eeaf0f51b6ea9f4710803858ba1cdee15b5a7ff26a22b929b65bb445e  edges
0a4eb8c63bc5647a805756812a15dee3391195ed03bb97788e5ec168d183da4f  geometry
1a5c3aac93cc72704a6d0bd66f3224985526722020dd36772511adf790e4f5b0  landmarks_motorcycle_adventure
8967b51cc9adccf2ae91f526f13e2c80f867587558816f8b0e5d55068b603aee  landmarks_motorcycle_fastest
0e224c995417fdee446b2a0355ca6c71cbad76177b3fb4a816eae376f156432e  landmarks_motorcycle_scenic
8c5fdeeaf7687c73cf8ff5e71711db368cd079436306e11cb34c113cb7e14acd  landmarks_motorcycle_twisty
89e0919d4f22aaac01b4f84f1b83e3fa09a1ea4127e39b4bfde4b6cfd46b18fc  landmarks_subnetwork_motorcycle_adventure
89e0919d4f22aaac01b4f84f1b83e3fa09a1ea4127e39b4bfde4b6cfd46b18fc  landmarks_subnetwork_motorcycle_fastest
93e260c123be78e440fc94ca9635d57d873f92518b946048cc7ab1c5d0e117e8  landmarks_subnetwork_motorcycle_scenic
93e260c123be78e440fc94ca9635d57d873f92518b946048cc7ab1c5d0e117e8  landmarks_subnetwork_motorcycle_twisty
6a97f90d023b6784196cd7ebbb6edb33ea2dea42d96e42bf0aeeff5b42e178cc  location_index
d51f4e6df4a3d532a33caba432fb809f93033a6753d020ac95c6b3f385252898  nodes
4260f29ed42b97877bc7cc2e806e7a432b8d57a0fdf3db0284a2f944b1a7478f  properties
d10c05ba5f07c235d59f5cf0dce8a3010fd9e6b83a10c88c5c54e60e26e8b74e  properties.txt
976379acc65fe7ad81bac82b9e2b491b33b0852a91ce5aac17f9ec0cc0b9db2d  turn_costs
```

Check on a copy: `cd graph-cache-v2 && sha256sum -c SHA256SUMS` (save the block above as
`SHA256SUMS`). The router does not need the map file to start, only the graph, jars, config and
`custom-models/`. Numbers and the ship steps: `docs/router-v2-ship.md`.
