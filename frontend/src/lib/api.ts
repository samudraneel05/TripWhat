import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('tripwhat_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('tripwhat_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export { api };

export const authApi = {
  updateProfile: (data: any) => api.put('/api/auth/profile', data),
};

export const chatApi = {
  sendMessage: (data: { message: string; conversationId?: string }) =>
    api.post('/api/chat', data),
  getHistory: (conversationId: string) =>
    api.get(`/api/chat/${conversationId}`),
  getStreamEvents: (conversationId: string, after?: string) =>
    api.get(`/api/chat/stream/${conversationId}`, { params: { after: after || '0' } }),
};

export const tripsApi = {
  statistics: () => api.get('/api/saved-trips/statistics'),
};

export const savedApi = {
  list: () => api.get('/api/saved'),
  save: (data: { itemType: string; name: string; data?: any; tripId?: number }) =>
    api.post('/api/saved', data),
  remove: (id: number) => api.delete(`/api/saved/${id}`),
};

export const placesApi = {
  search: (query: string, limit = 5) =>
    api.get('/api/places/search', { params: { query, limit } }),
  details: (placeId: string) =>
    api.get('/api/places/details', { params: { placeId } }),
};

export const itineraryEditApi = {
  add: (conversationId: string, data: { place_name: string; city: string; day: number; time_slot?: string }) =>
    api.post(`/api/chat/${conversationId}/itinerary/add`, data),
  remove: (conversationId: string, data: { day: number; activity_id: string }) =>
    api.post(`/api/chat/${conversationId}/itinerary/remove`, data),
  editTime: (conversationId: string, data: { day: number; slot_id: string; start_time: string; end_time: string }) =>
    api.post(`/api/chat/${conversationId}/itinerary/edit-time`, data),
  caption: (conversationId: string, data: { day: number; activity_id: string; caption: string }) =>
    api.post(`/api/chat/${conversationId}/itinerary/caption`, data),
  move: (conversationId: string, data: { from_day: number; activity_id: string; to_day: number; to_slot?: string }) =>
    api.post(`/api/chat/${conversationId}/itinerary/move`, data),
};

export const gmailApi = {
  oauthUrl: () => api.get('/api/google/gmail/oauth/url'),
  status: () => api.get('/api/google/gmail/status'),
  bookings: () => api.get('/api/google/gmail/bookings'),
  disconnect: () => api.post('/api/google/gmail/disconnect'),
  importBooking: (tripId: string | number, booking: any) =>
    api.post(`/api/saved-trips/${tripId}/import-booking`, { booking }),
};
