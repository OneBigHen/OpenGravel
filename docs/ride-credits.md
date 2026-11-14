# Ride credits

Every ride in the built-in library (`data/catalog/routes.json.gz`) credits the person and place it came from. The app shows "Route by <author> · <source>" wherever a rider sees one of these rides, and writes the same credit into GPX exports (`<author>`, `<link>`, `<desc>`).

**112 rides: 95 with an author name, 17 with an unknown author.**

## Where the credit comes from

- **PA Adventure Bike Rides (95 rides).** A Facebook group. The author is the group member who posted the GPX; each ride links to that post. Names were recovered from the pre-release library snapshot (`sharedBy` on each ride story), which the 2026-09 public release had removed from the shipped data. We call the poster the author because the posts present the track as theirs; a post that re-shared someone else's track would credit the poster, not the original maker. Nobody was guessed: all 95 names come straight from the saved posts.
- **Roost GPX locker (17 rides).** roostlocker.com publishes these GPX files without naming who made them, and the files carry no author (only the app that exported them, such as Garmin, Gaia GPS or Kurviger). Their author is recorded as **unknown** and the credit reads "Route from Roost GPX locker · author not named", linked to the Roost download page for that file. One file (`ShinhoppleKOM.gpx`) says it was edited at advcatskills.org; that is a tool, not an author name.

Rides that came from more than one post or file in the same card group each carry their own credit.

## Table

