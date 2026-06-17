import type { QualitySettings } from '@cosmos/core-types';
import { QUALITY_TIERS } from '@cosmos/core-types';
import { createContext, useContext, useEffect, useState } from 'react';
import type { QualityControllerImpl } from './quality.js';

export const QualityContext = createContext<QualityControllerImpl | null>(null);

/** Hook: current quality settings inside the Canvas tree. Re-renders only on tier change. */
export function useQuality(): QualitySettings {
  const qc = useContext(QualityContext);
  const [settings, setSettings] = useState<QualitySettings>(() => qc?.settings ?? QUALITY_TIERS.high);

  useEffect(() => {
    if (!qc) return;
    setSettings(qc.settings);
    return qc.onChange(setSettings);
  }, [qc]);

  return settings;
}
