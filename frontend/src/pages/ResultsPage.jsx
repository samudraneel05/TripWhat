import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import TripPlanningSidebar from "@/components/TripPlanningSidebar";
import { useTrip } from "@/contexts/TripContext";
import { getToken } from "@/lib/api";
import axios from "axios";
import Navbar from "@/components/Navbar";
import {
  Sparkles,
  MapPin,
  Calendar,
  DollarSign,
  Users,
  ArrowRight,
  ArrowLeft,
  Loader2,
  MessageSquare,
  AlertCircle,
} from "lucide-react";

const ResultsPage = () => {
  const navigate = useNavigate();
  const { tripData, updateTripData } = useTrip();

  const [generatedItinerary, setGeneratedItinerary] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Generate AI itinerary when component mounts with complete data
  useEffect(() => {
    if (!tripData) {
      console.log("No trip data available, redirecting to planner");
      navigate("/plan");
      return;
    }

    const hasCore =
      tripData?.startDate &&
      Array.isArray(tripData?.cities) &&
      tripData.cities?.length > 0;
    const hasPrefs = tripData?.people && tripData?.travelType;

    // More lenient budget check - if we have at least a budget object
    // we'll use default values for any missing fields
    const hasBudget = tripData?.budget !== undefined;

    // Log helpful information for debugging
    console.log("Trip data check:", {
      hasCore,
      hasPrefs,
      hasBudget,
      budget: tripData?.budget,
    });

    if (!hasCore || !hasPrefs || !hasBudget) {
      console.log("Missing required trip data for itinerary generation");
      console.log("Trip data state:", {
        tripData,
        hasCore,
        hasPrefs,
        hasBudget,
      });
      return;
    }

    const generateItinerary = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Ensure we have a budget object with default values for any missing fields
        const defaultBudget = {
          total: 5000,
          travel: 25,
          accommodation: 25,
          food: 25,
          events: 25,
        };

        // Merge any existing budget values with defaults
        const budget = {
          ...defaultBudget,
          ...(tripData.budget || {}),
        };

        // Build the payload with validated budget
        const payload = {
          startDate:
            tripData.startDate instanceof Date
              ? tripData.startDate.toISOString()
              : tripData.startDate,
          startLocation: tripData.startLocation,
          origin: tripData.startLocation?.name || tripData.startLocation, // Add origin for flight search
          cities: (tripData.cities || []).map((c, idx) => ({
            id: c.id || `city-${idx}`,
            name: c.name,
            days: c.days,
            order: idx + 1,
          })),
          people: tripData.people,
          travelType: tripData.travelType,
          budget: {
            total: budget.total,
            travel: budget.travel,
            accommodation: budget.accommodation,
            food: budget.food,
            events: budget.events,
          },
          budgetMode: tripData.budgetMode || "capped",
        };

        console.log("🎯 Generating AI itinerary with payload:", payload);

        const token = getToken();
        const AI_API_URL =
          import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

        console.log(`[ITINERARY] Environment variables:`, {
          VITE_API_URL: import.meta.env.VITE_API_URL,
          VITE_SOCKET_URL: import.meta.env.VITE_SOCKET_URL,
          AI_API_URL: AI_API_URL,
        });
        // Determine which endpoint to use based on whether start location is provided
        const useEnhancedEndpoint =
          payload.startLocation &&
          (typeof payload.startLocation === "string"
            ? payload.startLocation.trim().length > 0
            : payload.startLocation.name &&
              payload.startLocation.name.trim().length > 0);
        const endpoint = useEnhancedEndpoint
          ? "/api/itinerary/generate-with-travel"
          : "/api/itinerary/generate";
        const fullUrl = `${AI_API_URL}${endpoint}`;

        console.log(`[ITINERARY] Making request to: ${fullUrl}`);
        console.log(
          `[ITINERARY] Using enhanced endpoint: ${useEnhancedEndpoint}`
        );
        console.log(`[ITINERARY] Start location: ${payload.startLocation}`);
        console.log(`[ITINERARY] Token present: ${!!token}`);
        console.log(
          `[ITINERARY] Token value:`,
          token?.substring(0, 20) + "..."
        );

        // Test connectivity first
        try {
          const healthCheck = await axios.get(`${AI_API_URL}/health`, {
            timeout: 5000,
          });
          console.log(`[ITINERARY] Health check successful:`, healthCheck.data);
        } catch (healthError) {
          console.error(`[ITINERARY] Health check failed:`, healthError);
          throw new Error(`Cannot connect to AI service at ${AI_API_URL}`);
        }

        const response = await axios.post(fullUrl, payload, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 300000, // 5 minute timeout for AI generation
        });

        console.log("✅ AI Itinerary generated:", response.data);
        setGeneratedItinerary(response.data);

        updateTripData({
          generatedItinerary: response.data,
          itineraryMarkdown: response.data.markdown,
        });
      } catch (err) {
        console.error("❌ Error generating itinerary:", err);
        console.error("❌ Error details:", {
          message: err.message,
          response: err.response?.data,
          status: err.response?.status,
          config: err.config?.url,
        });

        let errorMessage = "Failed to generate itinerary";

        if (
          err.code === "NETWORK_ERROR" ||
          err.message.includes("Network Error")
        ) {
          errorMessage = "Network Error - Unable to connect to AI service";
        } else if (err.response?.status === 401) {
          errorMessage = "Authentication failed - Please login again";
        } else if (err.response?.status === 500) {
          errorMessage = "Server error - Please try again later";
        } else if (err.response?.data?.error) {
          errorMessage = err.response.data.error;
        } else if (err.message) {
          errorMessage = err.message;
        }

        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };
    generateItinerary();
  }, []); // Only run once on mount

  const handleViewItinerary = () => {
    console.log("🔵 VIEW ITINERARY BUTTON CLICKED - Navigating to /itinerary");
    console.log("Current tripData:", tripData);
    navigate("/itinerary");
  };

  const handleOpenChat = () => {
    console.log("🟢 OPEN CHAT BUTTON CLICKED - Navigating to /chat");
    navigate("/chat");
  };

  const handleStepClick = (step) => {
    switch (step) {
      case "destinations":
        navigate("/plan");
        break;
      case "budget":
        if (tripData?.cities?.length > 0 && tripData?.startDate) {
          navigate("/plan/budget");
        }
        break;
      case "preferences":
        if (tripData?.budget?.total) {
          navigate("/plan/preferences");
        }
        break;
      case "results":
        break;
      default:
        break;
    }
  };

  const getTotalActivities = () => {
    const itinerary = generatedItinerary?.itinerary || generatedItinerary;
    if (!itinerary?.days) return 0;
    return itinerary.days.reduce(
      (sum, day) =>
        sum +
        (day.timeSlots || []).reduce(
          (s, slot) => s + (slot.activities || []).length,
          0
        ),
      0
    );
  };

  const getTotalDays = () => {
    return tripData?.cities?.reduce((sum, city) => sum + city.days, 0) || 0;
  };

  const getCityNames = () => {
    return tripData?.cities?.map((c) => c.name).join(" → ") || "";
  };

  // Safety check to prevent rendering issues
  if (!tripData) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 text-black">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
            <p>Loading trip data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 text-black">
      <Navbar />
      <div className="flex flex-1 pt-0">
        <TripPlanningSidebar
          currentStep="results"
          onStepClick={handleStepClick}
          tripData={tripData}
        />

        <div className="flex-1 p-8">
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-yellow-500 to-orange-500 shadow-lg">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">
                    Your Personalized Itinerary
                  </h1>
                  <p className="text-gray-600 mt-1">
                    AI-generated based on your preferences, budget, and travel
                    style
                  </p>
                </div>
              </div>
            </div>

            {/* Loading State */}
            {isLoading && (
              <Card className="p-12 bg-white border border-gray-200">
                <div className="flex flex-col items-center justify-center space-y-4">
                  <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                  <div className="text-center">
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">
                      Creating Your Perfect Itinerary...
                    </h3>
                    <p className="text-gray-600">
                      Our AI is analyzing your preferences and finding the best
                      activities for your trip
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* Error State */}
            {error && !isLoading && (
              <Card className="p-8 bg-red-50 border border-red-200">
                <div className="flex items-start gap-4">
                  <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="text-lg font-semibold text-red-900 mb-2">
                      Failed to Generate Itinerary
                    </h3>
                    <p className="text-red-700 mb-4">{error}</p>
                    <Button
                      onClick={() => window.location.reload()}
                      className="bg-red-600 hover:bg-red-700 text-white"
                    >
                      Try Again
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {/* Success State - Generated Itinerary Card */}
            {generatedItinerary && !isLoading && !error && (
              <Card className="overflow-hidden bg-white border-2 border-blue-200 shadow-xl hover:shadow-2xl transition-all duration-300">
                {/* Banner */}
                <div className="h-48 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 relative">
                  <div className="absolute inset-0 bg-black/20" />
                  <div className="absolute bottom-4 left-6 right-6">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-3 py-1 text-xs font-bold rounded-full bg-white/90 text-blue-600">
                        AI Generated
                      </span>
                      <span className="px-3 py-1 text-xs font-bold rounded-full bg-white/90 text-purple-600 capitalize">
                        {tripData?.travelType} Travel
                      </span>
                    </div>
                    <h2 className="text-3xl font-bold text-white">
                      {getCityNames()}
                    </h2>
                  </div>
                </div>

                {/* Content */}
                <div className="p-8">
                  {/* Trip Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <Calendar className="w-6 h-6 text-blue-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-blue-900">
                        {getTotalDays()}
                      </div>
                      <div className="text-xs text-blue-700">Days</div>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                      <Sparkles className="w-6 h-6 text-green-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-green-900">
                        {getTotalActivities()}
                      </div>
                      <div className="text-xs text-green-700">Activities</div>
                    </div>
                    <div className="text-center p-4 bg-purple-50 rounded-lg">
                      <Users className="w-6 h-6 text-purple-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-purple-900">
                        {tripData?.people}
                      </div>
                      <div className="text-xs text-purple-700">Travelers</div>
                    </div>
                    <div className="text-center p-4 bg-orange-50 rounded-lg">
                      <DollarSign className="w-6 h-6 text-orange-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-orange-900">
                        $
                        {Math.round(
                          generatedItinerary.itinerary?.tripMetadata?.budget
                            ?.perDay || 0
                        )}
                      </div>
                      <div className="text-xs text-orange-700">Per Day</div>
                    </div>
                  </div>

                  {/* Budget Summary */}
                  <div className="mb-8 p-6 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border border-green-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <DollarSign className="w-5 h-5 text-green-600" />
                      Budget Breakdown
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-gray-600">
                          Total Budget
                        </div>
                        <div className="text-2xl font-bold text-gray-900">
                          ${tripData?.budget?.total?.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">
                          Activities Budget/Day
                        </div>
                        <div className="text-xl font-semibold text-gray-900">
                          $
                          {Math.round(
                            generatedItinerary.itinerary?.tripMetadata?.budget
                              ?.breakdown?.activities || 0
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Start Location */}
                  {tripData?.startLocation && (
                    <div className="mb-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <MapPin className="w-5 h-5 text-green-600" />
                        Starting From
                      </h3>
                      <div className="px-4 py-3 bg-green-50 rounded-lg border border-green-200">
                        <span className="font-semibold text-green-900">
                          {tripData.startLocation.name}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Cities Preview */}
                  <div className="mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-pink-600" />
                      Your Journey
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      {tripData?.cities?.map((city, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 px-4 py-2 bg-pink-50 rounded-lg border border-pink-200"
                        >
                          <span className="font-semibold text-pink-900">
                            {city.name}
                          </span>
                          <span className="text-sm text-pink-700">
                            • {city.days}d
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-4">
                    <Button
                      onClick={handleViewItinerary}
                      className="flex-1 h-14 text-lg gap-3 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all"
                    >
                      <Sparkles className="w-5 h-5" />
                      View Itinerary
                      <ArrowRight className="w-5 h-5" />
                    </Button>
                    <Button
                      onClick={handleOpenChat}
                      variant="outline"
                      className="flex-1 h-14 text-lg gap-3 border-2 border-blue-500 text-blue-600 hover:bg-blue-50 shadow-md hover:shadow-lg transition-all"
                    >
                      <MessageSquare className="w-5 h-5" />
                      Open Chat
                      <ArrowRight className="w-5 h-5" />
                    </Button>
                  </div>

                  <p className="text-center text-sm text-gray-500 mt-6">
                    View your full itinerary with timeline & map, or chat with
                    AI to refine your plan
                  </p>
                </div>
              </Card>
            )}

            {/* Navigation */}
            <div className="flex justify-between mt-8">
              <Button
                variant="outline"
                onClick={() => navigate("/plan/budget")}
                className="px-8 py-3 hover:bg-black hover:text-white transition"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Budget
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResultsPage;
