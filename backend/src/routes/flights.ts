import express from 'express';
import { flightService } from '../services/flightService';

const router = express.Router();

/**
 * GET /api/flights/search
 * Search for flights
 */
router.get('/search', async (req, res) => {
  try {
    const {
      origin,
      destination,
      departureDate,
      returnDate,
      adults = '1',
      children = '0',
      travelClass = 'ECONOMY',
      nonStop = 'false',
      maxResults = '5'
    } = req.query;

    if (!origin || !destination || !departureDate) {
      return res.status(400).json({
        error: 'Missing required parameters: origin, destination, departureDate'
      });
    }

    const flights = await flightService.searchFlights({
      origin: origin as string,
      destination: destination as string,
      departureDate: departureDate as string,
      returnDate: returnDate as string | undefined,
      adults: parseInt(adults as string),
      children: parseInt(children as string) || undefined,
      travelClass: travelClass as any,
      nonStop: nonStop === 'true',
      maxResults: parseInt(maxResults as string)
    });

    return res.json({
      success: true,
      count: flights.length,
      flights
    });

  } catch (error: any) {
    console.error('Flight search error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to search flights'
    });
  }
});

/**
 * GET /api/flights/best
 * Get the best (cheapest) flight
 */
router.get('/best', async (req, res) => {
  try {
    const {
      origin,
      destination,
      departureDate,
      returnDate,
      adults = '1',
      children = '0',
    } = req.query;

    if (!origin || !destination || !departureDate) {
      return res.status(400).json({
        error: 'Missing required parameters: origin, destination, departureDate'
      });
    }

    const bestFlight = await flightService.getBestFlight({
      origin: origin as string,
      destination: destination as string,
      departureDate: departureDate as string,
      returnDate: returnDate as string | undefined,
      adults: parseInt(adults as string),
      children: parseInt(children as string) || undefined,
    });

    if (!bestFlight) {
      return res.status(404).json({
        error: 'No flights found'
      });
    }

    return res.json({
      success: true,
      flight: bestFlight
    });

  } catch (error: any) {
    console.error('Best flight error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to find best flight'
    });
  }
});

/**
 * GET /api/flights/iata
 * Get IATA code for a city
 */
router.get('/iata', async (req, res) => {
  try {
    const { city } = req.query;

    if (!city) {
      return res.status(400).json({
        error: 'Missing required parameter: city'
      });
    }

    const iataCode = await flightService.getCityIATACode(city as string);

    if (!iataCode) {
      return res.status(404).json({
        error: `No IATA code found for: ${city}`
      });
    }

    return res.json({
      success: true,
      city,
      iataCode
    });

  } catch (error: any) {
    console.error('IATA lookup error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to lookup IATA code'
    });
  }
});

export default router;
