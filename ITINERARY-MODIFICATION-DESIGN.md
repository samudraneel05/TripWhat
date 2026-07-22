# 🎯 Itinerary Modification via Chat - Design Document

## Overview
Enable the chat agent to understand and execute itinerary modifications directly, allowing users to add, remove, or modify activities through natural language conversations.

---

## 🎨 Use Cases

### **1. Add Activities**
- "Add the Eiffel Tower to Day 2 morning"
- "Find me a good restaurant near the Louvre and add it to my itinerary"
- "I want to visit art museums, can you add some to Day 3?"

### **2. Remove Activities**
- "Remove the shopping activity from Day 1"
- "Take out all evening activities from Day 2"
- "I don't want to visit the museum anymore"

### **3. Replace Activities**
- "Replace the restaurant on Day 1 with a different one"
- "Swap the museum visit with something outdoorsy"

### **4. Modify Day Structure**
- "Add another day to my trip"
- "Remove Day 3 from my itinerary"
- "Move the Louvre visit from Day 1 to Day 2"

### **5. Adjust Activity Details**
- "Move the museum visit to the afternoon"
- "Make the dinner reservation earlier"
- "Extend the time at the park to 2 hours"

### **6. Smart Suggestions**
- "I'm interested in local food, add some activities"
- "Find me family-friendly activities for Day 2"
- "Add a morning workout activity each day"

---

## 🏗️ Architecture

### **Backend Components**

#### **1. Intent Detection (intent-detector.ts)**
```typescript
New Intents:
- ADD_ACTIVITY: User wants to add something
- REMOVE_ACTIVITY: User wants to remove something
- REPLACE_ACTIVITY: User wants to swap activities
- MODIFY_DAY: User wants to change day structure
- MODIFY_ACTIVITY_TIME: User wants to adjust timing
- FIND_AND_ADD: User wants AI to find + add activities
```

#### **2. Action Extraction (new: action-extractor.ts)**
```typescript
interface ItineraryAction {
  type: 'add' | 'remove' | 'replace' | 'modify' | 'move';
  target: {
    day?: number;
    timeSlot?: 'morning' | 'afternoon' | 'evening';
    activityId?: string;
    activityName?: string;
  };
  details: {
    placeName?: string;
    placeType?: string;
    category?: string[];
    duration?: string;
    time?: string;
    preferences?: string[];
  };
}
```

#### **3. Itinerary Service (new: itinerary-service.ts)**
```typescript
class ItineraryService {
  addActivity(itinerary, action)
  removeActivity(itinerary, action)
  replaceActivity(itinerary, action)
  moveActivity(itinerary, action)
  addDay(itinerary)
  removeDay(itinerary, dayNumber)
  modifyActivityTime(itinerary, action)
}
```

#### **4. API Endpoints (new routes)**
```
POST /api/itinerary/:conversationId/modify
  - Body: { action: ItineraryAction, currentItinerary: Itinerary }
  - Response: { updatedItinerary, message }

POST /api/itinerary/:conversationId/suggest
  - Body: { preferences, day, timeSlot, currentItinerary }
  - Response: { suggestions: Place[] }

GET /api/itinerary/:conversationId/current
  - Response: { itinerary }
```

### **Frontend Components**

#### **1. Itinerary Context Enhancement**
```typescript
// Add methods to context
updateItinerary(newItinerary)
optimisticUpdate(action) // For instant UI feedback
revertUpdate() // For undo functionality
```

#### **2. Chat Integration**
```typescript
// Handle itinerary modification responses
{
  type: 'itinerary_update',
  action: ItineraryAction,
  updatedItinerary: Itinerary,
  message: string
}
```

#### **3. Modification Feedback UI**
- Toast notifications for changes
- Inline update animations
- Undo button (5 seconds)
- Confirmation dialogs for major changes

---

## 🔄 Flow Diagrams

### **Add Activity Flow**
```
User: "Add the Louvre to Day 2 morning"
  ↓
Intent Detection: ADD_ACTIVITY
  ↓
Action Extraction:
  - type: 'add'
  - target: { day: 2, timeSlot: 'morning' }
  - details: { placeName: 'Louvre' }
  ↓
Search for "Louvre" via Google Places API
  ↓
Find best match: Louvre Museum
  ↓
Add to itinerary Day 2 morning slot
  ↓
Return updated itinerary + confirmation message
  ↓
Frontend updates UI with animation
  ↓
Show toast: "✅ Added Louvre Museum to Day 2 morning"
```

