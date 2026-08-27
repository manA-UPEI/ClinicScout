import { geocode } from "../../../infrastructure/geo/createGeocoder.ts";
import type { AgentTool } from "./shared.ts";

export const geocodeTool: AgentTool = {
  declaration: {
    name: "geocode_location",
    description:
      "Resolve the user's typed location into coordinates. Call this first — " +
      "search_clinics cannot run until it has.",
    parameters: {
      type: "OBJECT",
      properties: {
        location: {
          type: "STRING",
          description: "The location to resolve, as the user typed it.",
        },
      },
      required: ["location"],
    },
  },
  async execute(state, args) {
    const location =
      typeof args.location === "string" && args.location.trim()
        ? args.location
        : state.input.location;

    // A location we cannot resolve is the user's to fix, not the agent's — let
    // it propagate so the UI can show the proper error state instead of the
    // model narrating its way around a dead end.
    const place = await geocode(location);
    state.place = place;

    return {
      response: { display_name: place.display_name, lat: place.lat, lon: place.lon },
      step: {
        id: "geocode",
        message: `📍 Resolved "${location}" to ${place.display_name}.`,
      },
    };
  },
};
