import { create } from 'zustand';
import { savedApi } from '../lib/api';

interface SavedItem {
  id: number;
  itemType: string; // hotel | flight | place | restaurant
  name: string;
  data: any;
  tripId?: number;
  createdAt?: string;
}

interface SavedStore {
  items: SavedItem[];
  loading: boolean;
  fetchItems: () => Promise<void>;
  saveItem: (itemType: string, name: string, data?: any, tripId?: number) => Promise<void>;
  removeItem: (id: number) => Promise<void>;
  isSaved: (itemType: string, name: string) => boolean;
}

export const useSavedStore = create<SavedStore>((set, get) => ({
  items: [],
  loading: false,

  fetchItems: async () => {
    set({ loading: true });
    try {
      const res = await savedApi.list();
      set({ items: res.data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  saveItem: async (itemType, name, data, tripId) => {
    try {
      const res = await savedApi.save({ itemType, name, data, tripId });
      set({ items: [res.data, ...get().items] });
    } catch (e) {
      console.error('Failed to save item:', e);
    }
  },

  removeItem: async (id) => {
    try {
      await savedApi.remove(id);
      set({ items: get().items.filter((i) => i.id !== id) });
    } catch (e) {
      console.error('Failed to remove item:', e);
    }
  },

  isSaved: (itemType, name) => {
    return get().items.some((i) => i.itemType === itemType && i.name === name);
  },
}));
