import { v4 as uuidv4 } from 'uuid';
import { googlePlacesAPI } from './googlePlacesAPI.js';

/**
 * Itinerary structures
 */
export interface Activity {
  id: string;
  name: string;
  description: string;
  duration: string;
  cost: string;
  type: string;
  placeId?: string;
  coordinates?: { lat: number; lng: number };
  rating?: number;
  photos?: string[];
  address?: string;
  metadata?: {
    addedBy: 'ai' | 'user';
    addedAt: string;
    source: 'generated' | 'user_request' | 'suggestion';
  };
}

export interface TimeSlot {
  time: string;
  label: string;
  activities: Activity[];
}

export interface Day {
  dayNumber: number;
  title: string;
  timeSlots: TimeSlot[];
}

export interface Itinerary {
  destination: string;
  duration: number;
  days: Day[];
}

export interface ItineraryAction {
  type: 'add' | 'remove' | 'replace' | 'modify' | 'move';
  target: {
    day?: number;
    timeSlot?: 'morning' | 'afternoon' | 'evening';
    activityId?: string;
    activityName?: string;
  };
  details?: {
    placeName?: string;
    placeType?: string;
    category?: string[];
    duration?: string;
    time?: string;
    preferences?: string[];
    newDay?: number;
    newTimeSlot?: string;
  };
}

/**
 * Itinerary Service - Handles modifications to trip itineraries
 */
export class ItineraryService {
  /**
   * Add activity to itinerary
   */
  async addActivity(
    itinerary: Itinerary,
    action: ItineraryAction,
    destination: string
  ): Promise<{ itinerary: Itinerary; addedActivity: Activity; message: string }> {
    const { target, details } = action;
    
    if (!target.day || !target.timeSlot) {
      throw new Error('Day and time slot are required to add activity');
    }

    const day = itinerary.days.find(d => d.dayNumber === target.day);
    if (!day) {
      throw new Error(`Day ${target.day} not found in itinerary`);
    }

    console.log(`📊 [ITINERARY SERVICE] Day structure:`, {
      dayNumber: day.dayNumber,
      hasTimeSlots: !!day.timeSlots,
      timeSlotsCount: day.timeSlots?.length || 0,
      timeSlotLabels: day.timeSlots?.map((ts: any) => ts.label || ts.period || 'unknown')
    });

    // Find time slot (support both 'label' and 'period' fields)
    const timeSlot = day.timeSlots.find((ts: any) => {
      const slotName = (ts.label || ts.period || '').toLowerCase();
      return slotName === target.timeSlot?.toLowerCase();
    });
    
    if (!timeSlot) {
      throw new Error(`Time slot ${target.timeSlot} not found in Day ${target.day}. Available: ${day.timeSlots?.map((ts: any) => ts.label || ts.period).join(', ')}`);
    }

    // Search for the place
    let activity: Activity;
    
    // Get place name from details or target
    const placeName = details?.placeName || target.activityName;
    
    if (placeName) {
      // Search for specific place
      console.log(`🔍 [ITINERARY SERVICE] Searching for "${placeName}" in ${destination}`);
      const places = await googlePlacesAPI.searchPlaces(
        `${placeName} in ${destination}`
      );

      if (places.length === 0) {
        throw new Error(`Could not find "${placeName}" in ${destination}`);
      }

      console.log(`✅ [ITINERARY SERVICE] Found:`, places[0].displayName || places[0].name);
      const place = places[0];
      activity = this.createActivityFromPlace(place, details);
    } else if (details?.category && details.category.length > 0) {
      // Search by category
      const places = await googlePlacesAPI.searchPlaces(
        `${details.category.join(' ')} in ${destination}`
      );

      if (places.length === 0) {
        throw new Error(`Could not find ${details.category.join(', ')} in ${destination}`);
      }

      const place = places[0];
      activity = this.createActivityFromPlace(place, details);
    } else {
      throw new Error('Either place name or category is required');
    }

    // Add to itinerary
    timeSlot.activities.push(activity);

    const message = `Added ${activity.name} to Day ${target.day} ${target.timeSlot}`;
    
    return { itinerary, addedActivity: activity, message };
  }