| Ride | Author | Source | Source link | How we know |
|---|---|---|---|---|
| Loyalsock State Forest Loop | Brady Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/2158947971500947/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Hawley Loop | Robert Fio Rito | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/2141951729867238/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Blackwater Down & Back | Dave Sayers | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/2138376100224801/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Kitchen Sink Loop (South Jersey) | Alan Harris | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/2120720511990360/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Horses and Watercourses West of West Chester | Daniel Behrendt | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/2071181893610889/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Magnolia 326: Street Miles to BMT Lodge Lunch | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/2067243354004743/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Birchrunville Run | Daniel Behrendt | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/2065780504151028/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Scouts Loop | Cody Ryans | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/2017099609019118/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Bald Eagle State Forest Loop | Eric M Warner | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1889758598419887/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Coffee in Bloomsburg II | Gia M Magaro | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1862494471146300/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Northampton County ADV Dirt | John Anderson | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1852376192158128/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Bucks County ADV Dirt Roads Water | John Anderson | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1852375638824850/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Wayne County Rock Crusher v2 | Asah Eliades | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1848743232521424/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Epic Loop | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1848692872526460/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Erie, Covered Bridges & Pymatuning | Dave Stillwagon | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1836805730381841/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Quickie Creek Crossings 2025 | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1831625277566553/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Grand Tour | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1824343308294750/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Green Lane and Back Easier Ride | Christopher L Eugster | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1801432153919199/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Armstrong County Loops | Jason Fleming | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1787966551932426/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Armstrong County Loops | Jason Fleming | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1787966551932426/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Armstrong County Loops | Jason Fleming | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1787966551932426/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Leaser Lake Street Route | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1767611250634623/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Lock Haven Street Loop | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1755252718537143/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Spring ADV 2025 | Dave Stillwagon | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1752626085466473/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Street Ride to Hermys Spring Open House | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1724231861639229/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Leprechaun Loop | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1721844645211284/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Crystal Cave Street Loop | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1709064873155928/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Game Land Roads Limited Opening (figure 8, clockwise) | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1628511434544606/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Fall Foliage Tour 2024 | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1624084954987254/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Wawa to Hermy's | Christopher L Eugster | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1623350495060700/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Apple Pie Run to Delaware State Forest | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1612810122781404/) | Poster of the GPX in the group post (pre-release library snapshot) |
| NightRide 2.0 | Christopher L Eugster | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1578569769538773/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Berks Discover Night Route | Christopher L Eugster | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1562501247812292/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Fun Ride | Erika Reinheimer | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1561407534588330/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Three Sisters from Four Monkeys | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1558314201564330/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Old Buck Loop | Jonah David Harrison Stahl | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1545346022861148/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Bald Eagle Dual Sport Loop | Rob DesRuisseaux | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1537359863659764/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Cricks Loop | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1520483642014053/) | Poster of the GPX in the group post (pre-release library snapshot) |
| River Road Blue Mt | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1520477435348007/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Green Buch Bonus Loop | Sean Glow | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1505388783523539/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Pre-Event Ride (Wayne County) | Seth Cooper | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1504426283619789/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Devil Head Loop | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1501055297290221/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Trans New Jersey Trail 2018 | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1500516410677443/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Hypsie Gap Loop | Erika Reinheimer | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1496562687739482/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Bake Oven Knob Loop 2024 | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1492117118184039/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Uniondale Loop II | Carl Nuss | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1480274036035014/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Uniondale Loop | Carl Nuss | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1480273449368406/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Rally in Bally Valley | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1479589196103498/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Lansdale Street Ride | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1465649487497469/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Orchard Loop | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1465181464210938/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Groundhog Ride | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1460839044645180/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Shamokin 200 Twisty Street Ride | Joel NieRiv | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1410270709702014/) | Poster of the GPX in the group post (pre-release library snapshot) |
| North 200 | Joel NieRiv | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1409223756473376/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Tower of Terror Part 2 | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1394852361243849/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Tower of Terror Part 1 | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1394851517910600/) | Poster of the GPX in the group post (pre-release library snapshot) |
| York Gravel Loop | Rob DesRuisseaux | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1368549200540832/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Michaux ADV Loop | Rob DesRuisseaux | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1368543470541405/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Michaux ADV Loop | Rob DesRuisseaux | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1368543470541405/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Twist and Grit 155 | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1347375925991493/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Green Lane Huffs Church Loop | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1306761636719589/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Bechtelsville Spinnerstown Loop | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1286304718765281/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Limerick Loop | James Farrell | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1282574842471602/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Phoenixville, Marsh Creek & French Creek Loop | James Farrell | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1282573035805116/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Sunday Valley Forge & BBQ Ride | Scott White | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1282211732507913/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Green Lane and Back via Oley | Kimi Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1251159915613095/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Phoenixville Gravel Quickie | James Farrell | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1249839859078434/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Hawley Extended | Dan Hawley | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1218351325560621/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Dauphin County Discovery Loop | Jonah David Harrison Stahl | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1180510012678086/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Tri-County Tour | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1162372421158512/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Green Lane to Delaware River Loop (clockwise only) | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1152720752123679/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Zoo Loop | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1152625075466580/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Punxsutawney to Hyner View State Park | Craig Glass | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1130763824319372/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Berks–Bucks Creek Crossings | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1120406178688470/) | Poster of the GPX in the group post (pre-release library snapshot) |
| New Zoo Review (Lehigh Valley Zoo add-on) | Matt Arey | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1118014582260963/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Ludwigs Corner Loop | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1112560136139741/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Out and Back Loop | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1096019984460423/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Spring Green Ridge | Matt Arey | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1086369838758771/) | Poster of the GPX in the group post (pre-release library snapshot) |
| The Quick and the Dead | John Logan | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1086159012113187/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Fairhope Wellersburg Glencoe Hyndman | John Logan | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1082193315843090/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Green Lane–Bechtelsville Loop | Scott Lepping | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1079665089429246/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Tuscarora State Park | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1054915691904186/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Berks County Discovery Route v2 | Christopher L Eugster | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1050482635680825/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Ride to Van Sant Airport | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1046295179432904/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Polar Bear Ride 2022 | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1033838564011899/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Downingtown Jaunt | Eli Neuman | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/1002316317164124/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Tower Road Hard Exploration Ride | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/963831917679231/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Mid PA BDR Section (revised) | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/950718602323896/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Berks County Discovery Route Sticker Run | Christopher L Eugster | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/899471107448646/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Revenge of Mountain Mary | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/890805328315224/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Beginner Rock-N-Gravel | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/873179046744519/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Buckhorn Loop | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/855656191830138/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Three Mountain Adventure Ride | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/848781445850946/) | Poster of the GPX in the group post (pre-release library snapshot) |
| GPS 40 Ride | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/757196651676093/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Lunch Run to Hermy's | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/757166731679085/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Hermy's to the Gas Stop | Bobby Brown | PA Adventure Bike Rides | [post](https://www.facebook.com/groups/214850105910753/permalink/757166151679143/) | Poster of the GPX in the group post (pre-release library snapshot) |
| Allegheny National Forest | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/allegheny-all/) | Roost lists no author; the GPX file has none |
| Allegheny National Forest | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/allegheny-all/) | Roost lists no author; the GPX file has none |
| Canton Endless Mountains Ride | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/canton-endless-mountains/) | Roost lists no author; the GPX file has none |
| South Jersey Pine Barrens | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/nj-pine-barrens/) | Roost lists no author; the GPX file has none |
| South Jersey Pine Barrens | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/nj-pine-barrens/) | Roost lists no author; the GPX file has none |
| South Jersey Pine Barrens | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/nj-pine-barrens/) | Roost lists no author; the GPX file has none |
| Explore Conowingo Reservoir | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/conowingo-reservoir/) | Roost lists no author; the GPX file has none |
| Ferryland Run | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/ferryland-run/) | Roost lists no author; the GPX file has none |
| Grand Canyon of PA Loop | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/grand-canyon-of-pa/) | Roost lists no author; the GPX file has none |
| John Bond ArTrail | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/john-bond-artrail/) | Roost lists no author; the GPX file has none |
| Laurel Highlands 200 | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/laurel-highlands-200/) | Roost lists no author; the GPX file has none |
| Oil Creek Loop | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/oil-creek-loop/) | Roost lists no author; the GPX file has none |
| Rainbow Loop (Sandy Lake) | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/rainbow-loop-sandy-lake/) | Roost lists no author; the GPX file has none |
| Allegheny National Forest | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/allegheny-all/) | Roost lists no author; the GPX file has none |
| Shinhopple KOM | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/shinhopple-kom/) | Roost lists no author; the GPX file has none |
| TPAT Vertical | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/tpat-vertical/) | Roost lists no author; the GPX file has none |
| Pittsburgh 380 Mile Loop | unknown — source: Roost GPX locker | Roost GPX locker | [download page](https://roostlocker.com/lana-download/pittsburgh-pa-380-mile-loop/) | Roost lists no author; the GPX file has none |

## Keeping it true

- A test (`tests/unit/application/ride-credits.test.tsx`) fails if any catalog ride lacks a credit, a source name or a source link.
- `src/application/explore/catalog-build.ts` writes the credit when the catalog is rebuilt; pass `author` (or a story with `sharedBy`) and `sourceUrl`.
- If an author asks to be credited differently or removed, change their entry in the data and this table, or take the ride out.
