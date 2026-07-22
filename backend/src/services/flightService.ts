import axios from 'axios';
import crypto from 'crypto';
import FlightCache from '../models/FlightCache';

interface FlightSearchParams {
  origin: string; // IATA code
  destination: string; // IATA code
  departureDate: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD
  adults: number;
  children?: number;
  travelClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
  nonStop?: boolean;
  maxResults?: number;
}

interface FlightOffer {
  id: string;
  price: {
    total: string;
    currency: string;
    base: string;
    grandTotal: string;
  };
  itineraries: Array<{
    duration: string;
    segments: Array<{
      departure: {
        iataCode: string;
        at: string; // ISO datetime
      };
      arrival: {
        iataCode: string;
        at: string;
      };
      carrierCode: string;
      number: string;
      aircraft: {
        code: string;
      };
      duration: string;
    }>;
  }>;
  numberOfBookableSeats: number;
  validatingAirlineCodes: string[];
}

interface TransportResult {
  type: 'flight' | 'train' | 'bus' | 'car';
  from: string;
  to: string;
  departure: string;
  arrival: string;
  duration: string;
  price: {
    amount: string;
    currency: string;
  };
  provider: string;
  bookingLink: string;
  details?: any;
}

export class FlightService {
  private apiKey: string;
  private apiSecret: string;
  private baseURL: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.apiKey = process.env.AMADEUS_API_KEY || '';
    this.apiSecret = process.env.AMADEUS_API_SECRET || '';
    this.baseURL = process.env.AMADEUS_API_ENV === 'production' 
      ? 'https://api.amadeus.com'
      : 'https://test.api.amadeus.com';

