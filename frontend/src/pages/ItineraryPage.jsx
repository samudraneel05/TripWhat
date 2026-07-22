import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTrip } from "@/contexts/TripContext";
import { useAuth } from "@/contexts/AuthContext";
import { useSocket } from "@/hooks/useSocket";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ItineraryMap } from "@/components/ItineraryMap";
import { ChatSidebar } from "@/components/ChatSidebar";
import { TimelineItinerary } from "@/components/TimelineItinerary";
import TravelRouteDisplay from "@/components/TravelRouteDisplay";
import HotelSearch from "@/components/HotelSearch";
import HotelDisplay from "@/components/HotelDisplay";
import {
  apiSaveTrip,
  apiCheckTripSaved,
  apiMarkTripAsUpcoming,
  getToken,
} from "@/lib/api";
import { toast } from "react-toastify";
import { fetchWeatherData, getWeatherTip } from "@/utils/weatherService";
import {
  Calendar,
  MapPin,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Map as MapIcon,
  List,
  Users,
  Heart,
  Share2,
  Navigation,
  Sparkles,
  Star,
  ArrowLeft,
  Download,
  Edit3,
  ExternalLink,
  Sun,
  Sunset,
  Moon,
  CheckCircle2,
  Play,
  Pause,
  RotateCcw,
  Filter,
  Eye,
  EyeOff,
  Loader2,
  Clock,
  MessageSquare,
  ListOrdered,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudDrizzle,
  Zap,
  Wind,
  Thermometer,
  Droplets,
  Plane,
  Hotel,
} from "lucide-react";

