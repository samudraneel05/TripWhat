import { StateGraph, Annotation } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';
import { itineraryBuilder } from '../services/itineraryBuilder.js';
import { intentDetector } from './intent-detector.js';
import { toolRegistry } from './tool-registry.js';
import { TRAVEL_AGENT_SYSTEM_PROMPT } from './prompts.js';
import { getPlaceTypeDisplayName } from '../config/google-places-types.js';
import { googlePlacesAPI } from '../services/googlePlacesAPI.js';
import type { AgentConfig } from './types.js';
import type { Destination } from '../mcp-servers/places/types.js';
import type { Itinerary } from '../types/itinerary.js';
import type { DetectedIntent } from './intent-detector.js';

/**
 * Define agent state using Annotation API
 */
const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  userQuery: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => '',
  }),
  intent: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  detectedIntent: Annotation<DetectedIntent | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  searchResults: Annotation<Destination[] | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  placeDetails: Annotation<any>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  nearbyAttractions: Annotation<Destination[] | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  itinerary: Annotation<Itinerary | null | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  response: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  error: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  conversationId: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  timestamp: Annotation<Date | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
});

type AgentState = typeof AgentStateAnnotation.State;

/**
 * Travel Planning Agent using LangGraph
 * 
 * Workflow:
 * 1. User Input → Planner (decides which tools to call)
 * 2. Tool Executor → Calls MCP server tools
 * 3. Response Formatter → Creates conversational response
 */
export class TravelAgent {
  private model: ChatOpenAI;
  private graph: any; // LangGraph compiled graph

  constructor(config: AgentConfig = {}) {
    // Initialize OpenAI model
    this.model = new ChatOpenAI({
      modelName: config.modelName || 'gpt-4o-mini',
      temperature: config.temperature || 0.7,
      maxTokens: config.maxTokens || 1000,
      streaming: config.streaming || false,
    });

    // Build the LangGraph workflow
    this.graph = this.buildGraph();
  }

  /**
   * Build the LangGraph state machine
   */
  private buildGraph() {
    // Define the graph with Annotation and use method chaining
    const workflow = new StateGraph(AgentStateAnnotation)
      .addNode('planner', this.plannerNode.bind(this))
      .addNode('tool_executor', this.toolExecutorNode.bind(this))
      .addNode('response_formatter', this.responseFormatterNode.bind(this))
      .addEdge('__start__', 'planner')
      .addConditionalEdges('planner', (state: AgentState) => {
        // Map new intent types to appropriate actions
        const intentsThatNeedTools = [
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
          'estimate_budget',
          // Legacy intents for backward compatibility
          'SEARCH_DESTINATION',
          'GET_DETAILS',
          'FIND_NEARBY',
          'PLAN_TRIP',
        ];
        
        if (intentsThatNeedTools.includes(state.intent || '')) {
          return 'tool_executor';
        }
        // Otherwise, go directly to response formatter for casual chat
        return 'response_formatter';
      })
      .addEdge('tool_executor', 'response_formatter')
      .addEdge('response_formatter', '__end__');

    return workflow.compile();
  }

  /**
   * Planner Node: Analyzes user query and decides which tools to use
   * Now uses LLM-based intent detection with category extraction
   */
  private async plannerNode(state: AgentState): Promise<Partial<AgentState>> {
    console.log('\n🧠 [PLANNER] Analyzing user query:', state.userQuery);
    try {
      // Use LLM-based intent detector with category extraction
      const detectedIntent = await intentDetector.detectIntent(state.userQuery);
      
      console.log('🎯 [PLANNER] Detected intent:', detectedIntent.primary_intent);
      console.log('🔧 [PLANNER] Tools to call:', detectedIntent.tools_to_call);
      console.log('🏷️  [PLANNER] Place Types:', detectedIntent.entities.google_place_types);
      console.log('📊 [PLANNER] Confidence:', detectedIntent.confidence);
      console.log('💭 [PLANNER] Reasoning:', detectedIntent.reasoning);

      // Store the detected intent and entities for tool execution
      const intentString = detectedIntent.primary_intent;

      return {
        intent: intentString,
        detectedIntent: detectedIntent, // Store full intent data
        searchResults: detectedIntent.entities.google_place_types as any, // Store place types temporarily
        messages: [new AIMessage(`Understood: ${detectedIntent.reasoning}`)],
      };
    } catch (error) {
      console.error('Planner node error:', error);
      return {
        error: 'Failed to analyze your request. Please try again.',
      };
    }
  }

