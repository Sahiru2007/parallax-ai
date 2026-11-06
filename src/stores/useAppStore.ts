import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { demoExperiment } from '../mocks/experiment'
import type { Contract, FutureId, Screen } from '../types/experiment'

interface AppState {
  screen: Screen
  selectedFuture: FutureId
  preferredFuture: FutureId | null
  sidebarCollapsed: boolean
  activityOpen: boolean
  inspectorOpen: boolean
  commandOpen: boolean
  showGrid: boolean
  reduceMotion: boolean
  contracts: Contract[]
  navigate: (screen: Screen) => void
  selectFuture: (id: FutureId) => void
  setPreferredFuture: (id: FutureId) => void
  toggleSidebar: () => void
  toggleActivity: () => void
  toggleInspector: () => void
  setCommandOpen: (open: boolean) => void
  setShowGrid: (value: boolean) => void
  setReduceMotion: (value: boolean) => void
  updateContract: (id: string, changes: Partial<Pick<Contract, 'condition' | 'enabled'>>) => void
  resetPreferences: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      screen: 'explorer',
      selectedFuture: 'jwt',
      preferredFuture: null,
      sidebarCollapsed: false,
      activityOpen: true,
      inspectorOpen: !window.matchMedia('(max-width: 760px)').matches,
      commandOpen: false,
      showGrid: true,
      reduceMotion: false,
      contracts: structuredClone(demoExperiment.contracts),
      navigate: (screen) => set({ screen }),
      selectFuture: (selectedFuture) => set({ selectedFuture }),
      setPreferredFuture: (preferredFuture) => set({ preferredFuture }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      toggleActivity: () => set((state) => ({ activityOpen: !state.activityOpen })),
      toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setShowGrid: (showGrid) => set({ showGrid }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      updateContract: (id, changes) =>
        set((state) => ({
          contracts: state.contracts.map((item) =>
            item.id === id ? { ...item, ...changes } : item,
          ),
        })),
      resetPreferences: () =>
        set({
          showGrid: true,
          reduceMotion: false,
          sidebarCollapsed: false,
          preferredFuture: null,
          contracts: structuredClone(demoExperiment.contracts),
        }),
    }),
    {
      name: 'parallax-phase1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedFuture: state.selectedFuture,
        preferredFuture: state.preferredFuture,
        sidebarCollapsed: state.sidebarCollapsed,
        showGrid: state.showGrid,
        reduceMotion: state.reduceMotion,
        contracts: state.contracts,
      }),
    },
  ),
)
