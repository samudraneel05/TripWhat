import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { mapUserCategoryToPlaceTypes, PLACE_TYPE_DETECTION_PROMPT } from '../config/google-places-types.js';

/**
 * Intent schema for structured output
 */
export const IntentSchema = z.object({
  primary_intent: z.enum([
    'search_destination',
    'search_attractions',
    'search_hotels',
    'search_flights',
    'search_restaurants',
    'plan_trip',
    'get_details',
    'find_nearby',
    'calculate_distance',
    'get_directions',
    'web_search',
    'get_weather',
    'convert_currency',
    'estimate_budget',
    // Itinerary modification intents
    'add_activity',
    'remove_activity',
    'replace_activity',
    'modify_activity',
    'move_activity',
    'add_day',
    'remove_day',
    'find_and_add',
    'casual_chat',
    'unknown'
  ]).describe('The primary intent of the user query'),
  
  entities: z.object({
    location: z.string().nullable().optional().describe('Main location/destination mentioned'),
    origin: z.string().nullable().optional().describe('Starting location for travel'),
    destination: z.string().nullable().optional().describe('Destination for travel'),
    dates: z.object({
      start: z.string().optional(),
      end: z.string().optional(),
    }).nullable().optional().describe('Travel dates in ISO format'),
    duration: z.number().nullable().optional().describe('Number of days for the trip'),
    budget: z.enum(['budget', 'mid-range', 'luxury']).nullable().optional().describe('Budget preference'),
    number_of_people: z.number().nullable().optional().describe('Number of travelers'),
    preferences: z.array(z.string()).optional().describe('User preferences like adventure, culture, food, etc.'),
    category: z.string().nullable().optional().describe('Category of interest like museums, parks, restaurants'),
    google_place_types: z.array(z.string()).optional().describe('Google Places API place types detected from query'),
    query_terms: z.array(z.string()).optional().describe('Key search terms'),
    // Itinerary modification entities
    target_day: z.number().nullable().optional().describe('Day number to modify (1, 2, 3, etc.)'),
    time_slot: z.enum(['morning', 'afternoon', 'evening']).nullable().optional().describe('Time slot for activity'),
    activity_name: z.string().nullable().optional().describe('Name of activity to add/remove/modify'),
    activity_id: z.string().nullable().optional().describe('ID of activity to modify'),
    place_name: z.string().nullable().optional().describe('Specific place/venue name'),
    action_type: z.enum(['add', 'remove', 'replace', 'modify', 'move']).nullable().optional().describe('Type of modification'),
  }).describe('Extracted entities from the query'),
  
  tools_to_call: z.array(z.string()).describe('List of tools that should be called to fulfill this request'),
  
  confidence: z.number().min(0).max(1).describe('Confidence score for the intent detection'),
  
  reasoning: z.string().describe('Brief explanation of why this intent was chosen'),
});

export type DetectedIntent = z.infer<typeof IntentSchema>;

/**
 * LLM-based Intent Detector
 * Uses GPT to understand user queries and determine which tools to call
 */