### **Find & Add Flow**
```
User: "I love art, add some museums to Day 3"
  ↓
Intent Detection: FIND_AND_ADD
  ↓
Action Extraction:
  - type: 'add'
  - target: { day: 3 }
  - details: { category: ['museum', 'art'], preferences: ['art'] }
  ↓
Search Google Places: museums + art galleries near destination
  ↓
Get top 3-5 matches with high ratings
  ↓
Add to Day 3 with smart time slot distribution
  ↓
Return updated itinerary + personalized message
  ↓
Frontend: Smooth animations for each new activity
  ↓
Show: "✨ Added 3 art museums to Day 3!"
```

### **Remove Activity Flow**
```
User: "Remove the shopping from Day 1"
  ↓
Intent Detection: REMOVE_ACTIVITY
  ↓
Action Extraction:
  - type: 'remove'
  - target: { day: 1, activityName: 'shopping' }
  ↓
Find matching activity in Day 1
  ↓
Remove from itinerary
  ↓
Return updated itinerary
  ↓
Frontend: Fade-out animation
  ↓
Show: "🗑️ Removed shopping activity from Day 1" + UNDO button
```

---

## 📡 Data Structures

### **Itinerary Modification Message**
```typescript
interface ItineraryModificationResponse {
  type: 'itinerary_modification';
  action: {
    type: 'add' | 'remove' | 'replace' | 'modify';
    summary: string; // "Added Louvre Museum to Day 2 morning"
  };
  updatedItinerary: Itinerary;
  changes: {
    day: number;
    added?: Activity[];
    removed?: Activity[];
    modified?: Activity[];
  }[];
  message: string; // Natural language response
  conversationId: string;
}
```

### **Activity Structure**
```typescript
interface Activity {
  id: string; // UUID for tracking
  name: string;
  description: string;
  duration: string;
  cost: string;
  type: string;
  placeId?: string; // Google Places ID
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
```

---

## 🔐 Validation & Safety

### **Before Modification**
1. ✅ Validate conversation ID exists
2. ✅ Verify user owns the itinerary
3. ✅ Check itinerary structure is valid
4. ✅ Ensure day number exists
5. ✅ Validate time slot availability

### **Confirmation Required For**
- Removing entire day
- Clearing all activities
- Major structural changes

### **Auto-Confirm For**
- Adding single activity
- Removing single activity
- Moving activities
- Adjusting times

---

## 🎨 UI/UX Enhancements

### **Visual Feedback**
```jsx
// Toast notification with undo
<Toast>
  <div className="flex items-center gap-3">
    <CheckCircle className="text-green-500" />
    <span>Added Louvre Museum to Day 2</span>
    <button onClick={handleUndo}>Undo</button>
  </div>
</Toast>

// Inline activity highlight
<Activity className="animate-pulse-green border-green-500" />

// Modification badge
<Badge variant="new">Just added</Badge>
```

### **Animation States**
- **Adding**: Slide in from right + green pulse
- **Removing**: Fade out + scale down
- **Replacing**: Cross-fade between activities
- **Moving**: Slide from old position to new

---

## 🧪 Testing Strategy

### **Backend Tests**
```typescript
describe('Intent Detection', () => {
  test('detects ADD_ACTIVITY intent')
  test('detects REMOVE_ACTIVITY intent')
  test('extracts day number correctly')
  test('extracts time slot correctly')
});

describe('Itinerary Modification', () => {
  test('adds activity to correct day and time slot')
  test('removes activity by name')
  test('handles invalid day numbers')
  test('prevents duplicate activities')
});
```

### **Frontend Tests**
```typescript
describe('Itinerary Updates', () => {
  test('renders new activity with animation')
  test('shows undo button after modification')
  test('handles optimistic updates')
  test('reverts on error')
});
```

### **Integration Tests**
```typescript
describe('End-to-End Modification', () => {
  test('user adds activity via chat → itinerary updates')
  test('user removes activity → UI updates + undo works')
  test('user finds places → suggestions appear → adds to itinerary')
});
```