  /**
   * Tool Executor Node: Calls appropriate MCP tools based on intent
   * Now uses detected categories from intent detection
   */
  private async toolExecutorNode(state: AgentState): Promise<Partial<AgentState>> {
    console.log('\n🔧 [TOOL EXECUTOR] Running tools for intent:', state.intent);
    try {
      const { intent, userQuery, detectedIntent } = state;
      
      // Extract detected place types (stored temporarily in searchResults by planner)
      const detectedPlaceTypes = (state.searchResults as any) || [];
      
      // Map intent to new naming convention if needed
      const normalizedIntent = intent?.toLowerCase().replace('_', '_') || 'unknown';

      switch (normalizedIntent) {
        case 'search_destination':
        case 'search_attractions': {
          // Extract destination from query
          const destination = this.extractDestination(userQuery);
          
          // Use detected place types
          const placeTypes = detectedPlaceTypes.length > 0 
            ? detectedPlaceTypes 
            : ['tourist_attraction', 'museum', 'park'];
          
          console.log(`🔍 [TOOL] Searching for ${placeTypes.join(', ')} in ${destination}`);
          
          // Use Google Places API to search
          const results = await googlePlacesAPI.searchPlacesByTypes(
            destination,
            placeTypes,
            10
          );
          
          console.log(`✅ [TOOL] Got ${results.length} results for place types: ${placeTypes.map(getPlaceTypeDisplayName).join(', ')}`);
          return { searchResults: results };
        }

        case 'search_restaurants': {
          const destination = this.extractDestination(userQuery);
          console.log(`🍽️ [TOOL] Searching for restaurants in ${destination}`);
          
          const result = await toolRegistry.executeTool('search_restaurants', {
            location: destination,
            limit: 10,
          });
          
          const restaurants = result.content?.[0]?.text ? 
            JSON.parse(result.content[0].text).restaurants : [];
          
          return { searchResults: restaurants };
        }

        case 'find_nearby': {
          // Use coordinates from context or defaults
          const result = await toolRegistry.executeTool('get_nearby_attractions', {
            latitude: 48.8584,
            longitude: 2.2945,
            radius: 5000,
            limit: 10,
          });
          
          const attractions = result.content?.[0]?.text ? 
            JSON.parse(result.content[0].text).attractions : [];
          
          return { nearbyAttractions: attractions };
        }

        case 'calculate_distance': {
          // Extract origin and destination
          const parts = userQuery.toLowerCase().split('to');
          const origin = parts[0]?.replace(/distance|from|between/gi, '').trim() || 'Paris';
          const destination = parts[1]?.trim() || 'London';
          
          console.log(`📏 [TOOL] Calculating distance from ${origin} to ${destination}`);
          
          const result = await toolRegistry.executeTool('calculate_distance', {
            origin,
            destination,
          });
          
          return { placeDetails: result };
        }

        case 'web_search': {
          console.log(`🌐 [TOOL] Web search for: ${userQuery}`);
          
          const result = await toolRegistry.executeTool('web_search', {
            query: userQuery,
            numResults: 5,
          });
          
          return { placeDetails: result };
        }

        case 'get_details': {
          if (state.searchResults && state.searchResults.length > 0) {
            const placeId = state.searchResults[0].id;
            console.log(`📄 Getting details for place: ${placeId}`);
            
            const result = await toolRegistry.executeTool('get_place_details', {
              placeId,
            });
            
            const details = result.content?.[0]?.text ? 
              JSON.parse(result.content[0].text) : null;
            
            return { placeDetails: details };
          }
          return { error: 'No place found to get details for.' };
        }

        case 'plan_trip': {
          const destination = this.extractDestination(userQuery);
          const duration = this.extractDuration(userQuery);
          
          console.log(`🗓️ [TOOL] Building ${duration}-day itinerary for ${destination}`);
          
          const itinerary = await itineraryBuilder.buildItinerary(destination, duration);
          
          if (itinerary) {
            console.log(`✅ [TOOL] Successfully built itinerary with ${itinerary.days.length} days`);
          }
          
          return { itinerary };
        }

        case 'add_activity':
        case 'remove_activity':
        case 'replace_activity':
        case 'move_activity':
        case 'find_and_add':
        case 'add_day':
        case 'remove_day':
        case 'modify_activity': {
          console.log(`🔧 [TOOL] Handling itinerary modification: ${intent}`);
          
          // For now, return a message indicating feature is being implemented
          // We'll handle this in the route where we have access to the current itinerary
          if (detectedIntent) {
            return { 
              response: await this.handleItineraryModificationIntent(detectedIntent, userQuery)
            };
          }
          return { error: 'Could not detect intent for modification' };
        }

        default:
          console.log('ℹ️  [TOOL] No specific tools needed for this intent');
          return {};
      }
    } catch (error) {
      console.error('Tool executor error:', error);
      return {
        error: 'Failed to fetch travel information. Please try again.',
      };
    }
  }

  /**
   * Response Formatter Node: Creates conversational response from tool results
   * Uses LLM to generate natural, tailored responses based on user query and data
   */
  private async responseFormatterNode(state: AgentState): Promise<Partial<AgentState>> {
    console.log('\n✍️  [FORMATTER] Generating response...');
    try {
      const { searchResults, nearbyAttractions, placeDetails, itinerary, error, userQuery } = state;

      // Handle errors
      if (error) {
        return { response: `I apologize, but ${error}` };
      }

      // Format response using LLM for natural conversation
      let formattedResponse = '';

      if (itinerary) {
        // For itineraries, use structured format (already detailed enough)
        formattedResponse = this.formatItinerary(itinerary);
      } else if (searchResults && searchResults.length > 0) {
        // Use LLM to create personalized response from search results
        formattedResponse = await this.formatSearchResultsWithLLM(userQuery, searchResults);
      } else if (nearbyAttractions && nearbyAttractions.length > 0) {
        formattedResponse = await this.formatNearbyWithLLM(userQuery, nearbyAttractions);
      } else if (placeDetails) {
        formattedResponse = await this.formatDetailsWithLLM(userQuery, placeDetails);
      } else {
        // No tool results, use LLM to generate conversational response
        const messages = [
          new SystemMessage(TRAVEL_AGENT_SYSTEM_PROMPT),
          new HumanMessage(userQuery),
        ];
        console.log('🤖 [FORMATTER] Calling GPT-4o-mini for conversational response...');
        const response = await this.model.invoke(messages);
        formattedResponse = response.content as string;
      }

      console.log('✅ [FORMATTER] Response generated successfully\n');
      return { response: formattedResponse };
    } catch (error) {
      console.error('Response formatter error:', error);
      return {
        response: 'I had trouble formatting the response. Please try asking again.',
      };
    }
  }

