import express from "express";
import { TravelAgent } from "../agents/travel-agent.js";
import { enhancedItineraryBuilder } from "../services/enhancedItineraryBuilder.js";
import type { TripContext } from "../types/tripContext.js";

const router = express.Router();

/**
 * POST /api/itinerary/generate
 * Generate AI itinerary from structured trip data
 */
router.post("/generate", async (req, res) => {
  try {
    const tripContext: TripContext = req.body;

    // Validate required fields
    if (!tripContext.cities || tripContext.cities.length === 0) {
      return res.status(400).json({
        error: "At least one destination is required",
      });
    }

    if (!tripContext.startDate) {
      return res.status(400).json({
        error: "Start date is required",
      });
    }

    if (!tripContext.budget || !tripContext.budget.total) {
      return res.status(400).json({
        error: "Budget information is required",
      });
    }

    if (!tripContext.people || tripContext.people < 1) {
      return res.status(400).json({
        error: "Number of travelers is required",
      });
    }

    if (!tripContext.travelType) {
      return res.status(400).json({
        error: "Travel type is required",
      });
    }

    console.log("📋 Generating itinerary with context:", {
      origin: tripContext.origin || 'NOT SET',
      cities: tripContext.cities.map((c) => `${c.name} (${c.days}d)`),
      budget: `$${tripContext.budget.total} (${tripContext.budgetMode})`,
      people: tripContext.people,
      travelType: tripContext.travelType,
      startDate: tripContext.startDate,
    });

    // Create travel agent instance
    const agent = new TravelAgent();

    // Generate itinerary with context
    const result = await agent.generateItineraryWithContext(tripContext);

    if (result.error) {
      return res.status(500).json({
        error: result.error,
      });
    }

    // Return both markdown and structured itinerary
    res.json({
      success: true,
      markdown: result.response,
      itinerary: result.itinerary,
      context: tripContext,
    });
  } catch (error: any) {
    console.error("❌ Error generating itinerary:", error);
    res.status(500).json({
      error: error.message || "Failed to generate itinerary",
    });
  }
});

/**
 * POST /api/itinerary/refine
 * Refine existing itinerary based on user feedback
 */
router.post("/refine", async (req, res) => {
  try {
    const { itinerary, refinementRequest, tripContext } = req.body;

    if (!itinerary || !refinementRequest) {
      return res.status(400).json({
        error: "Itinerary and refinement request are required",
      });
    }

    console.log("🔄 Refining itinerary:", refinementRequest);

    const agent = new TravelAgent();

    // TODO: Implement refinement logic
    // For now, regenerate with the refinement as additional context
    const result = await agent.chat(
      `Based on this itinerary:\n${JSON.stringify(
        itinerary,
        null,
        2
      )}\n\nPlease: ${refinementRequest}`,
      undefined
    );

    res.json({
      success: true,
      response: result.response,
      itinerary: result.itinerary,
    });
  } catch (error: any) {
    console.error("❌ Error refining itinerary:", error);
    res.status(500).json({
      error: error.message || "Failed to refine itinerary",
    });
  }
});

/**
 * POST /api/itinerary/generate-with-travel
 * Generate AI itinerary with travel means and flight information
 */
router.post("/generate-with-travel", async (req, res) => {
  try {
    const tripContext: TripContext = req.body;

    // Validate required fields (same as regular generate)
    if (!tripContext.cities || tripContext.cities.length === 0) {
      return res.status(400).json({
        error: "At least one destination is required",
      });
    }

    if (!tripContext.startDate) {
      return res.status(400).json({
        error: "Start date is required",
      });
    }

    if (!tripContext.startLocation) {
      return res.status(400).json({
        error: "Start location is required for travel planning",
      });
    }

    console.log("🛫 Generating itinerary with travel means:", {
      startLocation: tripContext.startLocation,
      cities: tripContext.cities.map((c) => `${c.name} (${c.days}d)`),
      budget: `$${tripContext.budget?.total} (${tripContext.budgetMode})`,
      people: tripContext.people,
      travelType: tripContext.travelType,
    });

    // Use enhanced itinerary builder with travel means
    const result = await enhancedItineraryBuilder.buildItineraryWithTravelMeans(
      tripContext.startLocation,
      tripContext.cities,
      new Date(tripContext.startDate),
      tripContext.totalDays ||
        tripContext.cities.reduce((sum, c) => sum + c.days, 0),
      {
        travelType: tripContext.travelType,
        preferences: tripContext.preferences || [],
        dailyBudget:
          (tripContext.budget?.total || 1000) / (tripContext.totalDays || 7),
        activityLevel: tripContext.activityLevel || "medium",
        pacing: tripContext.pacing || "moderate",
        numberOfPeople: tripContext.people,
        travelPreferences: tripContext.travelPreferences,
      }
    );

    if (!result) {
      return res.status(500).json({
        error: "Failed to generate itinerary with travel means",
      });
    }

    // Return enhanced itinerary with travel information
    res.json({
      success: true,
      itinerary: result.itinerary,
      travelMeans: result.travelMeans,
      context: tripContext,
    });
  } catch (error: any) {
    console.error("❌ Error generating itinerary with travel:", error);
    return res.status(500).json({
      error: error.message || "Failed to generate itinerary with travel means",
    });
  }
});

export default router;
