import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../hooks/useSocket.js';
import { MessageBubble } from '../components/Chat/MessageBubble.jsx';
import { TypingIndicator } from '../components/Chat/TypingIndicator.jsx';
import { MessageInput } from '../components/Chat/MessageInput.jsx';
import { ItineraryMap } from '../components/ItineraryMap.jsx';
import { ItineraryOverlay } from '../components/ItineraryOverlay.jsx';
import { parseItineraryFromMarkdown } from '../utils/itineraryParser.js';
import Navbar from '../components/Navbar.jsx';
import axios from 'axios';
import { Plane, MapPin, Calendar, Eye, EyeOff } from 'lucide-react';
import { useTrip } from '../contexts/TripContext.jsx';

const API_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export function Chat() {
  const { tripData } = useTrip();
  const [conversationId, setConversationId] = useState(undefined);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  
  // Itinerary and Map state
  const [currentItinerary, setCurrentItinerary] = useState(null);
  const [isItineraryOpen, setIsItineraryOpen] = useState(false);
  const [mapLocations, setMapLocations] = useState([]);

  const { isConnected, agentStatus, lastMessage, lastError, lastItineraryUpdate, clearLastMessage, clearLastError, clearLastItineraryUpdate } = 
    useSocket(conversationId);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Sync itinerary from TripContext to conversation on mount
  useEffect(() => {
    const syncItinerary = async () => {
      const storedId = localStorage.getItem('tripwhat_conversation_id');
      const itinerary = tripData.generatedItinerary?.itinerary || tripData.generatedItinerary || tripData.selectedTrip;
      if (!storedId || !itinerary) return;

      try {
        const token = localStorage.getItem('tripwhat_token');
        if (!token) return;

        // Sync the itinerary to the conversation
        await axios.post(`${API_URL}/api/chat/sync-itinerary`, {
          conversationId: storedId,
          itinerary: itinerary
        }, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log('✅ [CHAT] Synced itinerary from TripContext to conversation');
      } catch (error) {
        console.error('Failed to sync itinerary:', error);
      }
    };

    syncItinerary();
  }, [tripData.generatedItinerary, tripData.selectedTrip]);

  // Fetch conversation history on initial load
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        // Check if there's a conversation ID in local storage
        const storedId = localStorage.getItem('tripwhat_conversation_id');
        
        if (storedId) {
          setConversationId(storedId);
          
          // Get the message history for this conversation
          const token = localStorage.getItem('tripwhat_token');
          if (token) {
            const response = await axios.get(`${API_URL}/api/chat/history/${storedId}`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.data.messages && response.data.messages.length > 0) {
              setMessages(response.data.messages);
              
              // Look for any itineraries in the messages
              const botMessages = response.data.messages.filter(m => m.role === 'assistant');
              if (botMessages.length > 0) {
                const lastBotMessage = botMessages[botMessages.length - 1];
                const extractedItinerary = parseItineraryFromMarkdown(lastBotMessage.content);
                if (extractedItinerary) {
                  setCurrentItinerary(extractedItinerary);
                  
                  // Extract locations for the map
                  const locations = [];
                  extractedItinerary.days.forEach(day => {
                    day.activities.forEach(activity => {
                      if (activity.location && activity.coordinates) {
                        locations.push({
                          name: activity.name,
                          description: activity.description,
                          lat: activity.coordinates.lat,
                          lng: activity.coordinates.lng
                        });
                      }
                    });
                  });
                  
                  setMapLocations(locations);
                }
              }
            }
          }
        } else {
          // Create a new conversation
          const token = localStorage.getItem('tripwhat_token');
          if (token) {
            const response = await axios.post(`${API_URL}/api/chat/conversation`, {}, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.data.conversationId) {
              setConversationId(response.data.conversationId);
              localStorage.setItem('tripwhat_conversation_id', response.data.conversationId);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch conversation history:', error);
      }
    };
    
    fetchHistory();
  }, []);

  // Process incoming messages from socket
  useEffect(() => {
    if (lastMessage) {
      // Extract the actual message content from the object
      const messageContent = typeof lastMessage === 'string' 
        ? lastMessage 
        : lastMessage.message;
      
      // Add the message to the chat
      setMessages(prev => [...prev, { role: 'assistant', content: messageContent }]);
      
      // Look for itinerary data
      const extractedItinerary = parseItineraryFromMarkdown(messageContent);
      if (extractedItinerary) {
        setCurrentItinerary(extractedItinerary);
        
        // Extract locations for the map
        const locations = [];
        extractedItinerary.days.forEach(day => {
          day.activities.forEach(activity => {
            if (activity.location && activity.coordinates) {
              locations.push({
                name: activity.name,
                description: activity.description,
                lat: activity.coordinates.lat,
                lng: activity.coordinates.lng
              });
            }
          });
        });
        
        setMapLocations(locations);
      }
      
      clearLastMessage();
      setIsLoading(false);
    }
    
    if (lastError) {
      // Extract the actual error message from the object
      const errorContent = typeof lastError === 'string' 
        ? lastError 
        : lastError.error || "I'm sorry, I encountered an error while processing your request. Please try again.";
      
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: errorContent
      }]);
      clearLastError();
      setIsLoading(false);
    }
  }, [lastMessage, lastError, clearLastMessage, clearLastError]);

  // Handle itinerary modifications
  useEffect(() => {
    if (lastItineraryUpdate) {
      console.log('📝 [CHAT] Received itinerary update:', lastItineraryUpdate);
      
      // Update the itinerary
      if (lastItineraryUpdate.updatedItinerary) {
        setCurrentItinerary(lastItineraryUpdate.updatedItinerary);
        
        // Extract locations for the map
        const locations = [];
        lastItineraryUpdate.updatedItinerary.days?.forEach(day => {
          day.timeSlots?.forEach(slot => {
            slot.activities?.forEach(activity => {
              if (activity.coordinates) {
                locations.push({
                  name: activity.name,
                  description: activity.description,
                  lat: activity.coordinates.lat,
                  lng: activity.coordinates.lng
                });
              }
            });
          });
        });
        
        setMapLocations(locations);
      }
      
      // Show success message in chat
      if (lastItineraryUpdate.modification?.message) {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `✅ ${lastItineraryUpdate.modification.message}`,
          timestamp: new Date().toISOString()
        }]);
      }
      
      clearLastItineraryUpdate();
    }
  }, [lastItineraryUpdate, clearLastItineraryUpdate]);

  const handleSendMessage = async (message) => {
    if (!message.trim() || isLoading) return;
    
    // Add user message to chat
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setIsLoading(true);
    
    try {
      // Save message to backend (include current itinerary if available)
      const token = localStorage.getItem('tripwhat_token');
      const itinerary = tripData.generatedItinerary?.itinerary || tripData.generatedItinerary || tripData.selectedTrip;
      console.log('📤 [CHAT] Sending message with itinerary:', !!itinerary);
      
      await axios.post(`${API_URL}/api/chat/message`, {
        conversationId,
        message,
        currentItinerary: itinerary || null, // Send itinerary with every message
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      // The socket will handle the response
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "I'm sorry, I couldn't send your message. Please check your connection and try again." 
      }]);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* Navbar */}
      <Navbar />
      
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center shadow-md">
                <Plane className="text-white" size={20} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Trip Planning Assistant</h1>
                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                  {isConnected ? 'Connected' : 'Disconnected'}
                  {conversationId && <span className="ml-2 text-gray-400">• Session: {conversationId.slice(0, 8)}</span>}
                </p>
              </div>
            </div>
            
            {currentItinerary && (
              <button
                onClick={() => setIsItineraryOpen(!isItineraryOpen)}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg shadow-md hover:shadow-lg transition-all hover:scale-105 text-sm font-medium"
              >
                {isItineraryOpen ? <EyeOff size={16} /> : <Eye size={16} />}
                {isItineraryOpen ? 'Hide Itinerary' : 'View Itinerary'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Split View: Chat + Map */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Panel - 40% */}
        <div className="w-[40%] flex flex-col bg-white/95 backdrop-blur-sm border-r border-gray-200/50 shadow-lg">
          <div className="flex-1 overflow-y-auto px-6 py-6">
          {messages.length === 0 ? (
            // Welcome Screen
            <div className="text-center py-12">
              <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center shadow-xl">
                <Plane className="text-white" size={40} />
              </div>
              <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-3">
                Where to next?
              </h2>
              <p className="text-gray-600 mb-8 max-w-md mx-auto">
                Tell me your travel plans and I'll create a personalized itinerary with interactive maps and local recommendations.
              </p>
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-500">✨ Try asking:</p>
                <div className="space-y-2">
                  <button 
                    onClick={() => handleSendMessage("Plan a weekend trip to Paris for a couple interested in art and fine dining.")}
                    className="block w-full py-3 px-4 bg-white border border-purple-200 rounded-xl text-left text-sm text-gray-700 hover:border-purple-300 hover:shadow-md transition-all"
                  >
                    💜 "Plan a weekend trip to Paris for art lovers"
                  </button>
                  <button 
                    onClick={() => handleSendMessage("I want to take my family to Tokyo for 5 days. We love anime and traditional culture.")}
                    className="block w-full py-3 px-4 bg-white border border-purple-200 rounded-xl text-left text-sm text-gray-700 hover:border-purple-300 hover:shadow-md transition-all"
                  >
                    🗾 "Family trip to Tokyo with anime & culture"
                  </button>
                  <button 
                    onClick={() => handleSendMessage("What are the must-visit places in New York City for a first-time visitor?")}
                    className="block w-full py-3 px-4 bg-white border border-purple-200 rounded-xl text-left text-sm text-gray-700 hover:border-purple-300 hover:shadow-md transition-all"
                  >
                    🗽 "First-time visitor to New York City"
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {messages.map((message, index) => (
                <MessageBubble
                  key={index}
                  role={message.role}
                  content={message.content}
                  timestamp={message.timestamp || new Date()}
                  onViewItinerary={currentItinerary && message.role === 'assistant' ? () => setIsItineraryOpen(true) : null}
                />
              ))}
              {isLoading && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </>
          )}
          </div>
          
          {/* Message Input */}
          <MessageInput 
            onSend={handleSendMessage} 
            disabled={isLoading || !isConnected}
            placeholder={!isConnected ? "Connecting to chat server..." : "Ask me about your next trip..."}
          />
        </div>
        
        {/* Map Panel - 60% */}
        <div className="w-[60%] relative bg-white">
          {currentItinerary ? (
            <ItineraryMap 
              itinerary={currentItinerary}
              selectedDay={null}
            />
          ) : (
            <div className="h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
              <div className="text-center p-8">
                <MapPin className="w-16 h-16 text-purple-300 mx-auto mb-4" />
                <p className="text-gray-500 text-lg font-medium">Your itinerary map will appear here</p>
                <p className="text-gray-400 text-sm mt-2">Start chatting to plan your trip</p>
              </div>
            </div>
          )}
          
          {/* Itinerary Overlay */}
          {currentItinerary && isItineraryOpen && (
            <ItineraryOverlay 
              itinerary={currentItinerary}
              onClose={() => setIsItineraryOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
