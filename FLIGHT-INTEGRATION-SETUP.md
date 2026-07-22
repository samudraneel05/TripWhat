# 🛫 Flight & Transport Integration

## ✅ Completed

### **Backend Services Created:**
1. ✅ `flightService.ts` - Amadeus API integration with 24-hour caching
2. ✅ `FlightCache` model - MongoDB caching layer
3. ✅ Flight search, IATA lookup, booking link generation

### **Features:**
- ✅ Real flight prices from 500+ airlines
- ✅ 24-hour intelligent caching
- ✅ External booking links (Skyscanner)
- ✅ IATA code auto-lookup for cities
- ✅ Duration formatting

---

## 🔧 Setup Instructions

### **1. Get Amadeus API Credentials**

1. Go to [Amadeus for Developers](https://developers.amadeus.com/)
2. Click "Register" (free)
3. Create a new app in the dashboard
4. Copy your **API Key** and **API Secret**

### **2. Update `.env` File**

Add to `backend/.env`:

```env
# Amadeus Flight API
AMADEUS_API_KEY=your_api_key_here
AMADEUS_API_SECRET=your_api_secret_here
AMADEUS_API_ENV=test
# Change to 'production' when ready for live data
```

### **3. Install Dependencies** (if needed)

```bash
cd backend
npm install axios
```

---

## 📋 Next Steps: Integration into Itinerary

### **Phase 1: Add Flights to Itinerary Generation**

We need to:

1. **Update Travel Agent** - Add flight search when generating itineraries
2. **Modify Itinerary Structure** - Include travel activities
3. **Update Timeline UI** - Display flights/transport

### **Data Structure for Travel Activities:**

```typescript
{
  type: 'travel',
  subType: 'flight' | 'train' | 'bus',
  name: 'Flight to Paris',
  from: {
    city: 'New York',
    code: 'JFK',
    time: '10:00 AM'
  },
  to: {
    city: 'Paris',
    code: 'CDG',
    time: '11:30 PM'
  },
  duration: '7h 30m',
  price: {
    amount: '450',
    currency: 'USD'
  },
  provider: 'Air France',
  bookingLink: 'https://...',
  icon: '✈️'
}
```

### **Timeline Integration:**

```
Day 0 (Departure)
├─ ✈️ Flight: NYC → Paris (7h 30m) - $450
│   └─ Departs 10:00 AM, Arrives 11:30 PM

Day 1 (Paris)
├─ 🌅 Morning
│   ├─ Eiffel Tower
│   └─ ...

Day 3 (Travel to Lyon)
├─ 🚄 Train: Paris → Lyon (2h) - €60
│   └─ Departs 9:00 AM
├─ 🌅 Afternoon (Lyon)
│   └─ ...

Day 5 (Return)
├─ ✈️ Flight: Paris → NYC (8h) - $480
    └─ Departs 2:00 PM
```

---

## 🎯 Usage Example

```typescript
import { flightService } from './services/flightService';

// Search flights
const flights = await flightService.searchFlights({
  origin: 'JFK',
  destination: 'CDG',
  departureDate: '2024-06-15',
  adults: 2,
  travelClass: 'ECONOMY',
  maxResults: 5
});

// Get best (cheapest) flight
const bestFlight = await flightService.getBestFlight({
  origin: 'JFK',
  destination: 'CDG',
  departureDate: '2024-06-15',
  returnDate: '2024-06-22',
  adults: 2
});

// Get IATA code
const iataCode = await flightService.getCityIATACode('Paris');
// Returns: 'CDG' or 'PAR'
```

---

## 📝 Testing

1. **Test Flight Search:**
```bash
curl -X GET "http://localhost:5000/api/flights/search?origin=JFK&destination=CDG&departureDate=2024-06-15&adults=1"
```

2. **Check Cache:**
```bash
# MongoDB
db.flightcaches.find()
```

---

## 🚀 Ready to Integrate!

Run the following command to confirm:
```bash
# In backend directory
npm run dev
```

Look for:
```
✅ [FLIGHT SERVICE] Access token obtained
💾 [FLIGHT SERVICE] Cached results for 24 hours
```

---

## ⚠️ Important Notes

### **API Limits (Free Tier):**
- 2,000 API calls/month
- Rate limit: 10 calls/second
- Cache expires after 24 hours

### **Limitations:**
- ❌ Low-cost carriers not available
- ❌ American Airlines, Delta, British Airways excluded
- ✅ 500+ other airlines included

### **Booking:**
- Links redirect to Skyscanner (pre-filled)
- Users complete booking externally
- No payment processing needed

---

## 🔄 Next: Integrate into Itinerary Generation

Would you like me to:
1. ✅ Add flight search to trip planning flow?
2. ✅ Update itinerary structure to include travel?
3. ✅ Modify timeline UI to display flights?

Let me know and I'll implement!