export class IntentDetector {
  private model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      temperature: 0.3, // Lower temperature for more consistent intent detection
    });
  }

  /**
   * Detect user intent from query with category extraction
   */
  async detectIntent(userQuery: string, conversationHistory?: string[]): Promise<DetectedIntent> {
    try {
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(userQuery, conversationHistory);

      const response = await this.model.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      // Parse the JSON response
      const content = response.content as string;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const validated = IntentSchema.parse(parsed);

      // Detect Google Places types using LLM
      const placeTypes = await this.detectPlaceTypes(userQuery, validated.entities.category ?? undefined);
      validated.entities.google_place_types = placeTypes;

      console.log('🎯 [INTENT DETECTOR] Detected:', {
        intent: validated.primary_intent,
        tools: validated.tools_to_call,
        place_types: placeTypes,
        confidence: validated.confidence,
      });

      return validated;
    } catch (error) {
      console.error('Intent detection error:', error);
      
      // Fallback to simple keyword-based detection
      return this.fallbackDetection(userQuery);
    }
  }

  /**
   * Detect Google Places types using LLM
   */
  private async detectPlaceTypes(userQuery: string, category?: string): Promise<string[]> {
    try {
      const prompt = `${PLACE_TYPE_DETECTION_PROMPT}\n\nUser query: "${userQuery}"`;
      
      const response = await this.model.invoke([
        { role: 'user', content: prompt },
      ]);

      const content = response.content as string;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.place_types || [];
      }
    } catch (error) {
      console.error('Place type detection error:', error);
    }

    // Fallback: use category mapping
    if (category) {
      return mapUserCategoryToPlaceTypes(category);
    }

    // Default fallback
    return ['tourist_attraction', 'restaurant', 'park'];
  }

  /**
   * Build system prompt for intent detection
   */
  private buildSystemPrompt(): string {
    return `You are an expert travel assistant intent classifier. Your job is to analyze user queries about travel and determine:
1. What the user wants to do (primary intent)
2. What information they're asking about (entities)
3. Which tools should be called to help them (tools_to_call)

Available Tools:
- search_destinations: Search for cities, countries, or destinations
- search_attractions: Find tourist attractions, monuments, museums
- search_hotels: Find accommodation options
- search_flights: Search for flight options
- search_restaurants: Find dining options
- get_nearby_attractions: Find attractions near a location
- get_place_details: Get detailed info about a specific place
- calculate_distance: Calculate distance between two locations
- get_directions: Get routing/directions
- web_search: Search the web for travel information
- get_weather: Get weather forecast
- convert_currency: Convert between currencies
- estimate_budget: Estimate trip costs
- plan_trip: Create a full itinerary

Intent Categories:
- search_destination: User wants to explore a destination
- search_attractions: Looking for things to do/see
- search_hotels: Looking for places to stay
- search_flights: Looking for flight options
- search_restaurants: Looking for food/dining
- plan_trip: Wants a full itinerary
- get_details: Wants more info about specific place
- find_nearby: Looking for things near a location
- calculate_distance: Wants distance/travel time
- get_directions: Wants routing information
- web_search: General travel research
- get_weather: Weather information
- convert_currency: Currency conversion
- estimate_budget: Budget planning
- add_activity: User wants to add specific activity/place to itinerary
- remove_activity: User wants to remove activity from itinerary
- replace_activity: User wants to swap one activity with another
- modify_activity: User wants to change activity details (time, duration, etc.)
- move_activity: User wants to move activity to different day/time
- add_day: User wants to add another day to trip
- remove_day: User wants to remove a day from trip
- find_and_add: User wants AI to find places and add them (e.g., "add some museums")
- casual_chat: Just chatting, no specific intent
- unknown: Cannot determine intent

Respond with ONLY a valid JSON object matching this schema:
{
  "primary_intent": "intent_name",
  "entities": {
    "location": "place name if mentioned",
    "origin": "starting point if mentioned",
    "destination": "destination if mentioned",
    "dates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "duration": number_of_days,
    "budget": "budget|mid-range|luxury",
    "number_of_people": number,
    "preferences": ["preference1", "preference2"],
    "category": "type of attraction/activity",
    "query_terms": ["search", "terms"],
    "target_day": 1,
    "time_slot": "morning|afternoon|evening",
    "activity_name": "name of activity",
    "activity_id": "activity ID if known",
    "place_name": "specific place/venue name",
    "action_type": "add|remove|replace|modify|move"
  },
  "tools_to_call": ["tool1", "tool2"],
  "confidence": 0.0-1.0,
  "reasoning": "why this intent was chosen"
}`;
  }

  /**
   * Build user prompt
   */
  private buildUserPrompt(userQuery: string, conversationHistory?: string[]): string {
    let prompt = `Analyze this user query and determine the intent:\n\nQuery: "${userQuery}"`;

    if (conversationHistory && conversationHistory.length > 0) {
      prompt += `\n\nRecent conversation context:\n${conversationHistory.slice(-3).join('\n')}`;
    }

    prompt += '\n\nProvide your analysis as a JSON object.';
    return prompt;
  }

  /**
   * Fallback intent detection using simple keyword matching
   */
  private fallbackDetection(userQuery: string): DetectedIntent {
    const query = userQuery.toLowerCase();
    let intent: DetectedIntent['primary_intent'] = 'unknown';
    let tools: string[] = [];

    // Detect Google Places types based on keywords
    let placeTypes: string[] = [];

    // Check for modification intents first
    if ((query.includes('add') || query.includes('include')) && !query.includes('plan')) {
      intent = 'add_activity';
      tools = ['search_attractions', 'modify_itinerary'];
    } else if (query.includes('remove') || query.includes('delete') || query.includes('take out')) {
      intent = 'remove_activity';
      tools = ['modify_itinerary'];
    } else if (query.includes('replace') || query.includes('swap') || query.includes('change to')) {
      intent = 'replace_activity';
      tools = ['search_attractions', 'modify_itinerary'];
    } else if (query.includes('move') && (query.includes('day') || query.includes('time'))) {
      intent = 'move_activity';
      tools = ['modify_itinerary'];
    } else if (query.includes('modify') || query.includes('adjust') || query.includes('update')) {
      intent = 'modify_activity';
      tools = ['modify_itinerary'];
    } else if (query.includes('hotel') || query.includes('accommodation') || query.includes('stay')) {
      intent = 'search_hotels';
      tools = ['search_hotels'];
      placeTypes = ['hotel', 'lodging', 'resort_hotel'];
    } else if (query.includes('flight') || query.includes('fly')) {
      intent = 'search_flights';
      tools = ['search_flights'];
      placeTypes = ['airport'];
    } else if (query.includes('restaurant') || query.includes('food') || query.includes('eat')) {
      intent = 'search_restaurants';
      tools = ['search_restaurants', 'search_attractions'];
      placeTypes = ['restaurant', 'cafe', 'bar'];
    } else if (query.includes('plan') && query.includes('trip')) {
      intent = 'plan_trip';
      tools = ['search_destinations', 'search_attractions', 'search_hotels', 'search_restaurants'];
      placeTypes = ['tourist_attraction', 'restaurant', 'hotel', 'park'];
    } else if (query.includes('weather')) {
      intent = 'get_weather';
      tools = ['get_weather'];
    } else if (query.includes('distance') || query.includes('how far')) {
      intent = 'calculate_distance';
      tools = ['calculate_distance'];
    } else if (query.includes('nearby') || query.includes('near')) {
      intent = 'find_nearby';
      tools = ['get_nearby_attractions'];
    } else if (query.includes('museum')) {
      intent = 'search_attractions';
      tools = ['search_attractions'];
      placeTypes = ['museum', 'art_gallery', 'historical_landmark'];
    } else if (query.includes('beach')) {
      intent = 'search_attractions';
      tools = ['search_attractions'];
      placeTypes = ['beach'];
    } else if (query.includes('park')) {
      intent = 'search_attractions';
      tools = ['search_attractions'];
      placeTypes = ['park', 'national_park', 'botanical_garden'];
    } else if (query.includes('search') || query.includes('find') || query.includes('show')) {
      intent = 'search_attractions';
      tools = ['search_attractions', 'search_destinations'];
      placeTypes = ['tourist_attraction', 'museum', 'park'];
    } else {
      intent = 'casual_chat';
      tools = [];
    }

    return {
      primary_intent: intent,
      entities: {
        query_terms: userQuery.split(' ').filter(word => word.length > 3),
        google_place_types: placeTypes.length > 0 ? placeTypes : ['tourist_attraction'],
      },
      tools_to_call: tools,
      confidence: 0.6,
      reasoning: 'Fallback keyword-based detection with Google Places type mapping',
    };
  }
}

// Export singleton instance
export const intentDetector = new IntentDetector();
