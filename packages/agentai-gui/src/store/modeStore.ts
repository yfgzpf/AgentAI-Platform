import { create } from 'zustand';

export type AppMode = 'readonly' | 'planning' | 'auto';

interface ModeState {
  mode: AppMode;
  setMode: (m: AppMode) => void;
}

export const useModeStore = create<ModeState>((set) => ({
  mode: 'auto',
  setMode: (mode) => set({ mode }),
}));
