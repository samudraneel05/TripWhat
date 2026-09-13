import { create } from 'zustand';

interface UIStore {
  sidebarCollapsed: boolean;
  activeTab: 'plan' | 'saved' | 'bookings';
  cityFilter: string | null;
  planViewMode: 'overview' | 'day-by-day';
  selectedDay: number | null;

  toggleSidebarCollapse: () => void;
  setActiveTab: (tab: 'plan' | 'saved' | 'bookings') => void;
  setCityFilter: (city: string | null) => void;
  setPlanViewMode: (mode: 'overview' | 'day-by-day') => void;
  setSelectedDay: (day: number | null) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarCollapsed: false,
  activeTab: 'plan',
  cityFilter: null,
  planViewMode: 'overview',
  selectedDay: null,

  toggleSidebarCollapse: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setCityFilter: (city) => set({ cityFilter: city }),
  setPlanViewMode: (mode) => set({ planViewMode: mode, selectedDay: mode === 'overview' ? null : 1 }),
  setSelectedDay: (day) => set({ selectedDay: day }),
}));