  /**
   * Format search results using LLM for natural, personalized response
   */
  private async formatSearchResultsWithLLM(userQuery: string, results: any[]): Promise<string> {
    try {
      // Prepare structured data for LLM
      const placesData = results.slice(0, 5).map((place, index) => ({
        rank: index + 1,
        name: place.name || 'Unknown Place',
        address: place.address || 'Address not available',
        location: place.location ? `${place.location.latitude.toFixed(4)}, ${place.location.longitude.toFixed(4)}` : 'Location not available',
        categories: place.category?.slice(0, 3).join(', ') || 'Not categorized',
        rating: place.rating ? `${place.rating}/5` : 'No rating',
        priceLevel: place.priceLevel || 'Price not available',
      }));

      const systemPrompt = `You are a friendly, knowledgeable travel assistant. 

The user asked: "${userQuery}"

Here are the places I found (in JSON format):
${JSON.stringify(placesData, null, 2)}

Your task:
1. Create a warm, conversational response that directly addresses the user's query
2. Highlight the TOP 3-4 most relevant places based on the query
3. Include key details: name, what makes it special, rating, location
4. Use a friendly, enthusiastic tone
5. End with a helpful follow-up question or suggestion
6. Keep it concise (2-3 short paragraphs max)
7. Use emojis sparingly for visual appeal

Format your response in a natural, flowing way - NOT as a numbered list unless it makes sense contextually.`;

      console.log('🤖 [FORMATTER] Using LLM to personalize search results...');
      
      const response = await this.model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage('Create a personalized response based on the data provided.'),
      ]);

