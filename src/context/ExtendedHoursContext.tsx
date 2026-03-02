import { createContext, useContext, useState, type ReactNode } from 'react';

interface ExtendedHoursContextType {
  showExtendedHours: boolean;
  toggleExtendedHours: () => void;
}

const ExtendedHoursContext = createContext<ExtendedHoursContextType | undefined>(undefined);

const STORAGE_KEY = 'foliotracker-extended-hours';

export function ExtendedHoursProvider({ children }: { children: ReactNode }) {
  const [showExtendedHours, setShowExtendedHours] = useState<boolean>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'true';
  });

  const toggleExtendedHours = () => {
    setShowExtendedHours((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  return (
    <ExtendedHoursContext.Provider value={{ showExtendedHours, toggleExtendedHours }}>
      {children}
    </ExtendedHoursContext.Provider>
  );
}

export function useExtendedHours() {
  const context = useContext(ExtendedHoursContext);
  if (!context) {
    throw new Error('useExtendedHours must be used within an ExtendedHoursProvider');
  }
  return context;
}