const ItineraryPage = () => {
  const navigate = useNavigate();
  const { tripData, updateTripData } = useTrip();
  const { isAuthenticated, user } = useAuth();
  const [activeTab, setActiveTab] = useState("timeline");
  const [selectedDay, setSelectedDay] = useState(1);
  const [activeTimelineDay, setActiveTimelineDay] = useState(1);
  const [completedActivities, setCompletedActivities] = useState(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [showOnlyIncomplete, setShowOnlyIncomplete] = useState(false);
  const [animateCards, setAnimateCards] = useState(true);
  const [showUpcomingModal, setShowUpcomingModal] = useState(false);
  const [tripStartDate, setTripStartDate] = useState("");
  const [isMarkingUpcoming, setIsMarkingUpcoming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [selectedTravelRoutes, setSelectedTravelRoutes] = useState({});
  const [hotelResults, setHotelResults] = useState([]);
  const [isHotelLoading, setIsHotelLoading] = useState(false);

  const scrollContainerRef = React.useRef(null);
  const [weatherData, setWeatherData] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [timelineWeatherData, setTimelineWeatherData] = useState(null);
  const [timelineWeatherLoading, setTimelineWeatherLoading] = useState(false);

  // Socket for real-time itinerary updates
  const conversationId = localStorage.getItem('tripwhat_conversation_id');
  const { lastItineraryUpdate, clearLastItineraryUpdate } = useSocket(conversationId);

  // Handle different data structures for itinerary
  const itinerary =
    tripData?.generatedItinerary?.itinerary ||
    tripData?.generatedItinerary ||
    null;

  // Function to get weather data for a specific trip date
  const getWeatherForTripDate = async (lat, lon, cityName, tripDate) => {
    setWeatherLoading(true);
    try {
      const weather = await fetchWeatherData(lat, lon, cityName, tripDate);
      setWeatherData(weather);
    } catch (error) {
      console.error("Weather fetch error:", error);
      setWeatherData(null);
    } finally {
      setWeatherLoading(false);
    }
  };

  // Function to get weather data for timeline day
  const getTimelineWeatherForTripDate = async (
    lat,
    lon,
    cityName,
    tripDate
  ) => {
    setTimelineWeatherLoading(true);
    try {
      const weather = await fetchWeatherData(lat, lon, cityName, tripDate);
      setTimelineWeatherData(weather);
    } catch (error) {
      console.error("Timeline weather fetch error:", error);
      setTimelineWeatherData(null);
    } finally {
      setTimelineWeatherLoading(false);
    }
  };

  // Calculate the actual date for the selected day of the trip
  const getTripDateForDay = (dayNumber) => {
    if (!tripData?.startDate || !dayNumber) return null;

    const startDate = new Date(tripData.startDate);
    const tripDate = new Date(startDate);
    tripDate.setDate(startDate.getDate() + (dayNumber - 1));

    return tripDate;
  };

  // Get location from selected day's first activity
  const getSelectedDayLocation = (dayData) => {
    if (!dayData || !dayData.timeSlots) return null;

    for (const slot of dayData.timeSlots) {
      if (slot.activities && slot.activities.length > 0) {
        const activity = slot.activities[0];
        if (
          activity.location &&
          activity.location.latitude &&
          activity.location.longitude
        ) {
          return {
            lat: activity.location.latitude,
            lon: activity.location.longitude,
            city:
              activity.location.city ||
              activity.location.address?.split(",")[0] ||
              "Unknown",
          };
        }
      }
    }
    return null;
  };

  console.log("📊 ItineraryPage - tripData:", tripData);
  console.log("📊 ItineraryPage - itinerary:", itinerary);
  console.log("📊 ItineraryPage - generatedItinerary structure:", {
    hasGeneratedItinerary: !!tripData?.generatedItinerary,
    hasItinerary: !!tripData?.generatedItinerary?.itinerary,
    hasDays: !!tripData?.generatedItinerary?.itinerary?.days,
    daysLength: tripData?.generatedItinerary?.itinerary?.days?.length,
    hasTripMetadata: !!tripData?.generatedItinerary?.tripMetadata,
  });

  useEffect(() => {
    if (!itinerary) {
      console.warn("⚠️ No itinerary data found");
    } else {
      console.log("✅ Itinerary data exists!");
    }
  }, [itinerary]);

  // Listen for real-time itinerary updates from chat modifications
  useEffect(() => {
    if (lastItineraryUpdate) {
      console.log('🔄 [ITINERARY PAGE] Received itinerary update from socket');
      
      // Update the TripContext with the modified itinerary
      if (lastItineraryUpdate.updatedItinerary) {
        updateTripData({
          generatedItinerary: lastItineraryUpdate.updatedItinerary
        });
        
        toast.success(lastItineraryUpdate.modification?.message || 'Itinerary updated!');
      }
      
      clearLastItineraryUpdate();
    }
  }, [lastItineraryUpdate, updateTripData, clearLastItineraryUpdate]);

  // Check if trip is already saved
  useEffect(() => {
    const checkIfSaved = async () => {
      if (!tripData || !tripData.startDate || !tripData.cities) return;

      try {
        const token = getToken();
        if (!token) return;

        const params = {
          startDate:
            tripData.startDate instanceof Date
              ? tripData.startDate.toISOString()
              : tripData.startDate,
          cities: JSON.stringify(tripData.cities),
          people: tripData.people,
          travelType: tripData.travelType,
        };

        const response = await apiCheckTripSaved(params, token);
        setIsSaved(response.isSaved);
      } catch (error) {
        console.error("Error checking if trip is saved:", error);
      }
    };

    checkIfSaved();
  }, [tripData]);

  const handleSaveTrip = async () => {
    if (!tripData || !itinerary) {
      toast.error("No trip data to save");
      return;
    }

    if (!isAuthenticated) {
      toast.error("Please log in to save trips");
      return;
    }

    setIsSaving(true);

    try {
      const token = getToken();
      console.log("Token retrieved:", token ? "Token found" : "No token");
      if (!token) {
        toast.error("Authentication token not found");
        setIsSaving(false);
        return;
      }

      // Generate a title for the saved trip
      const cityNames =
        tripData.cities?.map((c) => c.name).join(" → ") || "My Trip";
      const title = `${cityNames} - ${new Date(
        tripData.startDate
      ).toLocaleDateString()}`;

      // Debug the current data structure
      console.log(
        "🔍 Saving trip - tripData.generatedItinerary:",
        tripData.generatedItinerary
      );
      console.log(
        "🔍 Saving trip - has itinerary property:",
        !!tripData.generatedItinerary?.itinerary
      );
      console.log(
        "🔍 Saving trip - has days:",
        !!tripData.generatedItinerary?.days
      );
      console.log(
        "🔍 Saving trip - has tripMetadata:",
        !!tripData.generatedItinerary?.tripMetadata
      );

      // Extract the actual itinerary data from the AI response structure
      const actualItinerary =
        tripData.generatedItinerary?.itinerary || tripData.generatedItinerary;

      // Ensure generatedItinerary has the required tripMetadata and proper structure
      const generatedItinerary = {
        ...actualItinerary,
        tripMetadata: actualItinerary?.tripMetadata || {
          destination: cityNames,
          numberOfPeople: tripData.people,
          travelers: tripData.people,
          budget: {
            perDay: tripData.budget?.total
              ? Math.round(
                  tripData.budget.total /
                    (tripData.cities?.reduce(
                      (sum, city) => sum + city.days,
                      0
                    ) || 1)
                )
              : 0,
            breakdown: {
              activities: tripData.budget?.events || 0,
              accommodation: tripData.budget?.accommodation || 0,
              food: tripData.budget?.food || 0,
              travel: tripData.budget?.travel || 0,
            },
          },
        },
        // Preserve the markdown if it exists
        markdown: tripData.generatedItinerary?.markdown,
      };

      console.log(
        "🔍 Saving trip - final generatedItinerary:",
        generatedItinerary
      );
      console.log(
        "🔍 Saving trip - sample activity location:",
        generatedItinerary?.days?.[0]?.timeSlots?.[0]?.activities?.[0]?.location
      );

      const payload = {
        title,
        description: `A ${tripData.travelType} trip to ${cityNames} for ${tripData.people} people`,
        startDate:
          tripData.startDate instanceof Date
            ? tripData.startDate.toISOString()
            : tripData.startDate,
        cities: tripData.cities,
        totalDays:
          tripData.cities?.reduce((sum, city) => sum + city.days, 0) || 0,
        people: tripData.people,
        travelType: tripData.travelType,
        budget: tripData.budget,
        budgetMode: tripData.budgetMode || "capped",
        generatedItinerary,
        startLocation: tripData.startLocation,
        travelMeans: generatedItinerary?.travelMeans,
        tags: [
          tripData.travelType,
          ...(tripData.cities?.map((c) => c.name) || []),
        ],
      };

      await apiSaveTrip(payload, token);
      setIsSaved(true);
      toast.success("Trip saved successfully! 🎉");
    } catch (error) {
      console.error("Error saving trip:", error);
      toast.error(error.message || "Failed to save trip");
    } finally {
      setIsSaving(false);
    }
  };

  const handleMarkAsUpcoming = () => {
    // Use the original trip start date as default
    const originalStartDate = tripData?.startDate
      ? new Date(tripData.startDate).toISOString().split("T")[0]
      : "";
    setTripStartDate(originalStartDate);
    setShowUpcomingModal(true);
  };

  const handleSubmitUpcoming = async () => {
    if (!tripStartDate) {
      toast.error("Please select a trip start date");
      return;
    }

    if (!isAuthenticated) {
      toast.error("Please log in to mark trips as upcoming");
      return;
    }

    try {
      setIsMarkingUpcoming(true);
      const token = getToken();

      if (!token) {
        toast.error("Authentication token not found");
        return;
      }

      // First save the trip, then mark as upcoming
      const cityNames =
        tripData.cities?.map((c) => c.name).join(" → ") || "My Trip";
      const title = `${cityNames} - ${new Date(
        tripData.startDate
      ).toLocaleDateString()}`;

      // Extract the actual itinerary data from the AI response structure
      const actualItinerary =
        tripData.generatedItinerary?.itinerary || tripData.generatedItinerary;

      // Ensure generatedItinerary has the required tripMetadata and proper structure
      const generatedItinerary = {
        ...actualItinerary,
        tripMetadata: actualItinerary?.tripMetadata || {
          destination: cityNames,
          numberOfPeople: tripData.people,
          travelers: tripData.people,
          budget: {
            perDay: tripData.budget?.total
              ? Math.round(
                  tripData.budget.total /
                    (tripData.cities?.reduce(
                      (sum, city) => sum + city.days,
                      0
                    ) || 1)
                )
              : 0,
            breakdown: {
              activities: tripData.budget?.events || 0,
              accommodation: tripData.budget?.accommodation || 0,
              food: tripData.budget?.food || 0,
              travel: tripData.budget?.travel || 0,
            },
          },
        },
        markdown: tripData.generatedItinerary?.markdown,
      };

      const payload = {
        title,
        description: `A ${tripData.travelType} trip to ${cityNames} for ${tripData.people} people`,
        startDate:
          tripData.startDate instanceof Date
            ? tripData.startDate.toISOString()
            : tripData.startDate,
        cities: tripData.cities,
        totalDays:
          tripData.cities?.reduce((sum, city) => sum + city.days, 0) || 0,
        people: tripData.people,
        travelType: tripData.travelType,
        budget: tripData.budget,
        budgetMode: tripData.budgetMode || "capped",
        generatedItinerary,
        startLocation: tripData.startLocation,
        travelMeans: generatedItinerary?.travelMeans,
        tags: [
          tripData.travelType,
          ...(tripData.cities?.map((c) => c.name) || []),
        ],
      };

      // Save the trip first
      const saveResponse = await apiSaveTrip(payload, token);
      const savedTripId = saveResponse.savedTrip._id;

      // Now mark as upcoming
      await apiMarkTripAsUpcoming(savedTripId, { tripStartDate }, token);

      setIsSaved(true);
      toast.success("Trip saved and marked as upcoming! 🎉");
      setShowUpcomingModal(false);
    } catch (err) {
      console.error("Error marking trip as upcoming:", err);
      toast.error("Failed to mark trip as upcoming");
    } finally {
      setIsMarkingUpcoming(false);
    }
  };

  if (!itinerary) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
        <Card className="p-12 bg-white/80 backdrop-blur-sm border border-white/20 shadow-2xl rounded-3xl">
          <div className="text-center space-y-6">
            <div className="w-20 h-20 mx-auto bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Sparkles className="w-10 h-10 text-white animate-pulse" />
            </div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              No Itinerary Found
            </h2>
            <p className="text-gray-600 max-w-md">
              It looks like you haven't generated an itinerary yet. Let's create
              your perfect trip!
            </p>
            <Button
              onClick={() => navigate("/plan/results")}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
            >
              Generate Itinerary
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const { days, tripMetadata } = itinerary;
  const selectedDayData =
    days?.find((d) => d.dayNumber === selectedDay) || days?.[0];

  // Fetch weather when selected day changes
  useEffect(() => {
    const location = getSelectedDayLocation(selectedDayData);
    const tripDate = getTripDateForDay(selectedDay);

    if (location && tripDate) {
      getWeatherForTripDate(
        location.lat,
        location.lon,
        location.city,
        tripDate
      );
    }
  }, [selectedDay, selectedDayData, tripData?.startDate]);

  // Fetch weather when active timeline day changes
  useEffect(() => {
    const timelineDayData = days?.find(
      (d) => d.dayNumber === activeTimelineDay
    );
    const location = getSelectedDayLocation(timelineDayData);
    const tripDate = getTripDateForDay(activeTimelineDay);

    if (location && tripDate) {
      getTimelineWeatherForTripDate(
        location.lat,
        location.lon,
        location.city,
        tripDate
      );
    }
  }, [activeTimelineDay, days, tripData?.startDate]);

  const getTotalActivities = () => {
    return (
      days?.reduce(
        (sum, day) =>
          sum +
          (day.timeSlots?.reduce(
            (s, slot) => s + (slot.activities?.length || 0),
            0
          ) || 0),
        0
      ) || 0
    );
  };

  // ONLY use Google Places images - NO FALLBACKS
  const getActivityImage = (activity) => {
    // Only return Google Places image URL
    if (activity.imageUrl && activity.imageUrl.trim() !== "") {
      console.log("✅ Using Google Places image for:", activity.name);
      return activity.imageUrl;
    }

    console.log("❌ No image available for:", activity.name);
    return null; // Return null if no Google image
  };

  const getPeriodIcon = (period) => {
    const icons = {
      morning: <Sun className="w-5 h-5 text-amber-500" />,
      afternoon: <Sun className="w-5 h-5 text-orange-500" />,
      evening: <Sunset className="w-5 h-5 text-purple-500" />,
      night: <Moon className="w-5 h-5 text-indigo-500" />,
    };
    return (
      icons[period?.toLowerCase()] || (
        <Clock className="w-5 h-5 text-gray-500" />
      )
    );
  };

  const getWeatherIcon = (weatherMain, description) => {
    const weatherLower = weatherMain?.toLowerCase() || "";
    const descLower = description?.toLowerCase() || "";

    if (weatherLower.includes("clear") || weatherLower.includes("sun")) {
      return <Sun className="w-6 h-6 text-yellow-500" />;
    } else if (weatherLower.includes("cloud")) {
      return <Cloud className="w-6 h-6 text-gray-500" />;
    } else if (weatherLower.includes("rain") || descLower.includes("rain")) {
      return <CloudRain className="w-6 h-6 text-blue-500" />;
    } else if (weatherLower.includes("drizzle")) {
      return <CloudDrizzle className="w-6 h-6 text-blue-400" />;
    } else if (weatherLower.includes("snow")) {
      return <CloudSnow className="w-6 h-6 text-blue-200" />;
    } else if (
      weatherLower.includes("thunder") ||
      descLower.includes("storm")
    ) {
      return <Zap className="w-6 h-6 text-purple-500" />;
    } else {
      return <Cloud className="w-6 h-6 text-gray-500" />;
    }
  };

  const toggleActivityComplete = (dayNum, slotIndex, actIndex) => {
    const activityId = `${dayNum}-${slotIndex}-${actIndex}`;
    const newCompleted = new Set(completedActivities);

    if (newCompleted.has(activityId)) {
      newCompleted.delete(activityId);
    } else {
      newCompleted.add(activityId);
    }

    setCompletedActivities(newCompleted);
  };

  const getDayProgress = (day) => {
    const totalActivities =
      day.timeSlots?.reduce(
        (sum, slot) => sum + (slot.activities?.length || 0),
        0
      ) || 0;
    let completedCount = 0;
    day.timeSlots?.forEach((slot, slotIndex) => {
      slot.activities?.forEach((_, actIndex) => {
        if (
          completedActivities.has(`${day.dayNumber}-${slotIndex}-${actIndex}`)
        ) {
          completedCount++;
        }
      });
    });
    return totalActivities > 0 ? (completedCount / totalActivities) * 100 : 0;
  };

  const resetProgress = () => {
    setCompletedActivities(new Set());
  };

  const markDayComplete = (dayNum) => {
    const day = days.find((d) => d.dayNumber === dayNum);
    if (!day) return;

    const newCompleted = new Set(completedActivities);
    day.timeSlots?.forEach((slot, slotIndex) => {
      slot.activities?.forEach((_, actIndex) => {
        newCompleted.add(`${dayNum}-${slotIndex}-${actIndex}`);
      });
    });
    setCompletedActivities(newCompleted);
  };

  return (
    <div className="min-h-screen bg-white flex">
      {/* Main Content Area */}
      <div
        className={`flex-1 transition-all duration-300 ${
          isChatOpen ? "mr-[450px]" : ""
        }`}
      >
        {/* Navbar */}
        <Navbar />

        {/* Main Content Container */}
        <div className="max-w-7xl mx-auto px-6 py-6">
          {/* Page Header with Trip Info and Actions */}
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-6">
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("/plan/results")}
                    className="text-gray-600 hover:text-gray-900 border-gray-300 hover:bg-gray-50 transition-all duration-300 group"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform duration-300" />
                    Back to Results
                  </Button>
                  <div className="h-6 w-px bg-gray-300" />
                  <div className="space-y-1">
                    <h1 className="text-2xl font-bold text-gray-900">
                      {tripMetadata?.destination || "Your Journey"}
                    </h1>
                    <div className="flex items-center gap-3 text-sm text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-blue-500" />
                        <span className="font-medium">
                          {days?.length || 0} Days
                        </span>
                      </div>
                      <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
                      <div className="flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-purple-500" />
                        <span className="font-medium">
                          {tripMetadata?.numberOfPeople ||
                            tripMetadata?.travelers ||
                            1}{" "}
                          Travelers
                        </span>
                      </div>
                      <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-pink-500" />
                        <span className="font-medium">
                          {getTotalActivities()} Activities
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetProgress}
                    className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-300"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Reset
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowOnlyIncomplete(!showOnlyIncomplete)}
                    className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-300"
                  >
                    {showOnlyIncomplete ? (
                      <Eye className="w-4 h-4 mr-2" />
                    ) : (
                      <EyeOff className="w-4 h-4 mr-2" />
                    )}
                    {showOnlyIncomplete ? "Show All" : "Hide Complete"}
                  </Button>
                  <Button
                    onClick={handleSaveTrip}
                    disabled={isSaving || isSaved}
                    size="sm"
                    className={`${
                      isSaved
                        ? "bg-green-600 hover:bg-green-700"
                        : "bg-blue-600 hover:bg-blue-700"
                    } text-white shadow-md hover:shadow-lg transition-all duration-300`}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : isSaved ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Saved
                      </>
                    ) : (
                      <>
                        <Heart className="w-4 h-4 mr-2" />
                        Save Trip
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handleMarkAsUpcoming}
                    disabled={isMarkingUpcoming}
                    size="sm"
                    className="bg-pink-600 hover:bg-pink-700 text-white shadow-md hover:shadow-lg transition-all duration-300"
                  >
                    {isMarkingUpcoming ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Clock className="w-4 h-4 mr-2" />
                        Mark as Upcoming
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-6">
            {/* Sidebar Navigation */}
            <div className="w-80 bg-white border border-gray-200 rounded-lg shadow-sm overflow-y-auto max-h-[calc(100vh-200px)]">
              {/* Tabs */}
              <div className="p-6 border-b border-gray-200">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      id: "timeline",
                      icon: ListOrdered,
                      label: "Timeline",
                      color: "indigo",
                    },
                    {
                      id: "itinerary",
                      icon: List,
                      label: "Itinerary",
                      color: "blue",
                    },
                    {
                      id: "travel",
                      icon: Plane,
                      label: "Travel",
                      color: "green",
                    },
                    {
                      id: "hotels",
                      icon: Hotel,
                      label: "Hotels",
                      color: "orange",
                    },
                    {
                      id: "calendar",
                      icon: Calendar,
                      label: "Overview",
                      color: "purple",
                    },
                    { id: "map", icon: MapIcon, label: "Map", color: "pink" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`relative px-3 py-3 text-sm font-semibold rounded-lg transition-all duration-300 ${
                        activeTab === tab.id
                          ? tab.color === "indigo"
                            ? "bg-indigo-500 text-white shadow-md"
                            : tab.color === "blue"
                            ? "bg-blue-500 text-white shadow-md"
                            : tab.color === "green"
                            ? "bg-green-500 text-white shadow-md"
                            : tab.color === "orange"
                            ? "bg-orange-500 text-white shadow-md"
                            : tab.color === "purple"
                            ? "bg-purple-500 text-white shadow-md"
                            : "bg-pink-500 text-white shadow-md"
                          : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                      }`}
                    >
                      <tab.icon className="w-4 h-4 mx-auto mb-1" />
                      <div className="text-xs">{tab.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Timeline Day Navigation */}
              {activeTab === "timeline" && (
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Days
                  </h3>
                  <div className="space-y-2">
                    {days?.map((day, index) => {
                      const isActive = activeTimelineDay === day.dayNumber;
                      return (
                        <button
                          key={day.dayNumber}
                          onClick={() => {
                            const element = document.getElementById(
                              `day-${day.dayNumber}`
                            );
                            const container = scrollContainerRef.current;
                            if (element && container) {
                              const elementTop = element.offsetTop;
                              container.scrollTo({
                                top: elementTop - 100,
                                behavior: "smooth",
                              });
                            }
                          }}
                          className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-200 ${
                            isActive
                              ? "bg-blue-600 text-white shadow-md"
                              : "bg-gray-50 text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                isActive
                                  ? "bg-white text-blue-600"
                                  : "bg-blue-100 text-blue-600"
                              }`}
                            >
                              {index + 1}
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-semibold">
                                {day.title || `Day ${day.dayNumber}`}
                              </p>
                              <p
                                className={`text-xs ${
                                  isActive ? "text-blue-100" : "text-gray-500"
                                }`}
                              >
                                {day.timeSlots?.reduce(
                                  (sum, slot) =>
                                    sum + (slot.activities?.length || 0),
                                  0
                                ) || 0}{" "}
                                activities
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Timeline Weather Section */}
              {activeTab === "timeline" && (
                <div className="px-6 pb-6">
                  <div className="border-t border-gray-200 pt-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Day {activeTimelineDay} Weather
                    </h3>
                    {getTripDateForDay(activeTimelineDay) && (
                      <p className="text-sm text-gray-600 mb-4">
                        {getTripDateForDay(
                          activeTimelineDay
                        ).toLocaleDateString("en-US", {
                          weekday: "long",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    )}
                    {timelineWeatherLoading ? (
                      <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-4 border border-blue-100">
                        <div className="flex items-center justify-center">
                          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                          <span className="ml-2 text-sm text-gray-600">
                            Loading weather...
                          </span>
                        </div>
                      </div>
                    ) : timelineWeatherData ? (
                      <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-4 border border-blue-100 shadow-sm">
                        {/* Main Weather Info */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            {getWeatherIcon(
                              timelineWeatherData.main,
                              timelineWeatherData.description
                            )}
                            <div>
                              <div className="text-2xl font-bold text-gray-900">
                                {timelineWeatherData.temperature}°C
                              </div>
                              <div className="text-xs text-gray-600 capitalize">
                                {timelineWeatherData.description}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-gray-700 truncate max-w-20">
                              {timelineWeatherData.city}
                            </div>
                            <div className="text-xs text-gray-500">
                              Feels {timelineWeatherData.feelsLike}°C
                            </div>
                            {timelineWeatherData.date && (
                              <div className="text-xs text-blue-600 font-medium mt-1">
                                {(() => {
                                  const today = new Date().toDateString();
                                  const weatherDate = new Date(
                                    getTripDateForDay(activeTimelineDay)
                                  ).toDateString();
                                  if (weatherDate === today) return "Today";
                                  return "Forecast";
                                })()}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Weather Details */}
                        <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-blue-200/50">
                          <div className="flex items-center gap-2">
                            <Droplets className="w-4 h-4 text-blue-500" />
                            <div>
                              <div className="text-xs text-gray-500">
                                Humidity
                              </div>
                              <div className="text-sm font-medium text-gray-700">
                                {timelineWeatherData.humidity}%
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Wind className="w-4 h-4 text-gray-500" />
                            <div>
                              <div className="text-xs text-gray-500">Wind</div>
                              <div className="text-sm font-medium text-gray-700">
                                {timelineWeatherData.windSpeed} m/s
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Weather Tips */}
                        <div className="mt-3 pt-3 border-t border-blue-200/50">
                          <div className="text-xs text-blue-700 bg-blue-100/50 rounded-lg p-2">
                            {getWeatherTip(timelineWeatherData)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                        <div className="text-center text-gray-500">
                          <Cloud className="w-6 h-6 mx-auto mb-2 text-gray-400" />
                          <div className="text-sm">
                            Weather forecast unavailable
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            {getTripDateForDay(activeTimelineDay)
                              ? `For ${getTripDateForDay(
                                  activeTimelineDay
                                ).toLocaleDateString()}`
                              : "Location data needed for weather"}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Day Selection */}
              {activeTab === "itinerary" && (
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Select Day
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {days?.map((day) => {
                      const progress = getDayProgress(day);
                      const isSelected = selectedDay === day.dayNumber;
                      return (
                        <button
                          key={day.dayNumber}
                          onClick={() => setSelectedDay(day.dayNumber)}
                          className={`p-4 rounded-lg border-2 transition-all duration-300 ${
                            isSelected
                              ? "border-blue-500 bg-blue-50 shadow-sm"
                              : "border-gray-200 hover:border-gray-300 bg-white"
                          }`}
                        >
                          <div className="text-sm font-semibold text-gray-900 mb-2">
                            Day {day.dayNumber}
                          </div>
                          <div className="text-xs text-gray-600 mb-2 truncate">
                            {day.title}
                          </div>
                          {progress > 0 && (
                            <div className="w-full bg-gray-200 rounded-full h-1.5">
                              <div
                                className="bg-gradient-to-r from-blue-500 to-purple-500 h-1.5 rounded-full transition-all duration-500"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Weather Section */}
              {activeTab === "itinerary" && (
                <div className="px-6 pb-6">
                  <div className="border-t border-gray-200 pt-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Day {selectedDay} Weather
                    </h3>
                    {getTripDateForDay(selectedDay) && (
                      <p className="text-sm text-gray-600 mb-4">
                        {getTripDateForDay(selectedDay).toLocaleDateString(
                          "en-US",
                          {
                            weekday: "long",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }
                        )}
                      </p>
                    )}
                    {weatherLoading ? (
                      <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-4 border border-blue-100">
                        <div className="flex items-center justify-center">
                          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                          <span className="ml-2 text-sm text-gray-600">
                            Loading weather...
                          </span>
                        </div>
                      </div>
                    ) : weatherData ? (
                      <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-4 border border-blue-100 shadow-sm">
                        {/* Main Weather Info */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            {getWeatherIcon(
                              weatherData.main,
                              weatherData.description
                            )}
                            <div>
                              <div className="text-2xl font-bold text-gray-900">
                                {weatherData.temperature}°C
                              </div>
                              <div className="text-xs text-gray-600 capitalize">
                                {weatherData.description}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-gray-700 truncate max-w-20">
                              {weatherData.city}
                            </div>
                            <div className="text-xs text-gray-500">
                              Feels {weatherData.feelsLike}°C
                            </div>
                            {weatherData.date && (
                              <div className="text-xs text-blue-600 font-medium mt-1">
                                {(() => {
                                  const today = new Date().toDateString();
                                  const weatherDate = new Date(
                                    getTripDateForDay(selectedDay)
                                  ).toDateString();
                                  if (weatherDate === today) return "Today";
                                  return "Forecast";
                                })()}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Weather Details */}
                        <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-blue-200/50">
                          <div className="flex items-center gap-2">
                            <Droplets className="w-4 h-4 text-blue-500" />
                            <div>
                              <div className="text-xs text-gray-500">
                                Humidity
                              </div>
                              <div className="text-sm font-medium text-gray-700">
                                {weatherData.humidity}%
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Wind className="w-4 h-4 text-gray-500" />
                            <div>
                              <div className="text-xs text-gray-500">Wind</div>
                              <div className="text-sm font-medium text-gray-700">
                                {weatherData.windSpeed} m/s
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Weather Tips */}
                        <div className="mt-3 pt-3 border-t border-blue-200/50">
                          <div className="text-xs text-blue-700 bg-blue-100/50 rounded-lg p-2">
                            {getWeatherTip(weatherData)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                        <div className="text-center text-gray-500">
                          <Cloud className="w-6 h-6 mx-auto mb-2 text-gray-400" />
                          <div className="text-sm">
                            Weather forecast unavailable
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            {getTripDateForDay(selectedDay)
                              ? `For ${getTripDateForDay(
                                  selectedDay
                                ).toLocaleDateString()}`
                              : "Location data needed for weather"}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Travel Routes */}
              {activeTab === "travel" && (
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Travel Information
                  </h3>
                  {itinerary?.tripMetadata?.travelMeans ? (
                    <div className="space-y-4">
                      <p className="text-sm text-gray-600">
                        Review and select your preferred travel options for this
                        trip.
                      </p>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Plane className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <h4 className="text-lg font-medium text-gray-900 mb-2">
                        No Travel Information
                      </h4>
                      <p className="text-gray-600 text-sm">
                        Travel routes and flight information are not available
                        for this itinerary.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Overview Stats */}
              {activeTab === "calendar" && (
                <div className="p-6 space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Trip Stats
                  </h3>
                  {[
                    {
                      label: "Total Days",
                      value: days?.length || 0,
                      icon: Calendar,
                      color: "blue",
                    },
                    {
                      label: "Activities",
                      value: getTotalActivities(),
                      icon: Sparkles,
                      color: "purple",
                    },
                    {
                      label: "Completed",
                      value: completedActivities.size,
                      icon: CheckCircle2,
                      color: "green",
                    },
                  ].map((stat, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 p-3 bg-white/50 rounded-lg"
                    >
                      <div
                        className={`w-10 h-10 bg-${stat.color}-500 rounded-lg flex items-center justify-center`}
                      >
                        <stat.icon className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <div className="text-xl font-bold text-gray-900">
                          {stat.value}
                        </div>
                        <div className="text-sm text-gray-600">
                          {stat.label}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Main Content */}
            <div
              ref={scrollContainerRef}
              className="flex-1 bg-white border border-gray-200 rounded-lg shadow-sm overflow-y-auto max-h-[calc(100vh-200px)]"
            >
              {/* Timeline Tab */}
              {activeTab === "timeline" && (
                <div className="p-8">
                  <TimelineItinerary
                    itinerary={itinerary}
                    tripData={tripData}
                    onActiveDayChange={setActiveTimelineDay}
                    scrollContainerRef={scrollContainerRef}
                  />
                </div>
              )}

              {/* Itinerary Tab */}
              {activeTab === "itinerary" && selectedDayData && (
                <div className="p-8">
                  <div className="max-w-4xl mx-auto">
                    {/* Day Header */}
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h2 className="text-3xl font-bold text-gray-900 mb-2">
                          {selectedDayData.title}
                        </h2>
                        <p className="text-gray-600">
                          {selectedDayData.timeSlots?.reduce(
                            (sum, slot) => sum + (slot.activities?.length || 0),
                            0
                          ) || 0}{" "}
                          activities planned
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => markDayComplete(selectedDay)}
                          className="bg-white border-green-300 text-green-700 hover:bg-green-100"
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Complete Day
                        </Button>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              setSelectedDay(Math.max(1, selectedDay - 1))
                            }
                            disabled={selectedDay === 1}
                            className="border-gray-300 text-gray-600 hover:bg-gray-50"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <span className="text-sm text-gray-600 px-3">
                            Day {selectedDay} of {days?.length || 0}
                          </span>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              setSelectedDay(
                                Math.min(days?.length || 1, selectedDay + 1)
                              )
                            }
                            disabled={selectedDay === (days?.length || 1)}
                            className="border-gray-300 text-gray-600 hover:bg-gray-50"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Timeline */}
                    <div className="space-y-8">
                      {selectedDayData.timeSlots?.map((slot, slotIndex) => (
                        <div key={slotIndex} className="relative">
                          {/* Time Period Header */}
                          <div className="flex items-center gap-4 mb-6">
                            <div className="flex items-center gap-3 px-6 py-3 bg-white/50 rounded-xl border border-gray-200/50 shadow-sm">
                              {getPeriodIcon(slot.period)}
                              <span className="font-semibold capitalize text-gray-900">
                                {slot.period}
                              </span>
                              <span className="text-sm text-gray-500">
                                {slot.startTime} - {slot.endTime}
                              </span>
                            </div>
                          </div>

                          {/* Activities */}
                          <div className="space-y-6 ml-6">
                            {slot.activities?.map((activity, actIndex) => {
                              const activityId = `${selectedDayData.dayNumber}-${slotIndex}-${actIndex}`;
                              const isCompleted =
                                completedActivities.has(activityId);

                              if (showOnlyIncomplete && isCompleted)
                                return null;

                              return (
                                <Card
                                  key={actIndex}
                                  className={`overflow-hidden transition-all duration-300 ${
                                    isCompleted
                                      ? "bg-green-50/50 border-green-200 opacity-75"
                                      : "bg-white border-gray-200 hover:shadow-lg transform hover:-translate-y-1"
                                  } ${animateCards ? "animate-fade-in" : ""}`}
                                  style={{
                                    animationDelay: `${actIndex * 100}ms`,
                                  }}
                                >
                                  <div className="flex">
                                    {/* Activity Image - ONLY Google Places */}
                                    <div className="w-64 h-48 flex-shrink-0 relative overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200">
                                      {getActivityImage(activity) ? (
                                        <img
                                          src={getActivityImage(activity)}
                                          alt={activity.name}
                                          className="w-full h-full object-cover transition-transform duration-300 hover:scale-110"
                                          loading="lazy"
                                          onError={(e) => {
                                            // Hide image on error
                                            e.target.style.display = "none";
                                          }}
                                        />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                          <div className="text-center p-6">
                                            <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                                            <p className="text-xs text-gray-500">
                                              No photo available
                                            </p>
                                          </div>
                                        </div>
                                      )}
                                      <div className="absolute top-3 right-3 flex gap-2">
                                        <button
                                          onClick={() =>
                                            toggleActivityComplete(
                                              selectedDayData.dayNumber,
                                              slotIndex,
                                              actIndex
                                            )
                                          }
                                          className={`p-2 rounded-full transition-all duration-300 ${
                                            isCompleted
                                              ? "bg-green-500 text-white scale-110"
                                              : "bg-white/90 text-gray-600 hover:bg-white hover:scale-110"
                                          }`}
                                        >
                                          <CheckCircle2 className="w-5 h-5" />
                                        </button>
                                      </div>
                                      {activity.rating && (
                                        <div className="absolute bottom-3 left-3">
                                          <div className="flex items-center gap-1 bg-white/90 rounded-lg px-2 py-1 shadow-sm">
                                            <Star className="w-3 h-3 text-yellow-500 fill-current" />
                                            <span className="text-xs text-gray-900 font-medium">
                                              {activity.rating}/5
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Activity Details - ENHANCED */}
                                    <div className="flex-1 p-6">
                                      <div className="flex items-start justify-between mb-3">
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 mb-2">
                                            <h3 className="text-xl font-semibold text-gray-900">
                                              {activity.name}
                                            </h3>
                                            {activity.mustVisit && (
                                              <span className="inline-flex items-center px-2 py-1 text-xs font-bold rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 text-white shadow-sm">
                                                <Star className="w-3 h-3 mr-1 fill-current" />
                                                Must Visit
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-2 flex-wrap">
                                            {activity.category && (
                                              <span className="inline-block px-3 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-200 capitalize">
                                                {activity.category}
                                              </span>
                                            )}
                                            {activity.isOpen !== undefined && (
                                              <span
                                                className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                                                  activity.isOpen
                                                    ? "bg-green-50 text-green-700 border border-green-200"
                                                    : "bg-red-50 text-red-700 border border-red-200"
                                                }`}
                                              >
                                                {activity.isOpen
                                                  ? "🟢 Open Now"
                                                  : "🔴 Closed"}
                                              </span>
                                            )}
                                            {activity.tags
                                              ?.slice(0, 3)
                                              .map((tag, idx) => (
                                                <span
                                                  key={idx}
                                                  className="inline-block px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-600"
                                                >
                                                  {tag}
                                                </span>
                                              ))}
                                          </div>
                                        </div>
                                      </div>

                                      {activity.description && (
                                        <p className="text-sm text-gray-600 mb-4 leading-relaxed line-clamp-2">
                                          {activity.description}
                                        </p>
                                      )}

                                      {/* Enhanced Info Grid */}
                                      <div className="grid grid-cols-2 gap-3 mb-4">
                                        <div className="flex items-center gap-2 text-sm text-gray-600">
                                          <Clock className="w-4 h-4 text-blue-500" />
                                          <span>
                                            {activity.duration || "2 hours"}
                                          </span>
                                        </div>
                                        {activity.estimatedCost && (
                                          <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                                            <DollarSign className="w-4 h-4" />
                                            <span>
                                              {activity.estimatedCost}
                                            </span>
                                          </div>
                                        )}
                                        {activity.bestTimeToVisit && (
                                          <div className="flex items-center gap-2 text-sm text-purple-600">
                                            <Sun className="w-4 h-4" />
                                            <span className="truncate">
                                              {activity.bestTimeToVisit}
                                            </span>
                                          </div>
                                        )}
                                        {activity.distanceToNext && (
                                          <div className="flex items-center gap-2 text-sm text-orange-600">
                                            <Navigation className="w-4 h-4" />
                                            <span className="truncate">
                                              {activity.distanceToNext}
                                            </span>
                                          </div>
                                        )}
                                      </div>

                                      {/* Action Buttons */}
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {activity.websiteUrl && (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                              window.open(
                                                activity.websiteUrl,
                                                "_blank"
                                              )
                                            }
                                            className="border-gray-300 text-gray-700 hover:bg-gray-50"
                                          >
                                            <ExternalLink className="w-3 h-3 mr-1" />
                                            Website
                                          </Button>
                                        )}
                                        {activity.phoneNumber && (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                              window.open(
                                                `tel:${activity.phoneNumber}`,
                                                "_blank"
                                              )
                                            }
                                            className="border-gray-300 text-gray-700 hover:bg-gray-50"
                                          >
                                            📞 Call
                                          </Button>
                                        )}
                                        {activity.location?.latitude && (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                              window.open(
                                                `https://www.google.com/maps/dir/?api=1&destination=${activity.location.latitude},${activity.location.longitude}`,
                                                "_blank"
                                              )
                                            }
                                            className="border-blue-300 text-blue-700 hover:bg-blue-50"
                                          >
                                            <MapPin className="w-3 h-3 mr-1" />
                                            Directions
                                          </Button>
                                        )}
                                      </div>

                                      {/* Opening Hours Preview */}
                                      {activity.openingHours &&
                                        activity.openingHours.length > 0 && (
                                          <div className="mt-4 pt-4 border-t border-gray-100">
                                            <details className="group">
                                              <summary className="text-xs font-medium text-gray-600 cursor-pointer hover:text-gray-900 flex items-center gap-2">
                                                <Clock className="w-3 h-3" />
                                                View Opening Hours
                                              </summary>
                                              <div className="mt-2 space-y-1 text-xs text-gray-600">
                                                {activity.openingHours
                                                  .slice(0, 7)
                                                  .map((hours, idx) => (
                                                    <div
                                                      key={idx}
                                                      className="pl-5"
                                                    >
                                                      {hours}
                                                    </div>
                                                  ))}
                                              </div>
                                            </details>
                                          </div>
                                        )}
                                    </div>
                                  </div>
                                </Card>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Travel Tab */}
              {activeTab === "travel" && (
                <div className="p-8">
                  <div className="max-w-6xl mx-auto">
                    <div className="flex items-center justify-between mb-8">
                      <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent">
                        Travel Routes & Flights
                      </h2>
                    </div>

                    {itinerary?.tripMetadata?.travelMeans ? (
                      <TravelRouteDisplay
                        travelMeans={itinerary.tripMetadata.travelMeans}
                        onSelectRoute={(routeIndex, type, selection) => {
                          setSelectedTravelRoutes((prev) => ({
                            ...prev,
                            [routeIndex]: {
                              ...prev[routeIndex],
                              [type]: selection,
                            },
                          }));
                        }}
                        selectedRoutes={selectedTravelRoutes}
                      />
                    ) : (
                      <div className="text-center py-16">
                        <div className="bg-gray-50 rounded-lg p-12">
                          <Plane className="h-16 w-16 text-gray-400 mx-auto mb-6" />
                          <h3 className="text-xl font-semibold text-gray-900 mb-4">
                            No Travel Information Available
                          </h3>
                          <p className="text-gray-600 mb-6 max-w-md mx-auto">
                            This itinerary doesn't include flight and travel
                            route information. Travel means are typically
                            available for multi-city trips generated with our
                            enhanced planning features.
                          </p>
                          <div className="text-sm text-gray-500">
                            <p>To get travel information:</p>
                            <ul className="mt-2 space-y-1">
                              <li>• Generate a new multi-city itinerary</li>
                              <li>
                                • Include starting location in your trip details
                              </li>
                              <li>• Enable travel planning features</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Hotels Tab */}
              {activeTab === "hotels" && (
                <div className="p-8">
                  <div className="max-w-6xl mx-auto">
                    <div className="flex items-center justify-between mb-8">
                      <h2 className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
                        Hotel Search & Booking
                      </h2>
                    </div>

                    {/* Hotel Search Component */}
                    <HotelSearch
                      cities={
                        itinerary?.days
                          ? itinerary.days.map((day, index) => {
                              // Prioritize tripData.cities for clean city names
                              let cityName;

                              // Debug: Log tripData.cities structure
                              if (index === 0) {
                                console.log(
                                  "🏨 Debug tripData.cities:",
                                  tripData?.cities
                                );
                              }

                              // First, try to get clean city name from tripData.cities
                              if (tripData?.cities?.[index]) {
                                cityName =
                                  tripData.cities[index].name ||
                                  tripData.cities[index];
                                console.log(
                                  `🏨 Day ${index + 1} from tripData.cities:`,
                                  cityName
                                );
                              }

                              // If not found, try to extract from day structure
                              if (!cityName) {
                                const firstActivity =
                                  day.timeSlots?.[0]?.activities?.[0];
                                cityName = day.city || day.title;

                                // Clean up descriptive titles to extract city names
                                if (cityName) {
                                  // Remove common prefixes and extract city name
                                  cityName = cityName
                                    .replace(
                                      /^(Travel to|Arrival &|Return to|Explore|Day \d+:?\s*)/i,
                                      ""
                                    )
                                    .replace(
                                      /,\s*(India|France|USA|United States|UK|United Kingdom|Germany|Italy|Spain|Japan|Australia|Canada|Brazil|China|UAE|Singapore|Malaysia|Thailand).*$/i,
                                      ""
                                    )
                                    .replace(
                                      /\s+(First Impressions|and.*)/i,
                                      ""
                                    )
                                    .split(",")[0]
                                    .trim();
                                }

                                // If still no good city name, try activity location
                                if (!cityName || cityName.length < 2) {
                                  if (firstActivity?.location?.address) {
                                    cityName =
                                      firstActivity.location.address.split(
                                        ","
                                      )[0];
                                  } else {
                                    cityName = `City ${index + 1}`;
                                  }
                                }
                              }

                              return {
                                name: cityName,
                                cityName: cityName,
                                checkInDate: day.date,
                                checkOutDate:
                                  index < itinerary.days.length - 1
                                    ? itinerary.days[index + 1].date
                                    : (() => {
                                        const nextDay = new Date(day.date);
                                        nextDay.setDate(nextDay.getDate() + 1);
                                        return nextDay
                                          .toISOString()
                                          .split("T")[0];
                                      })(),
                              };
                            })
                          : tripData?.cities?.map((city, index) => ({
                              name: city.name || city,
                              cityName: city.name || city,
                              checkInDate:
                                tripData?.startDate ||
                                new Date().toISOString().split("T")[0],
                              checkOutDate: (() => {
                                const start = new Date(
                                  tripData?.startDate || new Date()
                                );
                                start.setDate(
                                  start.getDate() + (city.days || 1)
                                );
                                return start.toISOString().split("T")[0];
                              })(),
                            })) || []
                      }
                      onHotelResults={(results) => {
                        setHotelResults(results.cities || []);
                        setIsHotelLoading(false);
                      }}
                    />

                    {/* Hotel Results Display */}
                    {hotelResults.length > 0 && (
                      <div className="mt-8">
                        <h3 className="text-2xl font-semibold text-gray-800 mb-6">
                          Your Hotel Options
                        </h3>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          {hotelResults.map((cityResult, index) => (
                            <Card key={index} className="overflow-hidden">
                              <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white p-4">
                                <h4 className="text-lg font-semibold flex items-center">
                                  <MapPin className="w-5 h-5 mr-2" />
                                  {cityResult.city}
                                </h4>
                                <p className="text-orange-100 text-sm flex items-center mt-1">
                                  <Calendar className="w-4 h-4 mr-1" />
                                  {cityResult.checkInDate} to{" "}
                                  {cityResult.checkOutDate}
                                </p>
                              </div>
                              <div className="p-4">
                                <HotelDisplay
                                  hotels={cityResult.hotels || []}
                                  city={cityResult.city}
                                  checkInDate={cityResult.checkInDate}
                                  checkOutDate={cityResult.checkOutDate}
                                />
                              </div>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Empty State for Hotels */}
                    {!isHotelLoading && hotelResults.length === 0 && (
                      <div className="text-center py-16">
                        <div className="bg-orange-50 rounded-lg p-12">
                          <Hotel className="h-16 w-16 text-orange-400 mx-auto mb-6" />
                          <h3 className="text-xl font-semibold text-gray-900 mb-4">
                            Find Your Perfect Stay
                          </h3>
                          <p className="text-gray-600 mb-6 max-w-md mx-auto">
                            Search for hotels in your destination cities. We'll
                            help you find accommodations that match your budget
                            and preferences.
                          </p>
                          <div className="text-sm text-gray-500">
                            <p>Hotel search includes:</p>
                            <ul className="mt-2 space-y-1">
                              <li>• Real-time availability and pricing</li>
                              <li>• Multiple room types and amenities</li>
                              <li>• Best rate guarantees</li>
                              <li>• Flexible booking options</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Overview Tab */}
              {activeTab === "calendar" && (
                <div className="p-8">
                  <div className="max-w-6xl mx-auto">
                    <div className="flex items-center justify-between mb-8">
                      <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                        Trip Overview
                      </h2>
                      <Button
                        variant="outline"
                        onClick={() => setAnimateCards(!animateCards)}
                        className="border-gray-300 text-gray-700 hover:bg-gray-50"
                      >
                        {animateCards ? (
                          <Pause className="w-4 h-4 mr-2" />
                        ) : (
                          <Play className="w-4 h-4 mr-2" />
                        )}
                        {animateCards ? "Disable" : "Enable"} Animations
                      </Button>
                    </div>

                    {/* Enhanced Day Cards Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                      {days?.map((day, index) => {
                        const progress = getDayProgress(day);
                        const firstActivity = day.timeSlots?.find(
                          (slot) => slot.activities?.length > 0
                        )?.activities?.[0];
                        const totalActivities =
                          day.timeSlots?.reduce(
                            (sum, slot) => sum + (slot.activities?.length || 0),
                            0
                          ) || 0;

                        return (
                          <Card
                            key={day.dayNumber}
                            className={`group relative overflow-hidden bg-white border border-gray-200 shadow-lg hover:shadow-2xl transition-all duration-500 cursor-pointer transform hover:-translate-y-2 hover:scale-[1.02] ${
                              animateCards ? "animate-fade-in-up" : ""
                            }`}
                            style={{ animationDelay: `${index * 150}ms` }}
                            onClick={() => {
                              setSelectedDay(day.dayNumber);
                              setActiveTab("itinerary");
                            }}
                          >
                            {/* Floating Day Number */}
                            <div className="absolute -top-4 -right-4 z-20">
                              <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center shadow-xl transform rotate-12 group-hover:rotate-0 transition-transform duration-500">
                                <span className="text-white font-bold text-lg">
                                  {day.dayNumber}
                                </span>
                              </div>
                            </div>

                            {/* Image Header */}
                            {firstActivity && (
                              <div className="relative h-64 overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent z-10" />
                                <img
                                  src={getActivityImage(firstActivity, index)}
                                  alt={day.title}
                                  className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-700"
                                  loading="lazy"
                                  onError={(e) => {
                                    const fallbackId =
                                      Math.floor(Math.random() * 100) + 1;
                                    e.target.src = `https://picsum.photos/id/${fallbackId}/800/600`;
                                  }}
                                />

                                {/* Title Overlay */}
                                <div className="absolute bottom-6 left-6 right-6 z-20">
                                  <h3 className="text-white text-2xl font-bold mb-2 drop-shadow-lg">
                                    {day.title}
                                  </h3>
                                  <div className="flex items-center gap-3 text-white/90 text-sm">
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                                      <span>{totalActivities} Activities</span>
                                    </div>
                                    <div className="w-1 h-1 bg-white/50 rounded-full"></div>
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                                      <span>Day {day.dayNumber}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Content */}
                            <div className="p-6">
                              {/* Progress Ring */}
                              {progress > 0 && (
                                <div className="flex justify-center mb-4">
                                  <div className="relative w-16 h-16">
                                    <svg
                                      className="w-16 h-16 transform -rotate-90"
                                      viewBox="0 0 64 64"
                                    >
                                      <circle
                                        cx="32"
                                        cy="32"
                                        r="28"
                                        stroke="#e5e7eb"
                                        strokeWidth="4"
                                        fill="none"
                                      />
                                      <circle
                                        cx="32"
                                        cy="32"
                                        r="28"
                                        stroke="url(#progressGradient)"
                                        strokeWidth="4"
                                        fill="none"
                                        strokeLinecap="round"
                                        strokeDasharray={`${2 * Math.PI * 28}`}
                                        strokeDashoffset={`${
                                          2 *
                                          Math.PI *
                                          28 *
                                          (1 - progress / 100)
                                        }`}
                                        className="transition-all duration-1000 ease-out"
                                      />
                                      <defs>
                                        <linearGradient
                                          id="progressGradient"
                                          x1="0%"
                                          y1="0%"
                                          x2="100%"
                                          y2="100%"
                                        >
                                          <stop
                                            offset="0%"
                                            stopColor="#3b82f6"
                                          />
                                          <stop
                                            offset="100%"
                                            stopColor="#8b5cf6"
                                          />
                                        </linearGradient>
                                      </defs>
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <span className="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                                        {Math.round(progress)}%
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Quick Actions */}
                              <div className="flex gap-2 justify-center">
                                <Button
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedDay(day.dayNumber);
                                    setActiveTab("itinerary");
                                  }}
                                  className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white"
                                >
                                  View Details
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    markDayComplete(day.dayNumber);
                                  }}
                                  className="border-green-300 text-green-700 hover:bg-green-50"
                                >
                                  Mark Complete
                                </Button>
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Map Tab */}
              {activeTab === "map" && (
                <div className="h-[calc(100vh-200px)]">
                  <ItineraryMap
                    itinerary={itinerary}
                    selectedDay={selectedDay}
                  />
                </div>
              )}
            </div>
          </div>
          {/* Floating Chat Button */}
          {!isChatOpen && (
            <div className="fixed bottom-6 right-6 z-40">
              <Button
                onClick={() => setIsChatOpen(true)}
                className="px-6 py-3 h-auto rounded-full bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:from-blue-700 hover:via-purple-700 hover:to-pink-700 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105 backdrop-blur-sm border border-white/30 hover:border-white/50 relative overflow-hidden group"
              >
                {/* Shimmer effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent transform -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                <MessageSquare className="w-5 h-5 mr-2 relative z-10" />
                <span className="relative z-10 font-semibold">
                  Open in Chat
                </span>
              </Button>
            </div>
          )}{" "}
          {/* Chat Backdrop - Click area to close sidebar */}
          {isChatOpen && (
            <div
              className="fixed inset-0 z-40 transition-opacity duration-300"
              onClick={() => setIsChatOpen(false)}
            />
          )}
          {/* Chat Sidebar */}
          <ChatSidebar
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            onItineraryUpdate={(newItinerary) => {
              // Handle itinerary updates from chat if needed
              console.log("New itinerary from chat:", newItinerary);
            }}
          />
          {/* Upcoming Trip Modal */}
          {showUpcomingModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <Card className="w-full max-w-md bg-white/95 backdrop-blur-sm border border-white/20 shadow-2xl rounded-2xl">
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-gradient-to-r from-green-500 to-blue-500 rounded-xl flex items-center justify-center">
                      <Clock className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">
                        Mark as Upcoming
                      </h3>
                      <p className="text-sm text-gray-600">
                        Set your trip start date
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Trip Start Date *
                      </label>
                      <input
                        type="date"
                        value={tripStartDate}
                        onChange={(e) => setTripStartDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                      />
                    </div>

                    {tripStartDate && (
                      <div className="bg-blue-50 p-3 rounded-lg">
                        <p className="text-sm text-blue-800">
                          <strong>Calculated End Date:</strong>{" "}
                          {(() => {
                            const startDate = new Date(tripStartDate);
                            const endDate = new Date(startDate);
                            endDate.setDate(
                              endDate.getDate() + (tripData?.totalDays || 0)
                            );
                            return endDate.toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            });
                          })()}
                        </p>
                        <p className="text-xs text-blue-600 mt-1">
                          Based on {tripData?.totalDays || 0} day
                          {(tripData?.totalDays || 0) !== 1 ? "s" : ""} trip
                          duration
                        </p>
                      </div>
                    )}

                    <div className="bg-blue-50 p-3 rounded-lg">
                      <p className="text-sm text-blue-800">
                        <strong>Note:</strong> This will save your trip and mark
                        it as upcoming. The end date will be calculated
                        automatically based on your trip duration.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-6">
                    <Button
                      onClick={() => setShowUpcomingModal(false)}
                      variant="outline"
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSubmitUpcoming}
                      disabled={isMarkingUpcoming || !tripStartDate}
                      className="flex-1 bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 text-white"
                    >
                      {isMarkingUpcoming ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Clock className="w-4 h-4 mr-2" />
                          Mark as Upcoming
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ItineraryPage;