  /**
   * Remove activity from itinerary
   */
  removeActivity(
    itinerary: Itinerary,
    action: ItineraryAction
  ): { itinerary: Itinerary; removedActivity: Activity; message: string } {
    const { target } = action;

    if (!target.day) {
      throw new Error('Day is required to remove activity');
    }

    const day = itinerary.days.find(d => d.dayNumber === target.day);
    if (!day) {
      throw new Error(`Day ${target.day} not found in itinerary`);
    }

    let removedActivity: Activity | null = null;
    let timeSlotLabel = '';

    // Search through time slots
    for (const timeSlot of day.timeSlots) {
      const activityIndex = timeSlot.activities.findIndex(a => {
        if (target.activityId) {
          return a.id === target.activityId;
        }
        if (target.activityName) {
          return a.name.toLowerCase().includes(target.activityName.toLowerCase());
        }
        return false;
      });

      if (activityIndex !== -1) {
        removedActivity = timeSlot.activities[activityIndex];
        timeSlotLabel = timeSlot.label;
        timeSlot.activities.splice(activityIndex, 1);
        break;
      }
    }

    if (!removedActivity) {
      throw new Error(
        `Activity "${target.activityName || target.activityId}" not found in Day ${target.day}`
      );
    }

    const message = `Removed ${removedActivity.name} from Day ${target.day} ${timeSlotLabel}`;

    return { itinerary, removedActivity, message };
  }

  /**
   * Replace activity with another
   */
  async replaceActivity(
    itinerary: Itinerary,
    action: ItineraryAction,
    destination: string
  ): Promise<{ itinerary: Itinerary; oldActivity: Activity; newActivity: Activity; message: string }> {
    // First remove the old activity
    const { removedActivity } = this.removeActivity(itinerary, action);
    
    // Then add the new activity at the same location
    const addAction: ItineraryAction = {
      type: 'add',
      target: action.target,
      details: action.details,
    };

    const { addedActivity } = await this.addActivity(itinerary, addAction, destination);

    const message = `Replaced ${removedActivity.name} with ${addedActivity.name}`;

    return { itinerary, oldActivity: removedActivity, newActivity: addedActivity, message };
  }

  /**
   * Move activity to different day/time slot
   */
  moveActivity(
    itinerary: Itinerary,
    action: ItineraryAction
  ): { itinerary: Itinerary; movedActivity: Activity; message: string } {
    const { target, details } = action;

    if (!target.day || !details?.newDay || !details?.newTimeSlot) {
      throw new Error('Source day, target day, and target time slot are required');
    }

    // Remove from current location
    const { removedActivity } = this.removeActivity(itinerary, action);

    // Add to new location
    const targetDay = itinerary.days.find(d => d.dayNumber === details.newDay);
    if (!targetDay) {
      throw new Error(`Day ${details.newDay} not found`);
    }

    const targetTimeSlot = targetDay.timeSlots.find(ts => 
      ts.label.toLowerCase() === details.newTimeSlot?.toLowerCase()
    );
    if (!targetTimeSlot) {
      throw new Error(`Time slot ${details.newTimeSlot} not found in Day ${details.newDay}`);
    }

    targetTimeSlot.activities.push(removedActivity);

    const message = `Moved ${removedActivity.name} from Day ${target.day} to Day ${details.newDay} ${details.newTimeSlot}`;

    return { itinerary, movedActivity: removedActivity, message };
  }

  /**
   * Find and add multiple activities based on preferences
   */
  async findAndAdd(
    itinerary: Itinerary,
    action: ItineraryAction,
    destination: string
  ): Promise<{ itinerary: Itinerary; addedActivities: Activity[]; message: string }> {
    const { target, details } = action;

    if (!target.day) {
      throw new Error('Day is required');
    }

    if (!details?.category || details.category.length === 0) {
      throw new Error('Category/preferences are required');
    }

    // Search for places
    const searchQuery = `${details.category.join(' ')} in ${destination}`;
    const places = await googlePlacesAPI.searchPlaces(searchQuery);

    if (places.length === 0) {
      throw new Error(`Could not find ${details.category.join(', ')} in ${destination}`);
    }

    // Take top 3 results
    const topPlaces = places.slice(0, 3);
    const addedActivities: Activity[] = [];

    const day = itinerary.days.find(d => d.dayNumber === target.day);
    if (!day) {
      throw new Error(`Day ${target.day} not found`);
    }

    // Distribute activities across time slots
    const timeSlots = target.timeSlot
      ? [day.timeSlots.find(ts => ts.label.toLowerCase() === target.timeSlot?.toLowerCase())]
      : day.timeSlots;

    let timeSlotIndex = 0;
    for (const place of topPlaces) {
      const activity = this.createActivityFromPlace(place, details);
      const currentSlot = timeSlots[timeSlotIndex % timeSlots.length];
      
      if (currentSlot) {
        currentSlot.activities.push(activity);
        addedActivities.push(activity);
        timeSlotIndex++;
      }
    }

    const message = `Added ${addedActivities.length} ${details.category.join('/')} activities to Day ${target.day}`;

    return { itinerary, addedActivities, message };
  }

