import React, { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Plane,
  Hotel,
  MapPin,
  Calendar,
  Clock,
  Cloud,
  CloudRain,
  CloudSnow,
  Sun,
  Sunset,
  Moon,
  Star,
  DollarSign,
  ExternalLink,
  Ticket,
  UtensilsCrossed,
  ThermometerSun,
  Wind,
  Droplets,
  Eye,
  Navigation,
  Users,
  Loader2,
  CheckCircle2,
  Globe,
  Phone,
} from 'lucide-react';
import {
  apiGetFlightOffers,
  apiGetHotelOffers,
  apiGetEvents,
  apiGetWeatherForecast,
  apiGetRestaurants,
  getToken,
} from '@/lib/api';
import { toast } from 'react-toastify';

// Weather icon mapper
const getWeatherIcon = (weatherMain) => {
  const icons = {
    Clear: Sun,
    Clouds: Cloud,
    Rain: CloudRain,
    Snow: CloudSnow,
    Drizzle: CloudRain,
  };
  return icons[weatherMain] || Cloud;
};

// Format currency
const formatPrice = (price, currency = 'USD') => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(price);
};

// Format date/time
const formatDateTime = (date) => {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatTime = (time) => {
  return new Date(`1970-01-01T${time}`).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Helper functions from original ItineraryPage
const getActivityImage = (activity) => {
  // Only return Google Places image URL
  if (activity.imageUrl && activity.imageUrl.trim() !== "") {
    return activity.imageUrl;
  }
  return null;
};

const getPeriodIcon = (period) => {
  const icons = {
    morning: <Sun className="w-5 h-5 text-amber-500" />,
    afternoon: <Sun className="w-5 h-5 text-orange-500" />,
    evening: <Sunset className="w-5 h-5 text-purple-500" />,
    night: <Moon className="w-5 h-5 text-indigo-500" />,
  };
  return icons[period?.toLowerCase()] || <Clock className="w-5 h-5 text-gray-500" />;
};

export const TimelineItinerary = ({ itinerary, tripData, onActiveDayChange, scrollContainerRef }) => {
  const [timelineData, setTimelineData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weather, setWeather] = useState({});
  const [hotels, setHotels] = useState([]);
  const [flights, setFlights] = useState([]);
  const [events, setEvents] = useState([]);
  const [restaurants, setRestaurants] = useState({});
  
  const dayRefs = useRef({});

  // Handle scroll to update active day
  useEffect(() => {
    const scrollContainer = scrollContainerRef?.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const scrollTop = scrollContainer.scrollTop;
      const containerTop = scrollContainer.getBoundingClientRect().top;
      
      let currentDay = 1;
      Object.entries(dayRefs.current).forEach(([day, ref]) => {
        if (ref) {
          const elementTop = ref.getBoundingClientRect().top - containerTop;
          // If element is in view (accounting for some offset)
          if (elementTop <= 100) {
            currentDay = parseInt(day);
          }
        }
      });
      
      if (onActiveDayChange) {
        onActiveDayChange(currentDay);
      }
    };

    // Initial check
    handleScroll();

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [onActiveDayChange, scrollContainerRef]);

  // Fetch all travel data
  useEffect(() => {
    const fetchTravelData = async () => {
      if (!itinerary?.days || itinerary.days.length === 0) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const token = getToken();
        const firstCity = tripData?.cities?.[0];
        const startDate = tripData?.startDate;

        if (!firstCity || !token) {
          setLoading(false);
          return;
        }

        // Fetch weather for the destination
        if (firstCity.lat && firstCity.lng) {
          try {
            const weatherData = await apiGetWeatherForecast(
              { lat: firstCity.lat, lon: firstCity.lng },
              token
            );
            
            // Group weather by day
            const weatherByDay = {};
            weatherData.forecast?.forEach((forecast) => {
              const day = new Date(forecast.dt_txt).toDateString();
              if (!weatherByDay[day]) {
                weatherByDay[day] = [];
              }
              weatherByDay[day].push(forecast);
            });
            setWeather(weatherByDay);
          } catch (error) {
            console.error('Error fetching weather:', error);
            setWeather({}); // Set empty object on error
          }
        }

        // Fetch hotels
        if (firstCity.iataCode && startDate) {
          try {
            const checkInDate = new Date(startDate).toISOString().split('T')[0];
            const checkOutDate = new Date(startDate);
            checkOutDate.setDate(checkOutDate.getDate() + (itinerary.days.length || 1));
            const checkOutFormatted = checkOutDate.toISOString().split('T')[0];

            const hotelData = await apiGetHotelOffers(
              {
                cityCode: firstCity.iataCode,
                checkInDate,
                checkOutDate,
                adults: tripData.people || 1,
              },
              token
            );
            setHotels(hotelData.hotels || []);
          } catch (error) {
            console.error('Error fetching hotels:', error);
            setHotels([]); // Set empty array on error
          }
        }

        // Fetch events
        if (firstCity.name && startDate) {
          try {
            const startDateTime = new Date(startDate).toISOString();
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + (itinerary.days.length || 1));
            const endDateTime = endDate.toISOString();

            const eventsData = await apiGetEvents(
              {
                city: firstCity.name,
                startDateTime,
                endDateTime,
                size: 20,
              },
              token
            );
            setEvents(eventsData.events || []);
          } catch (error) {
            console.error('Error fetching events:', error);
            setEvents([]); // Set empty array on error
          }
        }

        // Fetch restaurants for each day's activities
        const restaurantsByDay = {};
        for (const day of itinerary.days) {
          const dayActivities = day.timeSlots?.flatMap(slot => slot.activities || []) || [];
          if (dayActivities.length > 0) {
            const firstActivity = dayActivities[0];
            if (firstActivity.location?.lat && firstActivity.location?.lng) {
              try {
                const restaurantsData = await apiGetRestaurants(
                  {
                    location: `${firstActivity.location.lat},${firstActivity.location.lng}`,
                    radius: 2000,
                    type: 'restaurant',
                  },
                  token
                );
                restaurantsByDay[day.dayNumber] = restaurantsData.restaurants?.slice(0, 5) || [];
              } catch (error) {
                console.error(`Error fetching restaurants for day ${day.dayNumber}:`, error);
              }
            }
          }
        }
        setRestaurants(restaurantsByDay);

        setLoading(false);
      } catch (error) {
        console.error('Error fetching travel data:', error);
        // Don't show error toast, just log it - partial data is better than no data
        console.warn('Some travel data could not be loaded, continuing with available data');
        setLoading(false);
      }
    };

    fetchTravelData();
  }, [itinerary, tripData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!itinerary?.days || itinerary.days.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">No itinerary data available</p>
      </div>
    );
  }

  const days = itinerary.days;

  return (
    <div className="max-w-6xl mx-auto">
          {/* Hotels Section - Before Trip Starts */}
          {hotels.length > 0 && (
            <div className="mb-16">
              <div className="mb-8">
                <div className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl text-white shadow-lg">
                  <Hotel className="w-6 h-6" />
                  <h2 className="text-2xl font-bold">Accommodation Options</h2>
                </div>
                <p className="text-gray-600 mt-3 text-sm">Book your stay for the entire trip</p>
              </div>
              <div className="space-y-4">
                {hotels.slice(0, 3).map((hotel) => {
                  const offer = hotel.offers?.[0];
                  return (
                    <Card key={hotel.hotel.hotelId} className="overflow-hidden bg-white border-gray-200 hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300">
                      <div className="flex">
                        {/* Hotel Image Placeholder */}
                        <div className="w-64 h-48 flex-shrink-0 bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center">
                          <Hotel className="w-16 h-16 text-blue-600" />
                        </div>
                        
                        {/* Hotel Details */}
                        <div className="flex-1 p-6">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                                {hotel.hotel.name}
                              </h3>
                              <div className="flex items-center gap-2 flex-wrap mb-3">
                                <span className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                  <MapPin className="w-3 h-3 mr-1" />
                                  {hotel.hotel.address?.cityName || 'City Center'}
                                </span>
                                {hotel.hotel.rating && (
                                  <span className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">
                                    <Star className="w-3 h-3 mr-1 fill-current" />
                                    {hotel.hotel.rating}/5
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {offer && (
                            <div className="grid grid-cols-2 gap-3 mb-4">
                              <div className="flex items-center gap-2 text-sm">
                                <DollarSign className="w-4 h-4 text-green-500" />
                                <span className="text-green-600 font-semibold">{offer.price.total} {offer.price.currency}</span>
                              </div>
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <Users className="w-4 h-4 text-gray-500" />
                                <span>{offer.guests?.adults || tripData?.people || 1} guests</span>
                              </div>
                              {offer.room?.typeEstimated?.category && (
                                <div className="flex items-center gap-2 text-sm text-gray-600 col-span-2">
                                  <span className="capitalize">{offer.room.typeEstimated.category}</span>
                                  {offer.room?.typeEstimated?.beds && ` • ${offer.room.typeEstimated.beds} bed(s)`}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              className="bg-blue-600 hover:bg-blue-700"
                              onClick={() => {
                                const url = hotel.self || `https://www.booking.com`;
                                window.open(url, '_blank');
                              }}
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              Book Now
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Events Section - Happening During Trip */}
          {events.length > 0 && (
            <div className="mb-16">
              <div className="mb-8">
                <div className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl text-white shadow-lg">
                  <Ticket className="w-6 h-6" />
                  <h2 className="text-2xl font-bold">Events & Entertainment</h2>
                </div>
                <p className="text-gray-600 mt-3 text-sm">Happening during your visit</p>
              </div>
              <div className="space-y-4">
                {events.slice(0, 5).map((event) => (
                  <Card key={event.id} className="overflow-hidden bg-white border-gray-200 hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300">
                    <div className="flex">
                      {/* Event Image */}
                      <div className="w-64 h-48 flex-shrink-0 relative overflow-hidden bg-gradient-to-br from-purple-100 to-purple-200">
                        {event.images?.[0] ? (
                          <img
                            src={event.images[0].url}
                            alt={event.name}
                            className="w-full h-full object-cover transition-transform duration-300 hover:scale-110"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Ticket className="w-16 h-16 text-purple-600" />
                          </div>
                        )}
                        {event.classifications?.[0] && (
                          <div className="absolute top-3 left-3">
                            <span className="inline-block px-3 py-1 text-xs font-medium rounded-full bg-purple-500 text-white shadow-sm">
                              {event.classifications[0].segment?.name || 'Event'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Event Details */}
                      <div className="flex-1 p-6">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <h3 className="text-xl font-semibold text-gray-900 mb-2">
                              {event.name}
                            </h3>
                            <div className="flex items-center gap-2 flex-wrap mb-3">
                              <span className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                <Calendar className="w-3 h-3 mr-1" />
                                {new Date(event.dates.start.dateTime || event.dates.start.localDate).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: event.dates.start.dateTime ? '2-digit' : undefined,
                                  minute: event.dates.start.dateTime ? '2-digit' : undefined,
                                })}
                              </span>
                              {event.venue && (
                                <span className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                  <MapPin className="w-3 h-3 mr-1" />
                                  {event.venue.name}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Event Info Grid */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          {event.priceRanges?.[0] && (
                            <div className="flex items-center gap-2 text-sm">
                              <DollarSign className="w-4 h-4 text-green-500" />
                              <span className="text-green-600 font-semibold">
                                {event.priceRanges[0].min} - {event.priceRanges[0].max} {event.priceRanges[0].currency}
                              </span>
                            </div>
                          )}
                          {event.venue?.city && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <MapPin className="w-4 h-4 text-gray-500" />
                              <span>{event.venue.city.name}</span>
                            </div>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="bg-purple-600 hover:bg-purple-700"
                            onClick={() => window.open(event.url, '_blank')}
                          >
                            <Ticket className="w-4 h-4 mr-2" />
                            Get Tickets
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Day-by-Day Timeline */}
          {days.map((day) => {
            const dayDate = new Date(tripData?.startDate);
            dayDate.setDate(dayDate.getDate() + (day.dayNumber - 1));
            const dayDateString = dayDate.toDateString();
            const dayWeather = weather[dayDateString]?.[0]; // Get first weather forecast for the day
            const dayRestaurants = restaurants[day.dayNumber] || [];

            return (
              <div
                id={`day-${day.dayNumber}`}
                key={day.dayNumber}
                ref={(el) => (dayRefs.current[day.dayNumber] = el)}
                className="mb-16 scroll-mt-24"
              >
                {/* Day Header */}
                <div className="flex items-center justify-between mb-8 pb-4 border-b-2 border-blue-600">
                  <div>
                    <h2 className="text-3xl font-bold text-gray-900">
                      Day {day.dayNumber}
                    </h2>
                    <p className="text-lg text-gray-600 mt-1">{day.title}</p>
                    <p className="text-sm text-gray-500 mt-1">
                      {dayDate.toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  </div>

                  {/* Weather Widget */}
                  {dayWeather && (
                    <Card className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
                      <div className="flex items-center gap-3">
                        {React.createElement(getWeatherIcon(dayWeather.weather.main), {
                          className: 'w-8 h-8 text-blue-600',
                        })}
                        <div>
                          <p className="text-2xl font-bold text-gray-900">
                            {Math.round(dayWeather.temp)}°C
                          </p>
                          <p className="text-xs text-gray-600">{dayWeather.weather.description}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-blue-200">
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                          <Droplets className="w-3 h-3" />
                          <span>{dayWeather.humidity}%</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                          <Wind className="w-3 h-3" />
                          <span>{dayWeather.wind.speed} m/s</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                          <Eye className="w-3 h-3" />
                          <span>{(dayWeather.visibility / 1000).toFixed(1)} km</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                          <CloudRain className="w-3 h-3" />
                          <span>{Math.round((dayWeather.pop || 0) * 100)}%</span>
                        </div>
                      </div>
                    </Card>
                  )}
                </div>

                {/* Activities Timeline */}
                <div className="space-y-8">
                  {day.timeSlots?.map((slot, slotIndex) => {
                    const timeOfDay = slot.timeOfDay || slot.period || 'activity';
                    const displayTimeOfDay = timeOfDay.charAt(0).toUpperCase() + timeOfDay.slice(1);
                    
                    return (
                    <div key={slotIndex} className="relative">
                      {/* Time Period Badge */}
                      <div className="flex items-center gap-4 mb-6">
                        <div className="flex items-center gap-3 px-6 py-3 bg-white/50 rounded-xl border border-gray-200/50 shadow-sm">
                          {getPeriodIcon(timeOfDay)}
                          <span className="font-semibold capitalize text-gray-900">
                            {displayTimeOfDay}
                          </span>
                          {slot.startTime && slot.endTime && (
                            <span className="text-sm text-gray-500">
                              {slot.startTime} - {slot.endTime}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Activities - Enhanced Cards with Images */}
                      <div className="space-y-6 ml-6">
                        {slot.activities?.map((activity, actIndex) => {
                          // Check if this is a travel/flight activity
                          if (activity.type === 'flight' || activity.type === 'travel' || slot.label === 'travel') {
                            return (
                              <Card
                                key={actIndex}
                                className="overflow-hidden bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200 hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300"
                              >
                                <div className="p-6">
                                  {/* Flight Header */}
                                  <div className="flex items-center gap-3 mb-4">
                                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-500 shadow-lg">
                                      <Plane className="w-6 h-6 text-white" />
                                    </div>
                                    <div className="flex-1">
                                      <h3 className="text-xl font-bold text-gray-900">
                                        {activity.name || `Flight: ${activity.from} → ${activity.to}`}
                                      </h3>
                                      <p className="text-sm text-gray-600">
                                        {activity.provider || 'Flight'}
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-2xl font-bold text-blue-600">
                                        {activity.price?.currency || '$'}{activity.price?.amount || activity.price?.total || 'N/A'}
                                      </p>
                                      <p className="text-xs text-gray-500">per person</p>
                                    </div>
                                  </div>

                                  {/* Flight Route */}
                                  <div className="flex items-center justify-between bg-white rounded-lg p-4 mb-4">
                                    <div className="text-center flex-1">
                                      <p className="text-sm text-gray-500 mb-1">From</p>
                                      <p className="text-lg font-bold text-gray-900">{activity.from}</p>
                                      {activity.departure && (
                                        <p className="text-sm text-gray-600 mt-1">
                                          {new Date(activity.departure).toLocaleTimeString('en-US', {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })}
                                        </p>
                                      )}
                                    </div>

                                    <div className="flex-shrink-0 mx-4">
                                      <div className="flex items-center gap-2">
                                        <div className="h-px w-8 bg-gray-300"></div>
                                        <Plane className="w-5 h-5 text-blue-500 transform rotate-90" />
                                        <div className="h-px w-8 bg-gray-300"></div>
                                      </div>
                                      {activity.duration && (
                                        <p className="text-xs text-gray-500 text-center mt-1 whitespace-nowrap">
                                          {activity.duration}
                                        </p>
                                      )}
                                    </div>

                                    <div className="text-center flex-1">
                                      <p className="text-sm text-gray-500 mb-1">To</p>
                                      <p className="text-lg font-bold text-gray-900">{activity.to}</p>
                                      {activity.arrival && (
                                        <p className="text-sm text-gray-600 mt-1">
                                          {new Date(activity.arrival).toLocaleTimeString('en-US', {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })}
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  {/* Booking Button */}
                                  {activity.bookingLink && (
                                    <Button
                                      className="w-full bg-blue-600 hover:bg-blue-700"
                                      onClick={() => window.open(activity.bookingLink, '_blank')}
                                    >
                                      <ExternalLink className="w-4 h-4 mr-2" />
                                      Book Flight
                                    </Button>
                                  )}
                                </div>
                              </Card>
                            );
                          }

                          // Regular activity card
                          return (
                            <Card
                              key={actIndex}
                              className="overflow-hidden bg-white border-gray-200 hover:shadow-lg transform hover:-translate-y-1 transition-all duration-300"
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
                                      e.target.style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <div className="text-center p-6">
                                      <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                                      <p className="text-xs text-gray-500">No photo available</p>
                                    </div>
                                  </div>
                                )}
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

                              {/* Activity Details */}
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
                                        <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                                          activity.isOpen 
                                            ? 'bg-green-50 text-green-700 border border-green-200' 
                                            : 'bg-red-50 text-red-700 border border-red-200'
                                        }`}>
                                          {activity.isOpen ? '🟢 Open Now' : '🔴 Closed'}
                                        </span>
                                      )}
                                      {activity.tags?.slice(0, 3).map((tag, idx) => (
                                        <span key={idx} className="inline-block px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-600">
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

                                {/* Info Grid */}
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                  <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <Clock className="w-4 h-4 text-blue-500" />
                                    <span>{activity.duration || "2 hours"}</span>
                                  </div>
                                  {activity.estimatedCost && (
                                    <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                                      <DollarSign className="w-4 h-4" />
                                      <span>{activity.estimatedCost}</span>
                                    </div>
                                  )}
                                  {activity.bestTimeToVisit && (
                                    <div className="flex items-center gap-2 text-sm text-purple-600">
                                      <Sun className="w-4 h-4" />
                                      <span className="truncate">{activity.bestTimeToVisit}</span>
                                    </div>
                                  )}
                                  {activity.distanceToNext && (
                                    <div className="flex items-center gap-2 text-sm text-orange-600">
                                      <Navigation className="w-4 h-4" />
                                      <span className="truncate">{activity.distanceToNext}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Action Buttons */}
                                <div className="flex items-center gap-2 flex-wrap">
                                  {activity.websiteUrl && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => window.open(activity.websiteUrl, '_blank')}
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
                                      onClick={() => window.open(`tel:${activity.phoneNumber}`, '_blank')}
                                      className="border-gray-300 text-gray-700 hover:bg-gray-50"
                                    >
                                      📞 Call
                                    </Button>
                                  )}
                                  {activity.location?.latitude && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => window.open(
                                        `https://www.google.com/maps/dir/?api=1&destination=${activity.location.latitude},${activity.location.longitude}`,
                                        '_blank'
                                      )}
                                      className="border-blue-300 text-blue-700 hover:bg-blue-50"
                                    >
                                      <MapPin className="w-3 h-3 mr-1" />
                                      Directions
                                    </Button>
                                  )}
                                </div>

                                {/* Opening Hours Preview */}
                                {activity.openingHours && activity.openingHours.length > 0 && (
                                  <div className="mt-4 pt-4 border-t border-gray-100">
                                    <details className="group">
                                      <summary className="text-xs font-medium text-gray-600 cursor-pointer hover:text-gray-900 flex items-center gap-2">
                                        <Clock className="w-3 h-3" />
                                        View Opening Hours
                                      </summary>
                                      <div className="mt-2 space-y-1 text-xs text-gray-600">
                                        {activity.openingHours.slice(0, 7).map((hours, idx) => (
                                          <div key={idx} className="pl-5">{hours}</div>
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
                    );
                  })}

                  {/* Restaurants for this day */}
                  {dayRestaurants.length > 0 && (
                    <div className="relative mt-12">
                      <div className="mb-6">
                        <div className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl text-white shadow-lg">
                          <UtensilsCrossed className="w-5 h-5" />
                          <h3 className="text-xl font-bold">Dining Options</h3>
                        </div>
                        <p className="text-gray-600 mt-3 text-sm">Recommended restaurants nearby</p>
                      </div>
                      <div className="space-y-4">
                        {dayRestaurants.slice(0, 5).map((restaurant) => (
                          <Card key={restaurant.id} className="overflow-hidden bg-white border-gray-200 hover:shadow-lg transform hover:-translate-y-1 transition-all duration-300">
                            <div className="flex">
                              {/* Restaurant Image/Icon */}
                              <div className="w-64 h-48 flex-shrink-0 relative overflow-hidden bg-gradient-to-br from-orange-100 to-orange-200 flex items-center justify-center">
                                {restaurant.photos?.[0] ? (
                                  <img
                                    src={`https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${restaurant.photos[0].photo_reference}&key=${import.meta.env.VITE_GOOGLE_PLACES_API_KEY}`}
                                    alt={restaurant.name}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                  />
                                ) : (
                                  <UtensilsCrossed className="w-16 h-16 text-orange-600" />
                                )}
                                {restaurant.rating && (
                                  <div className="absolute bottom-3 left-3">
                                    <div className="flex items-center gap-1 bg-white/90 rounded-lg px-2 py-1 shadow-sm">
                                      <Star className="w-3 h-3 text-yellow-500 fill-current" />
                                      <span className="text-xs text-gray-900 font-medium">
                                        {restaurant.rating}/5
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Restaurant Details */}
                              <div className="flex-1 p-6">
                                <div className="flex items-start justify-between mb-3">
                                  <div className="flex-1">
                                    <h4 className="text-xl font-semibold text-gray-900 mb-2">{restaurant.name}</h4>
                                    <div className="flex items-center gap-2 flex-wrap mb-3">
                                      {restaurant.types?.slice(0, 2).map((type, idx) => (
                                        <span key={idx} className="inline-block px-3 py-1 text-xs font-medium rounded-full bg-orange-50 text-orange-700 border border-orange-200 capitalize">
                                          {type.replace(/_/g, ' ')}
                                        </span>
                                      ))}
                                      {restaurant.opening_hours?.open_now !== undefined && (
                                        <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                                          restaurant.opening_hours.open_now
                                            ? 'bg-green-50 text-green-700 border border-green-200'
                                            : 'bg-red-50 text-red-700 border border-red-200'
                                        }`}>
                                          {restaurant.opening_hours.open_now ? '🟢 Open Now' : '🔴 Closed'}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {restaurant.vicinity && (
                                  <p className="text-sm text-gray-600 mb-4 line-clamp-2">{restaurant.vicinity}</p>
                                )}

                                {/* Restaurant Info Grid */}
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                  {restaurant.user_ratings_total && (
                                    <div className="flex items-center gap-2 text-sm text-gray-600">
                                      <Users className="w-4 h-4 text-gray-500" />
                                      <span>{restaurant.user_ratings_total.toLocaleString()} reviews</span>
                                    </div>
                                  )}
                                  {restaurant.price_level && (
                                    <div className="flex items-center gap-2 text-sm text-green-600 font-semibold">
                                      <DollarSign className="w-4 h-4" />
                                      <span>{'$'.repeat(restaurant.price_level)}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Action Buttons */}
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                                    onClick={() =>
                                      window.open(
                                        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.name)}&query_place_id=${restaurant.place_id || restaurant.id}`,
                                        '_blank'
                                      )
                                    }
                                  >
                                    <MapPin className="w-3 h-3 mr-1" />
                                    Directions
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
    </div>
  );
};
