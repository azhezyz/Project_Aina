[简体中文](README.md) · **English**

![Project Aina walking atlas. A rust-colored line runs from Yasaka Shrine through Ninenzaka to Kiyomizu-dera in Kyoto.](docs/images/higashiyama-atlas.png)

You're walking from Yasaka Shrine to Kiyomizu-dera. There's a coffee shop near Ninenzaka you'd like to try. Pull up its photos beside the shrine's opening hours, trace the detour on the map, and decide whether to add a stop.

**Project Aina** is a walking atlas for travelers who like to plan their own routes. Your walk stays drawn along the streets while you explore. On a desktop, every place opens in a window you can move. On a phone, swipe up the bottom panel to plan the same walk.

## Take a walk through Kyoto

1. Select **Yasaka Shrine** on the map and choose **Start a route here**. A numbered marker appears immediately, and the new walk takes its name from the first stop.
2. Open **Ninenzaka**. On a desktop, the shrine's window stays open so you can compare the two places. Choose **Add to route** to draw the walk between them.
3. Choose **Finish route**, then explore nearby cafés. Click the line on the map or open **My routes** to reorder the stops, make a copy or pick up where you left off.

![The English Kyoto atlas with Yasaka Shrine and Kodai-ji open side by side. Two numbered walking routes remain on the map.](docs/images/kyoto-workspace-en.png)

Two walks come with the atlas. **Higashiyama Highlights** follows Yasaka Shrine → Ninenzaka → Kiyomizu-dera. **Gion Backstreets** takes you from Hanamikoji through Kennin-ji to % Arabica Kyoto Higashiyama. Show both walks together or hide either one.

## Design notes

### Keep the walk in sight

Halfway through planning, you spot a café near Ninenzaka. Is it on the way? The line you just drew is what lets you answer. In Aina, opening a place and editing a walk are separate actions. You can check photos, opening hours or the café's website before choosing **Add to route**. The line is anchored to geographic coordinates, so you can zoom in and see exactly where you'd turn.

### Give the map some room

On a desktop, you might want the shrine's opening hours on the left, the café on the right, and the streets between them in clear view. Movable cards let you arrange that comparison yourself. On a phone, the same details slide up from the bottom, leaving the map a gesture away. Search is visible from the start. Tools for sorting stops, comparing places and managing walks appear when you open a card.

### Let a walk begin with one stop

Sometimes the whole plan is “I'd like to go there.” The first pin is enough to name and save a draft. A street-by-street line appears once you add a second stop. You can lay a morning walk through Higashiyama beside an afternoon in Gion to see where they come close, then duplicate a route to try another way through. An unfinished walk keeps its stop order for the next time you open it.

### Start at walking pace

In Higashiyama, two pins can sit a street apart while the way in takes you around a temple wall and up a flight of stone steps. Those last few turns matter. The Kyoto example ships with a pedestrian network so you can plan offline. Elsewhere, Google Routes fills in missing segments. If it can't find a walking connection, Aina keeps both stops and leaves that stretch undrawn.

## Run locally

You'll need Python 3.9 or later. The Kyoto map, photos and walking network come with the repository, so you can try the first walk without an API key.

```sh
git clone https://github.com/azhezyz/Project_Aina.git
cd Project_Aina
```

| Platform | Start the local server |
| --- | --- |
| Windows | `py -3 server.py` |
| macOS or Linux | `python3 server.py` |

Once the server is running, open the [English atlas](http://127.0.0.1:5173/?lang=en). Use the language switch in the search bar to move between English and Chinese. Aina remembers your choice. Both languages share the same routes and notes in this browser, so use the same local address when you return. On Windows, you can also start the server from VS Code with **Terminal → Run Task → 启动 Project Aina**.

## Plan a walk in another city

Connect Google Maps to select shops and landmarks directly on the map, or enter a place and city in the search bar and press **Enter**. Place cards show photos, ratings, addresses, websites and opening hours when available. Websites that allow embedding can open inside the map.

1. Enable billing on your Google Cloud project, then enable **Maps JavaScript API**, **Places UI Kit**, **Places API (New)** and **Routes API**.
2. Create a browser API key. Restrict it to those services and to the address you use, such as `http://127.0.0.1:5173/*`.
3. Click the map status near the map attribution to enter a key for the current tab. On Windows, run `py -3 server.py --set-key` to save an encrypted key for your Windows user. You can also set the `AINA_GOOGLE_MAPS_BROWSER_KEY` environment variable before starting the server.

Markers and routes move with the Google basemap as you pan or zoom. In eastern Kyoto, Aina uses the bundled walking network first. It asks Google Routes for missing segments and reuses them for the rest of the page session. Advanced place cards use Places UI Kit Pro. Aina requests place names on demand, and Google bills online usage to the project that owns the key. [Google Maps API key setup](https://developers.google.com/maps/documentation/javascript/get-api-key) · [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)

<details>
<summary><strong>Map gestures and shortcuts</strong></summary>

| To… | Do this |
| --- | --- |
| Search for a place | Press <kbd>/</kbd> to focus the search bar |
| Make room on the map | Drag a place window by its title bar or collapse it |
| Close every place window | Double-click the handle at the bottom. Visible routes stay on the map |
| Find your saved walks | Drag the bottom handle up to open **My routes** |
| Tuck the panel away | Press <kbd>Esc</kbd> or drag the handle down |

</details>

## Maps and photography

The offline Kyoto map, walking network and cover illustration use data © OpenStreetMap contributors, available under ODbL 1.0. The bundled photographs come from Wikimedia Commons. The photo catalog lists each photographer, the original image, its license and the WebP conversion. [OpenStreetMap attribution](https://www.openstreetmap.org/copyright) · [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) · [Photo credits](web/photo-catalog.js)