  /**
   * Add a day to the itinerary
   */
  addDay(itinerary: Itinerary): { itinerary: Itinerary; message: string } {
    const newDayNumber = itinerary.days.length + 1;
    
    const newDay: Day = {
      dayNumber: newDayNumber,
      title: `Day ${newDayNumber}`,
      timeSlots: [
        { time: '09:00-12:00', label: 'Morning', activities: [] },
        { time: '14:00-18:00', label: 'Afternoon', activities: [] },
        { time: '19:00-22:00', label: 'Evening', activities: [] },
      ],
    };

    itinerary.days.push(newDay);
    itinerary.duration = itinerary.days.length;

    const message = `Added Day ${newDayNumber} to your itinerary`;

    return { itinerary, message };
  }

  /**
   * Remove a day from the itinerary
   */
  removeDay(itinerary: Itinerary, dayNumber: number): { itinerary: Itinerary; message: string } {
    const dayIndex = itinerary.days.findIndex(d => d.dayNumber === dayNumber);
    
    if (dayIndex === -1) {
      throw new Error(`Day ${dayNumber} not found`);
    }

    itinerary.days.splice(dayIndex, 1);
    
    // Renumber remaining days
    itinerary.days.forEach((day, index) => {
      day.dayNumber = index + 1;
      day.title = `Day ${index + 1}`;
    });

    itinerary.duration = itinerary.days.length;

    const message = `Removed Day ${dayNumber} from your itinerary`;

    return { itinerary, message };
  }

  /**
   * Create activity from Google Place
   */
  private createActivityFromPlace(place: any, details?: any): Activity {
    return {
      id: uuidv4(),
      name: place.displayName?.text || place.name || 'Unknown Place',
      description: place.editorialSummary?.text || `Visit ${place.displayName?.text || 'this location'}`,
      duration: details?.duration || this.estimateDuration(place.types),
      cost: this.estimateCost(place.priceLevel),
      type: place.types?.[0] || 'attraction',
      placeId: place.id,
      coordinates: place.location
        ? { lat: place.location.latitude, lng: place.location.longitude }
        : undefined,
      rating: place.rating,
      photos: place.photos?.slice(0, 3).map((p: any) => p.name) || [],
      address: place.formattedAddress,
      metadata: {
        addedBy: 'user',
        addedAt: new Date().toISOString(),
        source: 'user_request',
      },
    };
  }

  /**
   * Estimate duration based on place type
   */
  private estimateDuration(types?: string[]): string {
    if (!types || types.length === 0) return '1-2h';

    const typeStr = types.join(' ');
    
    if (typeStr.includes('museum') || typeStr.includes('art_gallery')) {
      return '2-3h';
    }
    if (typeStr.includes('park') || typeStr.includes('garden')) {
      return '1-2h';
    }
    if (typeStr.includes('restaurant') || typeStr.includes('cafe')) {
      return '1-1.5h';
    }
    if (typeStr.includes('shopping') || typeStr.includes('store')) {
      return '1-3h';
    }
    
    return '1-2h';
  }

  /**
   * Estimate cost based on price level
   */
  private estimateCost(priceLevel?: string): string {
    if (!priceLevel) return '$10-30';

    switch (priceLevel) {
      case 'PRICE_LEVEL_FREE':
        return 'Free';
      case 'PRICE_LEVEL_INEXPENSIVE':
        return '$10-20';
      case 'PRICE_LEVEL_MODERATE':
        return '$20-40';
      case 'PRICE_LEVEL_EXPENSIVE':
        return '$40-80';
      case 'PRICE_LEVEL_VERY_EXPENSIVE':
        return '$80+';
      default:
        return '$10-30';
    }
  }
}

// Export singleton instance
export const itineraryService = new ItineraryService();
