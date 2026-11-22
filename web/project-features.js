// Both integrations wait for an authenticated Google basemap. A key may
// come from the local server or be supplied later in the settings dialog.
window.AINA_CONFIG = {
  googlePlaceNamesEnabled: true,
  googleWalkingRoutesEnabled: true,
  ...window.AINA_CONFIG
};
