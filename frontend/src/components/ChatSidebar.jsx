import { useState, useEffect, useRef } from "react";
import { useSocket } from "@/hooks/useSocket.js";
import { MessageBubble } from "@/components/Chat/MessageBubble.jsx";
import { TypingIndicator } from "@/components/Chat/TypingIndicator.jsx";
import { MessageInput } from "@/components/Chat/MessageInput.jsx";
import { parseItineraryFromMarkdown } from "@/utils/itineraryParser.js";
import { useTrip } from "@/contexts/TripContext.jsx";
import axios from "axios";
import { Plane, MapPin, X } from "lucide-react";

const API_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

export function ChatSidebar({ isOpen, onClose, onItineraryUpdate }) {
  const { tripData } = useTrip();
  const [conversationId, setConversationId] = useState(undefined);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const {
    isConnected,
    agentStatus,
    lastMessage,
    lastError,
    lastItineraryUpdate,
    clearLastMessage,
    clearLastError,
    clearLastItineraryUpdate,
  } = useSocket(conversationId);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Sync itinerary from TripContext to conversation when sidebar opens
  useEffect(() => {
    const syncItinerary = async () => {
      const storedId = localStorage.getItem("tripwhat_conversation_id");
      const itinerary = tripData.generatedItinerary?.itinerary || tripData.generatedItinerary || tripData.selectedTrip;
      if (!storedId || !itinerary || !isOpen) return;

      try {
        const token = localStorage.getItem("tripwhat_token");
        if (!token) return;

        // Sync the itinerary to the conversation
        await axios.post(`${API_URL}/api/chat/sync-itinerary`, {
          conversationId: storedId,
          itinerary: itinerary
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });

        console.log('[SIDEBAR] ✅ Synced itinerary from TripContext to conversation');
      } catch (error) {
        console.error('[SIDEBAR] Failed to sync itinerary:', error);
      }
    };

    syncItinerary();
  }, [isOpen, tripData.generatedItinerary, tripData.selectedTrip]);

  // Fetch conversation history on initial load
  useEffect(() => {
    if (!isOpen) return;

    const fetchHistory = async () => {
      try {
        // Check if there's a conversation ID in local storage
        const storedId = localStorage.getItem("tripwhat_conversation_id");

        if (storedId) {
          setConversationId(storedId);

          // Get the message history for this conversation
          const token = localStorage.getItem("tripwhat_token");
          if (token) {
            const response = await axios.get(
              `${API_URL}/api/chat/${storedId}`,
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );

            if (response.data.messages && response.data.messages.length > 0) {
              // Ensure all messages have timestamps
              const messagesWithTimestamps = response.data.messages.map(msg => ({
                ...msg,
                timestamp: msg.timestamp || new Date().toISOString()
              }));
              setMessages(messagesWithTimestamps);

              // Look for any itineraries in the messages
              const botMessages = response.data.messages.filter(
                (m) => m.role === "assistant"
              );
              if (botMessages.length > 0) {
                const lastBotMessage = botMessages[botMessages.length - 1];
                const extractedItinerary = parseItineraryFromMarkdown(
                  lastBotMessage.content
                );
                if (extractedItinerary && onItineraryUpdate) {
                  onItineraryUpdate(extractedItinerary);
                }
              }
            }
          }
        } else {
          // No existing conversation - one will be created when first message is sent
          console.log(
            "No existing conversation found - will create on first message"
          );
        }
      } catch (error) {
        console.error("Failed to fetch conversation history:", error);
      }
    };

    fetchHistory();
  }, [isOpen, onItineraryUpdate]);

  // Process incoming messages from socket
  useEffect(() => {
    if (lastMessage) {
      // Extract the actual message content from the object
      const messageContent = typeof lastMessage === 'string' 
        ? lastMessage 
        : lastMessage.message;
      
      // Add the message to the chat
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: messageContent, timestamp: new Date().toISOString() },
      ]);

      // Look for itinerary data
      const extractedItinerary = parseItineraryFromMarkdown(messageContent);
      if (extractedItinerary && onItineraryUpdate) {
        onItineraryUpdate(extractedItinerary);
      }

      clearLastMessage();
      setIsLoading(false);
    }

    if (lastError) {
      // Extract the actual error message from the object
      const errorContent = typeof lastError === 'string' 
        ? lastError 
        : lastError.error || "I'm sorry, I couldn't send your message. Please check your connection and try again.";
      
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: errorContent,
          timestamp: new Date().toISOString(),
        },
      ]);
      clearLastError();
      setIsLoading(false);
    }
  }, [
    lastMessage,
    lastError,
    clearLastMessage,
    clearLastError,
    onItineraryUpdate,
  ]);

  // Handle itinerary modifications
  useEffect(() => {
    if (lastItineraryUpdate) {
      console.log('[SIDEBAR] Received itinerary update:', lastItineraryUpdate);
      
      // Update parent component with new itinerary
      if (lastItineraryUpdate.updatedItinerary && onItineraryUpdate) {
        onItineraryUpdate(lastItineraryUpdate.updatedItinerary);
      }
      
      // Show success message in chat
      if (lastItineraryUpdate.modification?.message) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `✅ ${lastItineraryUpdate.modification.message}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
      
      clearLastItineraryUpdate();
    }
  }, [lastItineraryUpdate, clearLastItineraryUpdate, onItineraryUpdate]);

  const handleSendMessage = async (message) => {
    if (!message.trim() || isLoading) return;

    // Add user message to the chat immediately
    setMessages((prev) => [...prev, { role: "user", content: message, timestamp: new Date().toISOString() }]);
    setIsLoading(true);

    try {
      const token = localStorage.getItem("tripwhat_token");
      if (!token) {
        throw new Error("No authentication token found");
      }

      const itinerary = tripData.generatedItinerary?.itinerary || tripData.generatedItinerary || tripData.selectedTrip;
      console.log('[SIDEBAR] 📤 Sending message with itinerary:', !!itinerary);
      
      const response = await axios.post(
        `${API_URL}/api/chat`,
        {
          message,
          conversationId,
          currentItinerary: itinerary || null, // Send itinerary with every message
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      // If this was the first message and we got a new conversationId, store it
      if (response.data.conversationId && !conversationId) {
        setConversationId(response.data.conversationId);
        localStorage.setItem(
          "tripwhat_conversation_id",
          response.data.conversationId
        );
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I'm sorry, I couldn't send your message. Please check your connection and try again.",
          timestamp: new Date().toISOString(),
        },
      ]);
      setIsLoading(false);
    }
  };

  // Always render for smooth animations

  return (
    <div
      className={`fixed inset-y-0 right-0 w-[430px] bg-gradient-to-b from-white/5 via-white/10 to-white/5 backdrop-blur-3xl border-l border-white/10 shadow-2xl z-50 flex flex-col overflow-hidden transform transition-all duration-300 ease-in-out ${
        isOpen
          ? "translate-x-0 shadow-[-30px_0_60px_rgba(0,0,0,0.12)]"
          : "translate-x-full"
      }`}
    >
      {/* Animated Glass Pattern */}
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-gradient-to-br from-blue-400/20 via-purple-400/10 to-transparent rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute top-1/3 -right-8 w-32 h-32 bg-gradient-to-br from-purple-400/15 via-pink-400/10 to-transparent rounded-full blur-2xl animate-pulse delay-1000"></div>
        <div className="absolute bottom-1/4 -right-12 w-36 h-36 bg-gradient-to-br from-pink-400/20 via-blue-400/10 to-transparent rounded-full blur-3xl animate-pulse delay-2000"></div>
        <div className="absolute top-1/2 left-4 w-24 h-24 bg-gradient-to-br from-indigo-400/10 via-cyan-400/5 to-transparent rounded-full blur-xl animate-pulse delay-3000"></div>
      </div>
      {/* Header */}
      <div className="bg-white/5 backdrop-blur-xl px-4 py-3 border-b border-white/10 relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
              <Plane className="text-white" size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800 text-lg">
                Travel Assistant
              </h3>
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <div
                  className={`w-2 h-2 rounded-full animate-pulse ${
                    isConnected ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="font-medium">
                  {isConnected ? "Connected" : "Disconnected"}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100/60 rounded-lg transition-all duration-200 border border-gray-200/40 hover:border-gray-300/60 group"
          >
            <X className="w-4 h-4 text-gray-600 group-hover:text-gray-800" />
          </button>
        </div>

        {conversationId && (
          <div className="flex items-center gap-2 text-xs text-gray-600 mt-2 bg-gray-50/60 rounded-lg px-3 py-2 border border-gray-200/50">
            <MapPin size={12} className="text-blue-500" />
            <span className="font-mono text-xs">
              Session: {conversationId.slice(0, 8)}...
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 bg-transparent backdrop-blur-xl relative z-10">
        {messages.length === 0 ? (
          // Welcome Screen
          <div className="text-center py-4">
            {/* <div className="w-12 h-12 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-xl">
              <Plane className="text-white" size={14} />
            </div> */}
            <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent mb-4">
              Need help with your trip?
            </h3>
            <p className="text-gray-600 mb-8 text-sm leading-relaxed max-w-xs mx-auto">
              Ask me anything about your itinerary, get recommendations, or plan
              new activities.
            </p>
            <div className="space-y-3 text-left">
              <p className="text-xs font-bold text-gray-500 mb-4 uppercase tracking-wider text-center">
                Try asking:
              </p>
              <button
                onClick={() =>
                  handleSendMessage(
                    "What are some must-visit restaurants in this area?"
                  )
                }
                className="block w-full py-3 px-4 bg-white/10 backdrop-blur-xl rounded-xl text-left text-sm text-gray-700 hover:bg-white/20 transition-all duration-200 border border-white/20 hover:border-white/40 shadow-sm hover:shadow-md hover:scale-[1.02]"
              >
                "What are some must-visit restaurants in this area?"
              </button>
              <button
                onClick={() =>
                  handleSendMessage(
                    "Can you suggest alternative activities for Day 2?"
                  )
                }
                className="block w-full py-3 px-4 bg-white/10 backdrop-blur-xl rounded-xl text-left text-sm text-gray-700 hover:bg-white/20 transition-all duration-200 border border-white/20 hover:border-white/40 shadow-sm hover:shadow-md hover:scale-[1.02]"
              >
                "Can you suggest alternative activities for Day 2?"
              </button>
              <button
                onClick={() =>
                  handleSendMessage(
                    "What's the best way to get around this city?"
                  )
                }
                className="block w-full py-3 px-4 bg-white/10 backdrop-blur-xl rounded-xl text-left text-sm text-gray-700 hover:bg-white/20 transition-all duration-200 border border-white/20 hover:border-white/40 shadow-sm hover:shadow-md hover:scale-[1.02]"
              >
                "What's the best way to get around this city?"
              </button>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message, index) => (
              <MessageBubble
                key={index}
                role={message.role}
                content={message.content}
                timestamp={message.timestamp}
              />
            ))}
            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Message Input */}
      <div className="p-4 border-t border-white/10 bg-white/5 backdrop-blur-xl relative z-10">
        <div className="bg-white/15 backdrop-blur-2xl rounded-2xl border border-white/20 shadow-lg p-2 hover:shadow-xl transition-all duration-200 hover:bg-white/25">
          <MessageInput
            onSend={handleSendMessage}
            disabled={isLoading || !isConnected}
            placeholder={
              !isConnected ? "Connecting..." : "Ask about your trip..."
            }
          />
        </div>
      </div>
    </div>
  );
}