    if (!this.apiKey || !this.apiSecret) {
      console.warn('⚠️ [FLIGHT SERVICE] Amadeus API credentials not configured');
    }
  }

  /**
   * Get OAuth access token
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    console.log('🔑 [FLIGHT SERVICE] Getting new access token');

    try {
      const response = await axios.post(
        `${this.baseURL}/v1/security/oauth2/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.apiKey,
          client_secret: this.apiSecret,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      this.accessToken = response.data.access_token;
      // Set expiry to 5 minutes before actual expiry
      this.tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;

      console.log('✅ [FLIGHT SERVICE] Access token obtained');
      return this.accessToken;
    } catch (error: any) {
      console.error('❌ [FLIGHT SERVICE] Failed to get access token:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with Amadeus API');
    }
  }

  /**
   * Generate cache key for flight search
   */
  private generateCacheKey(params: FlightSearchParams): string {
    const keyData = JSON.stringify({
      origin: params.origin,
      destination: params.destination,
      departureDate: params.departureDate,
      returnDate: params.returnDate,
      adults: params.adults,
      children: params.children,
      travelClass: params.travelClass,
      nonStop: params.nonStop,
    });
    return crypto.createHash('md5').update(keyData).digest('hex');
  }

  /**
   * Search for flights with 24-hour caching
   */
  async searchFlights(params: FlightSearchParams): Promise<FlightOffer[]> {
    const cacheKey = this.generateCacheKey(params);

    console.log(`🔍 [FLIGHT SERVICE] Searching flights ${params.origin} → ${params.destination}`);

    // Check cache first
    try {
      const cached = await FlightCache.findOne({
        searchKey: cacheKey,
        expiresAt: { $gt: new Date() },
      });

      if (cached) {
        console.log('💾 [FLIGHT SERVICE] Returning cached results');
        return cached.flightData;
      }
    } catch (error) {
      console.error('⚠️ [FLIGHT SERVICE] Cache lookup failed:', error);
    }

    // Fetch from API
    const token = await this.getAccessToken();

    try {
      const searchParams: any = {
        originLocationCode: params.origin,
        destinationLocationCode: params.destination,
        departureDate: params.departureDate,
        adults: params.adults,
        max: params.maxResults || 5,
        currencyCode: 'USD',
      };

      if (params.returnDate) searchParams.returnDate = params.returnDate;
      if (params.children) searchParams.children = params.children;
      if (params.travelClass) searchParams.travelClass = params.travelClass;
      if (params.nonStop !== undefined) searchParams.nonStop = params.nonStop;

      const response = await axios.get(
        `${this.baseURL}/v2/shopping/flight-offers`,
        {
          params: searchParams,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const flightData = response.data.data || [];
      console.log(`✅ [FLIGHT SERVICE] Found ${flightData.length} flight offers`);

      // Cache for 24 hours
      try {
        await FlightCache.findOneAndUpdate(
          { searchKey: cacheKey },
          {
            searchKey: cacheKey,
            origin: params.origin,
            destination: params.destination,
            departureDate: params.departureDate,
            flightData,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          },
          { upsert: true, new: true }
        );
        console.log('💾 [FLIGHT SERVICE] Cached results for 24 hours');
      } catch (error) {
        console.error('⚠️ [FLIGHT SERVICE] Failed to cache results:', error);
      }

      return flightData;
    } catch (error: any) {
      console.error('❌ [FLIGHT SERVICE] Flight search failed:', error.response?.data || error.message);
      throw new Error('Failed to search flights');
    }
  }

  /**
   * Get the best (cheapest) flight
   */
  async getBestFlight(params: FlightSearchParams): Promise<TransportResult | null> {
    try {
      const flights = await this.searchFlights(params);
      
      if (!flights || flights.length === 0) {
        console.log('⚠️ [FLIGHT SERVICE] No flights found');
        return null;
      }

      // Get the cheapest flight
      const bestFlight = flights[0];
      const mainItinerary = bestFlight.itineraries[0];
      const firstSegment = mainItinerary.segments[0];
      const lastSegment = mainItinerary.segments[mainItinerary.segments.length - 1];

      // Get airline name (simplified mapping)
      const carrierCode = firstSegment.carrierCode;
      
      // Generate booking link
      const bookingLink = this.generateBookingLink(
        params.origin,
        params.destination,
        params.departureDate,
        params.returnDate
      );

      return {
        type: 'flight',
        from: firstSegment.departure.iataCode,
        to: lastSegment.arrival.iataCode,
        departure: firstSegment.departure.at,
        arrival: lastSegment.arrival.at,
        duration: mainItinerary.duration,
        price: {
          amount: bestFlight.price.grandTotal,
          currency: bestFlight.price.currency,
        },
        provider: carrierCode,
        bookingLink,
        details: bestFlight,
      };
    } catch (error) {
      console.error('❌ [FLIGHT SERVICE] Error getting best flight:', error);
      return null;
    }
  }

  /**
   * Generate booking link to external flight search engine
   */
  private generateBookingLink(
    origin: string,
    destination: string,
    departureDate: string,
    returnDate?: string
  ): string {
    // Generate Skyscanner link (most popular)
    const baseUrl = 'https://www.skyscanner.com/transport/flights';
    const depDate = departureDate.replace(/-/g, '');
    const retDate = returnDate ? returnDate.replace(/-/g, '') : '';
    
    return `${baseUrl}/${origin}/${destination}/${depDate}/${retDate}/?adults=1&adultsv2=1&cabinclass=economy&children=0&childrenv2=&inboundaltsenabled=false&infants=0&outboundaltsenabled=false&preferdirects=false&ref=home&rtn=${returnDate ? '1' : '0'}`;
  }

  /**
   * Get airport/city IATA code from city name
   */
  async getCityIATACode(cityName: string): Promise<string | null> {
    const token = await this.getAccessToken();

    // Clean city name: extract city before comma (e.g., "Delhi, India" -> "Delhi")
    const cleanCityName = cityName.split(',')[0].trim();
    
    console.log(`🔍 [FLIGHT SERVICE] Looking up IATA code for: ${cityName} (searching: ${cleanCityName})`);

    try {
      const response = await axios.get(
        `${this.baseURL}/v1/reference-data/locations`,
        {
          params: {
            keyword: cleanCityName,
            subType: 'CITY,AIRPORT',
            'page[limit]': 1,
          },
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const location = response.data.data?.[0];
      if (location) {
        console.log(`✅ [FLIGHT SERVICE] Found IATA code: ${location.iataCode} for ${cleanCityName}`);
        return location.iataCode;
      }

      // Fallback to OpenAI web search
      console.log(`⚠️ [FLIGHT SERVICE] Amadeus failed, trying OpenAI web search for: ${cleanCityName}`);
      return await this.getIATACodeWithAI(cityName);
    } catch (error: any) {
      console.error('❌ [FLIGHT SERVICE] IATA lookup failed:', error.response?.data || error.message);
      // Try AI fallback on error too
      return await this.getIATACodeWithAI(cityName);
    }
  }

  /**
   * Fallback: Use OpenAI web search to find IATA code
   */
  private async getIATACodeWithAI(cityName: string): Promise<string | null> {
    try {
      const { ChatOpenAI } = await import('@langchain/openai');
      
      const model = new ChatOpenAI({
        model: 'gpt-4o-mini',
        temperature: 0,
      });

      const prompt = `What is the main international airport IATA code for ${cityName}? 
Only respond with the 3-letter IATA code (e.g., DEL, BOM, BLR, MIA, JFK).
If the city has multiple airports, provide the main international airport code.
For example:
- Mumbai/Bombay → BOM
- Bangalore/Bengaluru → BLR
- Delhi → DEL
- New York → JFK

Just the code, nothing else.`;

      const response = await model.invoke(prompt);
      const iataCode = response.content.toString().trim().toUpperCase();
      
      // Validate it's a 3-letter code
      if (/^[A-Z]{3}$/.test(iataCode)) {
        console.log(`🤖 [FLIGHT SERVICE] OpenAI found IATA code: ${iataCode} for ${cityName}`);
        return iataCode;
      }

      console.log(`❌ [FLIGHT SERVICE] OpenAI returned invalid code: ${iataCode}`);
      return null;
    } catch (error) {
      console.error('❌ [FLIGHT SERVICE] OpenAI IATA lookup failed:', error);
      return null;
    }
  }

  /**
   * Format duration from ISO 8601 format (PT2H30M) to readable format
   */
  formatDuration(isoDuration: string): string {
    const match = isoDuration.match(/PT(\d+H)?(\d+M)?/);
    if (!match) return isoDuration;

    const hours = match[1] ? parseInt(match[1]) : 0;
    const minutes = match[2] ? parseInt(match[2]) : 0;

    if (hours && minutes) return `${hours}h ${minutes}m`;
    if (hours) return `${hours}h`;
    if (minutes) return `${minutes}m`;
    return isoDuration;
  }
}

export const flightService = new FlightService();
