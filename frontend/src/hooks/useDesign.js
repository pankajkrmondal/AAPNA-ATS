/**
 * useDesign — Convenience hook for consuming DesignContext (preset, font pack,
 * density). Throws if used outside of <DesignProvider>.
 */
import { useContext } from 'react';
import { DesignContext } from '../context/DesignContext';

export default function useDesign() {
  const context = useContext(DesignContext);
  if (!context) {
    throw new Error('useDesign must be used within a <DesignProvider>');
  }
  return context;
}
