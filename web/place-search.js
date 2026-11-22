(() => {
  "use strict";

  function createSession() {
    let token, revision = 0;
    const choices = new Map();

    function reset() {
      ++revision;
      token = undefined;
      choices.clear();
    }

    async function suggest(input, locationBias) {
      const query = input.trim();
      if (!query) { reset(); return []; }
      const request = ++revision;
      choices.clear();
      try {
        const {AutocompleteSuggestion, AutocompleteSessionToken} = await window.atlasGoogle.load("places");
        if (request !== revision) return [];
        token ??= new AutocompleteSessionToken();
        const options = {input:query, language:window.atlasLocale.lang, sessionToken:token};
        if (locationBias) options.locationBias = locationBias;
        const {suggestions} = await AutocompleteSuggestion.fetchAutocompleteSuggestions(options);
        if (request !== revision) return [];

        for (const {placePrediction: prediction} of suggestions) {
          const placeId = prediction?.placeId;
          const title = prediction?.mainText?.text || prediction?.text?.text;
          if (!placeId || !title || choices.has(placeId)) continue;
          const result = {placeId, title, subtitle:prediction.secondaryText?.text || ""};
          choices.set(placeId, {result, prediction});
          if (choices.size === 5) break;
        }
        return Array.from(choices.values(), choice => choice.result);
      } catch (error) {
        if (request !== revision) return [];
        window.atlasGoogle.reportGoogleError(error);
        throw error;
      }
    }

    async function select(result) {
      const choice = choices.get(result?.placeId);
      if (!choice || choice.result !== result) throw new Error("Place suggestion expired");
      reset();
      try {
        // Using the prediction's Place carries its session token into the details request.
        const place = choice.prediction.toPlace();
        await place.fetchFields({fields:["location"]});
        const point = window.atlasSavedPlaces.widgetPlace(place);
        if (!point) throw new Error("Selected place is unavailable");
        point.name = result.title;
        return point;
      } catch (error) {
        window.atlasGoogle.reportGoogleError(error);
        throw error;
      }
    }

    return {suggest, select, reset};
  }

  window.atlasPlaceSearch = {createSession};
})();