---

## 📋 Implementation Phases

### **Phase 1: Core Functionality** ⭐ (This PR)
- [x] Design document
- [ ] Intent detection for ADD/REMOVE
- [ ] Action extraction logic
- [ ] Basic itinerary service
- [ ] API endpoints for modifications
- [ ] Frontend integration
- [ ] Toast notifications

### **Phase 2: Smart Features** 
- [ ] Find & Add with preferences
- [ ] Replace activity
- [ ] Move activity between days
- [ ] Smart time slot allocation

### **Phase 3: Advanced Features**
- [ ] Undo/Redo functionality
- [ ] Modification history
- [ ] Conflict detection
- [ ] Multi-user sync

### **Phase 4: Polish**
- [ ] Smooth animations
- [ ] Inline editing
- [ ] Drag & drop support
- [ ] Voice commands

---

## 🚀 Example Interactions

### **Example 1: Simple Add**
```
User: "Add the Eiffel Tower to Day 2 morning"

Agent: "I've added the Eiffel Tower to Day 2 morning! 🗼

**Eiffel Tower**
⏱️ Duration: 2-3 hours
💰 Cost: €17-28
📍 Champ de Mars, Paris
⭐ Rating: 4.6/5

Would you like me to suggest nearby restaurants for lunch?"

[Itinerary updates with animation]
[Toast: "✅ Added Eiffel Tower to Day 2 morning" + UNDO]
```

### **Example 2: Find & Add**
```
User: "I'm interested in local French cuisine, add some authentic restaurants to Day 3"

Agent: "Great taste! I've added 3 highly-rated authentic French restaurants to Day 3: 🍷

**Lunch - Le Comptoir du Relais** ⭐ 4.5/5
A cozy bistro serving traditional French dishes in the Latin Quarter.

**Dinner - Le Cinq** ⭐ 4.8/5  
Michelin-starred fine dining at Four Seasons Hotel George V.

**Late Night - L'Avant Comptoir** ⭐ 4.4/5
Casual wine bar with delicious small plates and natural wines.

Each restaurant offers an authentic Parisian dining experience. Would you like to adjust the timing or see more options?"

[Itinerary smoothly animates in 3 new activities]
[Toast: "✨ Added 3 French restaurants to Day 3"]
```

### **Example 3: Remove**
```
User: "Remove the shopping activity from Day 1, I want more cultural experiences"

Agent: "No problem! I've removed the shopping activity from Day 1. 

Since you're interested in cultural experiences, would you like me to add:
- A visit to the Musée d'Orsay (impressionist art)
- A walking tour of Montmartre
- A cooking class for authentic French cuisine

Just let me know what sounds interesting! 🎨"

[Activity fades out with animation]
[Toast: "🗑️ Removed shopping from Day 1" + UNDO (5s)]
```

---

## 📊 Success Metrics

### **Engagement**
- % of users who use chat to modify itinerary
- Average modifications per conversation
- Time saved vs manual editing

### **Accuracy**
- % of modifications that are correct
- % of modifications that require undo
- User satisfaction ratings

### **Performance**
- Response time for modifications
- API latency
- UI animation smoothness

---

## 🔧 Technical Considerations

### **State Management**
- Use optimistic updates for instant feedback
- Rollback on API failures
- Keep modification history in memory
- Sync with backend on success

### **Conflict Resolution**
- Check if activity already exists before adding
- Handle concurrent modifications (multi-device)
- Validate itinerary consistency after each change

### **Performance**
- Debounce rapid modifications
- Batch multiple changes when possible
- Cache Google Places results
- Optimize re-renders

---

## 🎯 Next Steps

1. ✅ Create this design document
2. ⏭️ Implement intent detection for modifications
3. ⏭️ Build action extraction logic
4. ⏭️ Create itinerary service with CRUD operations
5. ⏭️ Add API endpoints
6. ⏭️ Integrate with frontend
7. ⏭️ Add toast notifications and animations
8. ⏭️ Test end-to-end flows

---

**Status**: 📝 Design Complete - Ready for Implementation
**Priority**: 🔥 High
**Estimated Time**: 4-6 hours for Phase 1
