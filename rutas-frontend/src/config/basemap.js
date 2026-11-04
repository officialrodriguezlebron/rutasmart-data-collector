/**
 * RutaSmart basemap configuration
 * ===============================
 * Single source of truth for the Leaflet tile layer used by every map in the
 * app (TripMap, AdminMap, StopZoneMap, StopZonePublishPreview).
 *
 * Why this moved off CARTO
 * ------------------------
 * The previous basemap was https://{s}.basemaps.cartocdn.com/dark_all/...
 * CARTO now requires an API key for its hosted basemaps. The endpoint still
 * answers HTTP 200, so tiles appear to "load" — but every tile is an identical
 * "API KEY REQUIRED" placeholder image rather than map imagery. That is why the
 * failure was invisible to automated checks: verified by fetching two different
 * tile coordinates and finding byte-identical responses (and the same for
 * light_all, voyager and dark_nolabels).
 *
 * OpenStreetMap's standard tiles are keyless, return real imagery, and are
 * unambiguously free to use with attribution, which suits an academic project.
 *
 * Attribution is required by the ODbL and must stay attached to the TileLayer.
 * See https://operations.osmfoundation.org/policies/tiles/ for the usage policy.
 *
 * Dark appearance
 * ---------------
 * OSM standard tiles are light; the RutaSmart UI is dark. Rather than depend on
 * a keyed dark provider, the tiles are darkened client-side by a CSS filter
 * scoped to `.leaflet-tile-pane` in src/index.css. That pane contains only
 * basemap tiles, so GPS paths, heatmaps, cluster markers, stop-zone circles and
 * map controls — which live in the overlay, marker and control panes — keep
 * their exact colours.
 */

/** Tile endpoint. No {s} subdomain: OSM serves all tiles from one host. */
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Required attribution. Do not remove — it is a licence condition. */
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Highest zoom OSM serves raster tiles for. */
export const TILE_MAX_ZOOM = 19;

/** Convenience object for the imperative (non-react-leaflet) call sites. */
export const TILE_OPTIONS = {
  attribution: TILE_ATTRIBUTION,
  maxZoom: TILE_MAX_ZOOM,
};
