/**
 * useBrand — consumes BrandContext (the per-organization theming axis).
 * Throws if used outside <BrandProvider>, matching useTheme's contract.
 */
import { useContext } from 'react';
import { BrandContext } from '../context/BrandContext';

export default function useBrand() {
  const context = useContext(BrandContext);
  if (!context) {
    throw new Error('useBrand must be used within a <BrandProvider>');
  }
  return context;
}