      return response.content as string;
    } catch (error) {
      console.error('LLM formatting error:', error);
      // Fallback to basic formatting
      return this.formatSearchResults(results);
    }
  }

  /**
   * Format nearby attractions using LLM
   */
  private async formatNearbyWithLLM(userQuery: string, attractions: any[]): Promise<string> {
    try {
      const placesData = attractions.slice(0, 5).map((place, index) => ({
        rank: index + 1,
        name: place.name,
        distance: place.distance ? `${place.distance}m` : 'nearby',
        categories: place.category?.join(', ') || 'attraction',
      }));

      const systemPrompt = `You are a helpful travel assistant. The user asked: "${userQuery}"

Here are nearby places:
${JSON.stringify(placesData, null, 2)}

Create a brief, friendly response highlighting the best nearby options. Mention distances and what makes them interesting.`;

      const response = await this.model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage('Format this into a natural response.'),
      ]);

      return response.content as string;
    } catch (error) {
      console.error('LLM formatting error:', error);
      return this.formatNearbyAttractions(attractions);
    }
  }

  /**
   * Format place details using LLM
   */
  private async formatDetailsWithLLM(userQuery: string, details: any): Promise<string> {
    try {
      const systemPrompt = `You are a travel expert. The user asked: "${userQuery}"

Place details:
${JSON.stringify(details, null, 2)}

Provide a compelling, informative description of this place. Include its highlights, what visitors love about it, and any practical information.`;

      const response = await this.model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage('Create an engaging description.'),
      ]);

      return response.content as string;
    } catch (error) {
      console.error('LLM formatting error:', error);
      return this.formatPlaceDetails(details);
    }
  }

  /**
   * Helper: Extract destination name from user query
   */
  private extractDestination(query: string): string {
    const words = query.split(' ');
    
    // Pattern 1: "attractions in Paris", "things to do in Tokyo"
    const inIndex = words.findIndex(w => w.toLowerCase() === 'in');
    if (inIndex !== -1 && words[inIndex + 1]) {
      return words[inIndex + 1].replace(/[^a-zA-Z]/gi, '');
    }
    
    // Pattern 2: "visit Paris", "go to Barcelona"  
    const prepositions = ['to', 'at', 'near', 'around', 'visit'];
    for (let i = 0; i < words.length; i++) {
      if (prepositions.includes(words[i].toLowerCase()) && words[i + 1]) {
        const nextWord = words[i + 1].toLowerCase();
        // Skip common words like "do", "see", "the"
        if (!['do', 'see', 'the', 'a', 'an', 'some'].includes(nextWord)) {
          return words[i + 1].replace(/[^a-zA-Z]/gi, '');
        }
      }
    }
    
    // Pattern 3: Look for capitalized words (likely place names)
    const capitalized = query.match(/\b[A-Z][a-z]+\b/g);
    if (capitalized && capitalized.length > 0) {
      return capitalized[capitalized.length - 1];
    }
    
    // Fallback: return last word
    return words[words.length - 1].replace(/[^a-zA-Z]/gi, '');
  }

  /**
   * Helper: Extract trip duration from user query
   */
  private extractDuration(query: string): number {
    const lowerQuery = query.toLowerCase();
    
    // Pattern 1: "3-day", "5 day", "7 days"
    const dayMatch = query.match(/(\d+)[-\s]?days?/i);
    if (dayMatch) {
      return parseInt(dayMatch[1]);
    }
    
    // Pattern 2: "three day", "five days" (word numbers)
    const wordNumbers: Record<string, number> = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
      'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
    };
    
    for (const [word, num] of Object.entries(wordNumbers)) {
      if (lowerQuery.includes(`${word} day`)) {
        return num;
      }
    }
    
    // Pattern 3: "weekend" = 2-3 days
    if (lowerQuery.includes('weekend')) {
      return 3;
    }
    
    // Pattern 4: "week" = 7 days
    if (lowerQuery.includes('week')) {
      return 7;
    }
    
    // Default: 3 days
    return 3;
  }

  /**
   * Helper: Format search results into readable text
   */
  private formatSearchResults(results: any[]): string {
    const count = results.length;
    let response = `I found ${count} amazing places! Here are the highlights:\n\n`;
    
    results.slice(0, 5).forEach((place, index) => {
      response += `${index + 1}. **${place.name || 'Unknown Place'}**\n`;
      
      if (place.location && place.location.latitude && place.location.longitude) {
        response += `   📍 Location: ${place.location.latitude.toFixed(4)}, ${place.location.longitude.toFixed(4)}\n`;
      }
      
      if (place.address) {
        response += `   📍 ${place.address}\n`;
      }
      
      if (place.category && place.category.length > 0) {
        response += `   🏷️  Categories: ${place.category.slice(0, 3).join(', ')}\n`;
      }
      
      if (place.rating) {
        response += `   ⭐ Rating: ${place.rating}/5\n`;
      }
      
      response += '\n';
    });

    response += '\nWould you like more details about any of these places? Just let me know! 🗺️';
    return response;
  }

  /**
   * Helper: Format nearby attractions
   */
  private formatNearbyAttractions(attractions: any[]): string {
    let response = `Here's what I found nearby:\n\n`;

    attractions.slice(0, 5).forEach((place, index) => {
      response += `${index + 1}. **${place.name}**\n`;
      
      if (place.distance) {
        response += `   📏 Distance: ${place.distance}m\n`;
      }
      
      if (place.category && place.category.length > 0) {
        response += `   🏷️  ${place.category.slice(0, 2).join(', ')}\n`;
      }
      
      response += '\n';
    });

    response += '\nThese are all within walking distance! Want to add any to your itinerary? ✨';
    return response;
  }

  /**
   * Helper: Format place details
   */
  private formatPlaceDetails(details: any): string {
    let response = `# ${details.name}\n\n`;
    
    if (details.description) {
      response += `${details.description}\n\n`;
    }
    
    if (details.rating) {
      response += `⭐ **Rating**: ${details.rating}/7\n`;
    }
    
    if (details.category && details.category.length > 0) {
      response += `🏷️  **Categories**: ${details.category.join(', ')}\n`;
    }
    
    if (details.image) {
      response += `\n🖼️ [View Image](${details.image})\n`;
    }
    
    response += '\nWould you like more details about any of these places? ✨';
    return response;
  }

  /**
   * Helper: Format itinerary into readable text
   */
  private formatItinerary(itinerary: Itinerary): string {
    const { tripMetadata, days } = itinerary;
    
    let response = `# 🗺️ ${tripMetadata.duration}-Day ${tripMetadata.destination} Itinerary\n\n`;
    response += `I've created a detailed ${tripMetadata.duration}-day itinerary for your trip to ${tripMetadata.destination}! Here's your personalized plan:\n\n`;
    response += `---\n\n`;

    days.forEach((day) => {
      response += `## 📅 Day ${day.dayNumber}: ${day.title}\n\n`;

      day.timeSlots.forEach((slot) => {
        if (slot.activities.length === 0) return;

        const emoji = slot.period === 'morning' ? '☀️' : slot.period === 'afternoon' ? '🌆' : '🌙';
        response += `### ${emoji} ${slot.period.charAt(0).toUpperCase() + slot.period.slice(1)} (${slot.startTime}-${slot.endTime})\n\n`;

        slot.activities.forEach((activity, idx) => {
          response += `**${idx + 1}. ${activity.name}**\n`;
          response += `   ⏱️  Duration: ${activity.duration}\n`;
          
          if (activity.estimatedCost) {
            response += `   💰 Cost: ${activity.estimatedCost}\n`;
          }
          
          if (activity.category) {
            response += `   🏷️  Type: ${activity.category}\n`;
          }
          
          if (activity.description) {
            response += `   📝 ${activity.description.substring(0, 100)}${activity.description.length > 100 ? '...' : ''}\n`;
          }
          
          response += `\n`;
        });
      });

      response += `---\n\n`;
    });

    response += `\n✨ This itinerary includes ${days.reduce((sum, day) => sum + day.timeSlots.reduce((s, slot) => s + slot.activities.length, 0), 0)} activities across ${days.length} days!\n\n`;
    response += `Would you like me to:\n`;
    response += `- Adjust the schedule\n`;
    response += `- Add more activities\n`;
    response += `- Find accommodations\n`;
    response += `- Get transportation details\n`;

    return response;
  }

  /**
   * Main method: Process user query and return response
   */
  async chat(userQuery: string, conversationId?: string): Promise<any> {
    try {
      console.log(`\n🤖 Processing: "${userQuery}"\n`);

      const initialState: AgentState = {
        messages: [],
        userQuery,
        conversationId,
        timestamp: new Date(),
        intent: undefined,
        detectedIntent: undefined,
        searchResults: undefined,
        nearbyAttractions: undefined,
        placeDetails: undefined,
        itinerary: undefined,
        response: undefined,
        error: undefined,
      };

      // Run the graph
      const result = await this.graph.invoke(initialState);

      return {
        response: result.response || 'I apologize, but I had trouble processing your request.',
        itinerary: result.itinerary,
        error: result.error
      };
    } catch (error) {
      console.error('Chat error:', error);
      return {
        response: 'I encountered an error. Please try again.',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Generate itinerary with structured trip context
   * NEW: Uses OpenAI web search + Google Places API
   */
  async generateItineraryWithContext(tripContext: any): Promise<any> {
    try {
      console.log('\n🎯 [ENHANCED ITINERARY] Generating with OpenAI web search + Google Places API');
      
      const { TRAVEL_TYPE_PREFERENCES, calculateDailyBudget } = await import('../types/tripContext.js');
      const { enhancedItineraryBuilder } = await import('../services/enhancedItineraryBuilder.js');
      const { flightService } = await import('../services/flightService.js');
      
      // Calculate total days from cities
      const totalDays = tripContext.cities.reduce((sum: number, city: any) => sum + city.days, 0);
      
      // Get daily budget breakdown
      const dailyBudget = calculateDailyBudget(
        tripContext.budget,
        tripContext.budgetMode,
        totalDays
      );
      
      // Get travel type preferences
      const travelPrefs = TRAVEL_TYPE_PREFERENCES[tripContext.travelType as keyof typeof TRAVEL_TYPE_PREFERENCES];
      
      console.log('💰 Daily budget:', dailyBudget);
      console.log('🎨 Travel preferences:', travelPrefs);
      console.log('🗓️ Total days:', totalDays);
      console.log('🏙️ Cities:', tripContext.cities.map((c: any) => `${c.name} (${c.days} days)`));
      
      // Get IATA codes for all cities
      console.log('\n✈️ [FLIGHTS] Looking up IATA codes for cities...');
      const cityIATACodes = new Map<string, string>();
      for (const city of tripContext.cities) {
        try {
          const iataCode = await flightService.getCityIATACode(city.name);
          if (iataCode) {
            cityIATACodes.set(city.name, iataCode);
            console.log(`   ✅ ${city.name} → ${iataCode}`);
          } else {
            console.log(`   ⚠️  ${city.name} → No IATA code found`);
          }
        } catch (error) {
          console.log(`   ❌ ${city.name} → IATA lookup failed`);
        }
      }
      
      // Build itineraries for each city using enhanced builder
      const allDays: any[] = [];
      let currentDayNumber = 0; // Start at 0 for departure day
      
      // Add departure flight if origin city is specified and first destination has IATA
      if (tripContext.origin && tripContext.cities.length > 0) {
        const firstCity = tripContext.cities[0];
        const destIATA = cityIATACodes.get(firstCity.name);
        
        if (destIATA) {
          try {
            console.log(`\n✈️ [FLIGHTS] Searching departure flight: ${tripContext.origin} → ${firstCity.name}`);
            
            // Get origin IATA
            const originIATA = await flightService.getCityIATACode(tripContext.origin);
            
            if (originIATA) {
              const departureDate = new Date(tripContext.startDate);
              const departureFlight = await flightService.getBestFlight({
                origin: originIATA,
                destination: destIATA,
                departureDate: departureDate.toISOString().split('T')[0],
                adults: tripContext.people || 1,
              });
              
              if (departureFlight) {
                console.log(`   ✅ Found departure flight: $${departureFlight.price.amount} ${departureFlight.price.currency}`);
                console.log(`      Duration: ${flightService.formatDuration(departureFlight.duration)}`);
                console.log(`      Carrier: ${departureFlight.provider}`);
                
                // Add departure day (Day 0)
                allDays.push({
                  dayNumber: 0,
                  title: 'Departure Day',
                  city: tripContext.origin,
                  date: departureDate.toISOString().split('T')[0],
                  travel: departureFlight,
                  timeSlots: [{
                    label: 'travel',
                    activities: [{
                      ...departureFlight,
                      name: `Flight to ${firstCity.name}`,
                    }]
                  }]
                });
              } else {
                console.log(`   ⚠️  No flights found for departure`);
              }
            }
          } catch (error) {
            console.error(`   ❌ Error searching departure flight:`, error);
          }
        }
      }
      
      currentDayNumber = 1;
      
      for (let i = 0; i < tripContext.cities.length; i++) {
        const city = tripContext.cities[i];
        console.log(`\n🌐 [WEB SEARCH] Processing ${city.name} (${city.days} days)`);
        
        // Use enhanced builder with web search + Google Places
        const cityItinerary = await enhancedItineraryBuilder.buildItineraryWithWebSearch(
          city.name,
          city.days,
          {
            travelType: tripContext.travelType,
            preferences: travelPrefs.categories,
            dailyBudget: dailyBudget.activities,
            activityLevel: travelPrefs.activityLevel,
            pacing: travelPrefs.pacing,
            numberOfPeople: tripContext.people
          }
        );
        
        if (cityItinerary && cityItinerary.days) {
          // Add city-specific days to all days
          cityItinerary.days.forEach((day: any) => {
            day.dayNumber = currentDayNumber++;
            day.city = city.name;
            allDays.push(day);
          });
          
          console.log(`✅ Generated ${cityItinerary.days.length} days for ${city.name}`);
          
          // Check if there's a next city for inter-city travel
          if (i < tripContext.cities.length - 1) {
            const nextCity = tripContext.cities[i + 1];
            const currentIATA = cityIATACodes.get(city.name);
            const nextIATA = cityIATACodes.get(nextCity.name);
            
            if (currentIATA && nextIATA) {
              try {
                console.log(`\n✈️ [FLIGHTS] Searching inter-city transport: ${city.name} → ${nextCity.name}`);
                
                const travelDate = new Date(tripContext.startDate);
                travelDate.setDate(travelDate.getDate() + currentDayNumber);
                
                const interCityFlight = await flightService.getBestFlight({
                  origin: currentIATA,
                  destination: nextIATA,
                  departureDate: travelDate.toISOString().split('T')[0],
                  adults: tripContext.people || 1,
                });
                
                if (interCityFlight) {
                  console.log(`   ✅ Found inter-city flight: $${interCityFlight.price.amount} ${interCityFlight.price.currency}`);
                  console.log(`      Duration: ${flightService.formatDuration(interCityFlight.duration)}`);
                  
                  // Add travel day
                  allDays.push({
                    dayNumber: currentDayNumber++,
                    title: `Travel Day: ${city.name} → ${nextCity.name}`,
                    city: city.name,
                    date: travelDate.toISOString().split('T')[0],
                    travel: interCityFlight,
                    timeSlots: [{
                      label: 'travel',
                      activities: [{
                        ...interCityFlight,
                        name: `Flight to ${nextCity.name}`,
                      }]
                    }]
                  });
                } else {
                  console.log(`   ⚠️  No flights found for ${city.name} → ${nextCity.name}`);
                }
              } catch (error) {
                console.error(`   ❌ Error searching inter-city flight:`, error);
              }
            }
          }
        } else {
          console.error(`❌ Failed to generate itinerary for ${city.name}`);
        }
      }
      
      // Add return flight
      if (tripContext.origin && tripContext.cities.length > 0) {
        const lastCity = tripContext.cities[tripContext.cities.length - 1];
        const lastIATA = cityIATACodes.get(lastCity.name);
        
        if (lastIATA) {
          try {
            console.log(`\n✈️ [FLIGHTS] Searching return flight: ${lastCity.name} → ${tripContext.origin}`);
            
            const originIATA = await flightService.getCityIATACode(tripContext.origin);
            
            if (originIATA) {
              const returnDate = new Date(tripContext.startDate);
              returnDate.setDate(returnDate.getDate() + totalDays);
              
              const returnFlight = await flightService.getBestFlight({
                origin: lastIATA,
                destination: originIATA,
                departureDate: returnDate.toISOString().split('T')[0],
                adults: tripContext.people || 1,
              });
              
              if (returnFlight) {
                console.log(`   ✅ Found return flight: $${returnFlight.price.amount} ${returnFlight.price.currency}`);
                console.log(`      Duration: ${flightService.formatDuration(returnFlight.duration)}`);
                
                // Add return day
                allDays.push({
                  dayNumber: currentDayNumber++,
                  title: 'Return Day',
                  city: lastCity.name,
                  date: returnDate.toISOString().split('T')[0],
                  travel: returnFlight,
                  timeSlots: [{
                    label: 'travel',
                    activities: [{
                      ...returnFlight,
                      name: `Flight to ${tripContext.origin}`,
                    }]
                  }]
                });
              } else {
                console.log(`   ⚠️  No return flights found`);
              }
            }
          } catch (error) {
            console.error(`   ❌ Error searching return flight:`, error);
          }
        }
      }
      
      if (allDays.length === 0) {
        return {
          response: null,
          itinerary: null,
          error: 'Failed to generate itinerary for any city'
        };
      }
      
      // Create complete itinerary
      const completeItinerary = {
        tripMetadata: {
          destination: tripContext.cities.map((c: any) => c.name).join(' → '),
          duration: totalDays,
          startDate: tripContext.startDate,
          travelType: tripContext.travelType,
          numberOfPeople: tripContext.people,
          budget: {
            total: tripContext.budget.total,
            perDay: dailyBudget.totalPerDay,
            breakdown: dailyBudget
          }
        },
        days: allDays
      };
      
      // Format the response
      const formattedResponse = this.formatItineraryWithContext(completeItinerary, tripContext);
      
      console.log(`\n✅ [ENHANCED ITINERARY] Successfully generated ${allDays.length}-day itinerary`);
      console.log(`📊 Total activities: ${allDays.reduce((sum, day) => 
        sum + day.timeSlots.reduce((s: number, slot: any) => s + slot.activities.length, 0), 0)}`);
      
      return {
        response: formattedResponse,
        itinerary: completeItinerary,
        error: null
      };
    } catch (error) {
      console.error('❌ [ENHANCED ITINERARY] Error:', error);
      return {
        response: null,
        itinerary: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * OLD METHOD - Keep as fallback
   */
  async generateItineraryWithContext_OLD(tripContext: any): Promise<any> {
    try {
      console.log('\n🎯 [CONTEXT ITINERARY] Generating with full trip context');
      
      const { TRAVEL_TYPE_PREFERENCES, calculateDailyBudget } = await import('../types/tripContext.js');
      
      // Calculate total days from cities
      const totalDays = tripContext.cities.reduce((sum: number, city: any) => sum + city.days, 0);
      
      // Get daily budget breakdown
      const dailyBudget = calculateDailyBudget(
        tripContext.budget,
        tripContext.budgetMode,
        totalDays
      );
      
      // Get travel type preferences
      const travelPrefs = TRAVEL_TYPE_PREFERENCES[tripContext.travelType as keyof typeof TRAVEL_TYPE_PREFERENCES];
      
      console.log('💰 Daily budget:', dailyBudget);
      console.log('🎨 Travel preferences:', travelPrefs);
      console.log('🗓️ Total days:', totalDays);
      console.log('🏙️ Cities:', tripContext.cities.map((c: any) => `${c.name} (${c.days} days)`));
      
      // Collect all places from all cities first for better distribution
      const allCityPlaces: Map<string, any> = new Map();
      
      for (const city of tripContext.cities) {
        console.log(`\n🔍 Fetching enhanced places for ${city.name}`);
        
        // Get city coordinates
        const coords = await itineraryBuilder.getDestinationCoords(city.name);
        if (coords) {
          // Fetch enhanced places including hotels and trip-type specific activities
          const cityPlaces = await itineraryBuilder.fetchEnhancedPlaces(
            coords.lat,
            coords.lon,
            travelPrefs.categories,
            tripContext.travelType,
            true // Include hotels
          );
          
          allCityPlaces.set(city.name, {
            places: cityPlaces,
            coords: coords,
            days: city.days
          });
          
          console.log(`✅ Found ${cityPlaces.total} enhanced places in ${city.name} (${cityPlaces.activities.length} activities, ${cityPlaces.restaurants.length} restaurants, ${cityPlaces.hotels.length} hotels)`);
        }
      }
      
      // Build itinerary with intelligent distribution
      const allDays: any[] = [];
      let currentDayNumber = 1;
      
      // Global tracking to prevent repetition across all days
      const globalUsedPlaces = new Set<string>();
      
      for (const city of tripContext.cities) {
        const cityData = allCityPlaces.get(city.name);
        if (!cityData) continue;
        
        console.log(`\n�️ Building ${city.days} days for ${city.name}`);
        
        // Build city-specific itinerary with global state tracking
        const cityItinerary = await itineraryBuilder.buildItineraryWithContextAndState(
          city.name,
          city.days,
          {
            dailyBudget: dailyBudget.activities,
            preferredCategories: travelPrefs.categories,
            activityLevel: travelPrefs.activityLevel,
            pacing: travelPrefs.pacing,
            numberOfPeople: tripContext.people,
            places: cityData.places,
            coords: cityData.coords,
            globalUsedPlaces: globalUsedPlaces, // Pass global state
            startingDayNumber: currentDayNumber
          }
        );
        
        if (cityItinerary && cityItinerary.days) {
          // Add city-specific days to all days
          cityItinerary.days.forEach((day: any) => {
            day.city = city.name;
            allDays.push(day);
          });
          
          currentDayNumber += city.days;
        }
      }
      
      // Create complete itinerary
      const completeItinerary = {
        tripMetadata: {
          destination: tripContext.cities.map((c: any) => c.name).join(' → '),
          duration: totalDays,
          startDate: tripContext.startDate,
          travelType: tripContext.travelType,
          numberOfPeople: tripContext.people,
          budget: {
            total: tripContext.budget.total,
            perDay: dailyBudget.totalPerDay,
            breakdown: dailyBudget
          }
        },
        days: allDays
      };
      
      // Format the response
      const formattedResponse = this.formatItineraryWithContext(completeItinerary, tripContext);
      
      console.log(`✅ [CONTEXT ITINERARY] Successfully generated ${allDays.length}-day itinerary`);
      console.log(`📊 Total activities: ${allDays.reduce((sum, day) => 
        sum + day.timeSlots.reduce((s: number, slot: any) => s + slot.activities.length, 0), 0)}`);
      
      return {
        response: formattedResponse,
        itinerary: completeItinerary,
        error: null
      };
      
    } catch (error) {
      console.error('❌ Error generating context itinerary:', error);
      return {
        response: null,
        itinerary: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Format itinerary with trip context metadata
   */
  private formatItineraryWithContext(itinerary: any, tripContext: any): string {
    const { tripMetadata, days } = itinerary;
    const cityNames = tripContext.cities.map((c: any) => c.name).join(' → ');
    
    let response = `# 🗺️ Your ${tripMetadata.duration}-Day ${cityNames} Adventure\n\n`;
    response += `I've crafted a personalized **${tripContext.travelType}** itinerary for ${tripContext.people} ${tripContext.people === 1 ? 'traveler' : 'travelers'}!\n\n`;
    
    // Budget summary
    response += `## 💰 Budget Overview\n`;
    response += `- **Total Budget**: $${tripMetadata.budget.total.toLocaleString()}\n`;
    response += `- **Per Day**: $${Math.round(tripMetadata.budget.perDay).toLocaleString()}\n`;
    response += `- **Activities/Day**: $${Math.round(tripMetadata.budget.breakdown.activities).toLocaleString()}\n\n`;
    
    response += `---\n\n`;

    // Group days by city for multi-city trips
    const daysByCity = days.reduce((acc: any, day: any) => {
      const city = day.city || tripContext.cities[0].name;
      if (!acc[city]) acc[city] = [];
      acc[city].push(day);
      return acc;
    }, {});

    Object.entries(daysByCity).forEach(([city, cityDays]: [string, any]) => {
      if (Object.keys(daysByCity).length > 1) {
        response += `# 🏙️ ${city}\n\n`;
      }
      
      (cityDays as any[]).forEach((day) => {
        response += `## 📅 Day ${day.dayNumber}: ${day.title}\n\n`;

        day.timeSlots.forEach((slot: any) => {
          if (slot.activities.length === 0) return;

          // Handle travel/flight slots differently
          if (slot.label === 'travel') {
            response += `### ✈️ Travel\n\n`;
          } else {
            const period = slot.period || slot.timeOfDay || 'Activity';
            const emoji = period === 'morning' ? '☀️' : period === 'afternoon' ? '🌆' : '🌙';
            const periodLabel = period.charAt(0).toUpperCase() + period.slice(1);
            const timeRange = slot.startTime && slot.endTime ? ` (${slot.startTime}-${slot.endTime})` : '';
            response += `### ${emoji} ${periodLabel}${timeRange}\n\n`;
          }

          slot.activities.forEach((activity: any, idx: number) => {
            response += `**${idx + 1}. ${activity.name}**\n`;
            response += `   ⏱️  Duration: ${activity.duration}\n`;
            
            if (activity.estimatedCost) {
              response += `   💰 Cost: ${activity.estimatedCost}\n`;
            }
            
            if (activity.category) {
              response += `   🏷️  Type: ${activity.category}\n`;
            }
            
            if (activity.description) {
              response += `   📝 ${activity.description.substring(0, 100)}${activity.description.length > 100 ? '...' : ''}\n`;
            }
            
            response += `\n`;
          });
        });

        response += `---\n\n`;
      });
    });

    const totalActivities = days.reduce((sum: number, day: any) => 
      sum + day.timeSlots.reduce((s: number, slot: any) => s + slot.activities.length, 0), 0
    );
    
    response += `\n✨ Your itinerary includes **${totalActivities} activities** across **${days.length} days**!\n\n`;
    response += `🎯 Optimized for: **${tripContext.travelType} travel**\n`;
    response += `👥 Perfect for: **${tripContext.people} ${tripContext.people === 1 ? 'person' : 'people'}**\n\n`;

    return response;
  }

  /**
   * Handle itinerary modification intents
   */
  private async handleItineraryModificationIntent(
    intentData: DetectedIntent,
    userQuery: string
  ): Promise<string> {
    const intent = intentData.primary_intent;
    const entities = intentData.entities;

    // Build a helpful response based on the intent
    switch (intent) {
      case 'add_activity':
        if (entities.place_name) {
          return `I can help you add ${entities.place_name} to your itinerary! To do this, I'll need to know:\n\n` +
                 `1. Which day would you like to add it to?\n` +
                 `2. What time of day? (morning, afternoon, or evening)\n\n` +
                 `For example, you could say: "Add ${entities.place_name} to Day 2 morning"`;
        }
        return `I can help you add activities to your itinerary! Please specify:\n\n` +
               `1. What would you like to add?\n` +
               `2. Which day?\n` +
               `3. What time? (morning, afternoon, or evening)\n\n` +
               `For example: "Add the Eiffel Tower to Day 2 morning"`;

      case 'remove_activity':
        if (entities.activity_name) {
          return `I can remove ${entities.activity_name} from your itinerary. ` +
                 `${entities.target_day ? `From Day ${entities.target_day}?` : 'Which day is it on?'}`;
        }
        return `I can help you remove activities! Please tell me:\n\n` +
               `1. Which activity to remove?\n` +
               `2. Which day is it on?\n\n` +
               `For example: "Remove the museum visit from Day 1"`;

      case 'replace_activity':
        return `I can help you replace activities! Please tell me:\n\n` +
               `1. What activity do you want to replace?\n` +
               `2. Which day is it on?\n` +
               `3. What should I replace it with?\n\n` +
               `For example: "Replace the shopping on Day 2 with a museum visit"`;

      case 'move_activity':
        return `I can move activities between days! Please tell me:\n\n` +
               `1. Which activity to move?\n` +
               `2. From which day?\n` +
               `3. To which day and time?\n\n` +
               `For example: "Move the Louvre from Day 1 to Day 2 afternoon"`;

      case 'find_and_add':
        if (entities.preferences && entities.preferences.length > 0) {
          return `Great! I can find ${entities.preferences.join(' and ')} activities for you. ` +
                 `${entities.target_day ? `I'll add them to Day ${entities.target_day}. ` : 'Which day would you like these on? '}` +
                 `Let me search for the best options!`;
        }
        return `I can find and add activities based on your interests! What are you interested in?\n\n` +
               `For example: "I love art, add some museums to Day 3"`;

      case 'add_day':
        return `I can add another day to your trip! This will create a new day with morning, afternoon, and evening time slots. ` +
               `Would you like me to go ahead and add Day ${entities.duration ? entities.duration + 1 : 'X + 1'}?`;

      case 'remove_day':
        if (entities.target_day) {
          return `I can remove Day ${entities.target_day} from your itinerary. ` +
                 `⚠️ This will delete all activities planned for that day. Are you sure?`;
        }
        return `Which day would you like to remove from your itinerary?`;

      case 'modify_activity':
        return `I can modify activity details like time or duration. What would you like to change?\n\n` +
               `For example: "Move the museum visit to the afternoon" or "Extend the park time to 2 hours"`;

      default:
        return `I can help you modify your itinerary! You can:\n\n` +
               `• Add activities: "Add the Eiffel Tower to Day 2"\n` +
               `• Remove activities: "Remove shopping from Day 1"\n` +
               `• Find & add: "I love art, add museums to Day 3"\n` +
               `• Move activities: "Move Louvre to Day 2"\n` +
               `• Add/remove days: "Add another day to my trip"\n\n` +
               `What would you like to do?`;
    }
  }
}

// Lazy singleton instance - only created when first accessed
let _travelAgentInstance: TravelAgent | null = null;

export function getTravelAgent(): TravelAgent {
  if (!_travelAgentInstance) {
    _travelAgentInstance = new TravelAgent({
      modelName: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.7,
    });
  }
  return _travelAgentInstance;
}

// For backward compatibility
export const travelAgent = new Proxy({} as TravelAgent, {
  get(target, prop) {
    return getTravelAgent()[prop as keyof TravelAgent];
  },
});
