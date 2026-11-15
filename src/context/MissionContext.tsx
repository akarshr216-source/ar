import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  computeIlluminationTimeline,
  computeLunarIllumination,
  type IlluminationWindowSummary,
  type LunarIlluminationState,
} from '../lib/lunarEphemeris';
import { GLOBAL_LAUNCH_FACILITIES, LUNAR_SITE_PRESETS } from '../lib/nasaCatalog';
import { DEFAULT_SCORING_WEIGHTS, evaluateLandingSite, type LandingSuitabilityAssessment } from '../lib/scoringEngine';
import {
  DEFAULT_ACCEPTANCE_CRITERIA,
  DEFAULT_FAULT_INJECTION,
  THREAT_LAB_SCENARIOS,
} from '../lib/threatDatabase';
import { evaluateLunaMissionSafety } from '../lib/safetyManager';
import type {
  AppPageId,
  AppSettings,
  LaunchFacility,
  LunarCoordinate,
  SavedCoordinate,
  SavedMission,
  TerrainAnalysisResult,
} from '../types/lunar';
import type {
  AcceptanceCriteriaConfig,
  EvaluatedThreat,
  FaultInjectionConfig,
  MissionSafetyReport,
  ThreatExperimentRun,
} from '../types/threats';

interface AppNotification {
  id: string;
  title: string;
  tone: 'info' | 'warning' | 'error' | 'success';
}

interface MissionContextValue {
  activePage: AppPageId;
  setActivePage: (page: AppPageId) => void;
  activeCoordinate: LunarCoordinate;
  selectCoordinate: (coord: LunarCoordinate) => void;
  analysisRadiusKm: number;
  setAnalysisRadiusKm: (r: number) => void;
  analysisDateIso: string;
  setAnalysisDateIso: (iso: string) => void;
  terrain: TerrainAnalysisResult | null;
  terrainLoading: boolean;
  terrainError: string | null;
  refreshTerrain: () => void;
  illuminationNow: LunarIlluminationState;
  illuminationTimeline: IlluminationWindowSummary;
  suitability: LandingSuitabilityAssessment | null;
  selectedFacility: LaunchFacility;
  setSelectedFacilityId: (id: string) => void;
  savedCoordinates: SavedCoordinate[];
  addSavedCoordinate: (coord: Omit<SavedCoordinate, 'id' | 'createdAtUtc'>) => Promise<void>;
  removeSavedCoordinate: (id: string) => Promise<void>;
  missions: SavedMission[];
  createMission: (mission: Omit<SavedMission, 'id' | 'createdAtUtc'>) => Promise<SavedMission | null>;
  removeMission: (id: string) => Promise<void>;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  aiDrawerOpen: boolean;
  setAiDrawerOpen: (open: boolean) => void;
  notifications: AppNotification[];
  pushNotification: (title: string, tone?: AppNotification['tone']) => void;
  dismissNotification: (id: string) => void;
  formatLon: (lon: number) => string;
  acceptanceCriteria: AcceptanceCriteriaConfig;
  setAcceptanceCriteria: React.Dispatch<React.SetStateAction<AcceptanceCriteriaConfig>>;
  faultInjection: FaultInjectionConfig;
  setFaultInjection: React.Dispatch<React.SetStateAction<FaultInjectionConfig>>;
  applyLabScenario: (scenarioId: string) => void;
  resetFaultInjection: () => void;
  safetyReport: MissionSafetyReport | null;
  experimentRuns: ThreatExperimentRun[];
  runThreatExperiment: (labelOverride?: string) => ThreatExperimentRun | null;
  replayExperiment: (run: ThreatExperimentRun) => void;
}

const MissionContext = createContext<MissionContextValue | null>(null);

const SETTINGS_STORAGE_KEY = 'arc-luna-settings-v1';

function loadInitialSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return {
        lightweightMode: Boolean(parsed.lightweightMode),
        lonFormat: parsed.lonFormat === 'east360' ? 'east360' : 'signed180',
        defaultRadiusKm: parsed.defaultRadiusKm ?? 30,
        defaultWeights: { ...DEFAULT_SCORING_WEIGHTS, ...(parsed.defaultWeights ?? {}) },
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    lightweightMode: false,
    lonFormat: 'signed180',
    defaultRadiusKm: 30,
    defaultWeights: DEFAULT_SCORING_WEIGHTS,
  };
}

export function MissionProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadInitialSettings);
  const [activePage, setActivePage] = useState<AppPageId>('command-center');
  const [activeCoordinate, setActiveCoordinate] = useState<LunarCoordinate>({
    lat: LUNAR_SITE_PRESETS[0].lat,
    lon: LUNAR_SITE_PRESETS[0].lon,
    label: LUNAR_SITE_PRESETS[0].label,
    region: LUNAR_SITE_PRESETS[0].region,
    source: LUNAR_SITE_PRESETS[0].source,
  });
  const [analysisRadiusKm, setAnalysisRadiusKm] = useState<number>(settings.defaultRadiusKm);
  const [analysisDateIso, setAnalysisDateIso] = useState<string>(() => new Date().toISOString());

  const [terrain, setTerrain] = useState<TerrainAnalysisResult | null>(null);
  const [terrainLoading, setTerrainLoading] = useState<boolean>(false);
  const [terrainError, setTerrainError] = useState<string | null>(null);

  const [selectedFacilityId, setSelectedFacilityId] = useState<string>(GLOBAL_LAUNCH_FACILITIES[0].id);
  const [savedCoordinates, setSavedCoordinates] = useState<SavedCoordinate[]>([]);
  const [missions, setMissions] = useState<SavedMission[]>([]);
  const [aiDrawerOpen, setAiDrawerOpen] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const [acceptanceCriteria, setAcceptanceCriteria] = useState<AcceptanceCriteriaConfig>(DEFAULT_ACCEPTANCE_CRITERIA);
  const [faultInjection, setFaultInjection] = useState<FaultInjectionConfig>(DEFAULT_FAULT_INJECTION);
  const [experimentRuns, setExperimentRuns] = useState<ThreatExperimentRun[]>([]);
  const historyMapRef = React.useRef<Record<string, EvaluatedThreat['history']>>({});

  const pushNotification = useCallback((title: string, tone: AppNotification['tone'] = 'info') => {
    const id = `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setNotifications((prev) => [{ id, title, tone }, ...prev].slice(0, 4));
    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4500);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const selectCoordinate = useCallback((coord: LunarCoordinate) => {
    const lat = Math.max(-90, Math.min(90, Number(coord.lat)));
    let lon = Number(coord.lon);
    lon = (((lon % 360) + 360) % 360);
    if (lon > 180) lon -= 360;
    setActiveCoordinate({
      ...coord,
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
    });
  }, []);

  const fetchTerrain = useCallback(async () => {
    setTerrainLoading(true);
    setTerrainError(null);
    try {
      const gridSize = settings.lightweightMode ? 25 : 33;
      const url = `/api/lola/analyze?lat=${activeCoordinate.lat}&lon=${activeCoordinate.lon}&radiusKm=${analysisRadiusKm}&gridSize=${gridSize}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'NASA DATA UNAVAILABLE');
      }
      setTerrain(data as TerrainAnalysisResult);
    } catch (err) {
      setTerrainError(err instanceof Error ? err.message : 'NASA DATA UNAVAILABLE');
      setTerrain(null);
    } finally {
      setTerrainLoading(false);
    }
  }, [activeCoordinate.lat, activeCoordinate.lon, analysisRadiusKm, settings.lightweightMode]);

  useEffect(() => {
    void fetchTerrain();
  }, [fetchTerrain]);

  useEffect(() => {
    void (async () => {
      try {
        const [coordRes, msnRes] = await Promise.all([
          fetch('/api/coordinates'),
          fetch('/api/missions'),
        ]);
        if (coordRes.ok) {
          const cData = (await coordRes.json()) as { coordinates: SavedCoordinate[] };
          setSavedCoordinates(cData.coordinates ?? []);
        }
        if (msnRes.ok) {
          const mData = (await msnRes.json()) as { missions: SavedMission[] };
          setMissions(mData.missions ?? []);
        }
      } catch {
        // silent initial fetch error
      }
    })();
  }, []);

  const addSavedCoordinate = useCallback(
    async (coord: Omit<SavedCoordinate, 'id' | 'createdAtUtc'>) => {
      const res = await fetch('/api/coordinates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coord),
      });
      if (res.ok) {
        const data = (await res.json()) as { coordinate: SavedCoordinate };
        setSavedCoordinates((prev) => [data.coordinate, ...prev]);
        pushNotification(`Saved lunar coordinate: ${data.coordinate.name}`, 'success');
      }
    },
    [pushNotification],
  );

  const removeSavedCoordinate = useCallback(async (id: string) => {
    const res = await fetch(`/api/coordinates/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      setSavedCoordinates((prev) => prev.filter((c) => c.id !== id));
    }
  }, []);

  const createMission = useCallback(
    async (mission: Omit<SavedMission, 'id' | 'createdAtUtc'>) => {
      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mission),
      });
      if (!res.ok) {
        pushNotification('Failed to save mission profile', 'error');
        return null;
      }
      const data = (await res.json()) as { mission: SavedMission };
      setMissions((prev) => [data.mission, ...prev]);
      pushNotification(`Mission saved: ${data.mission.name}`, 'success');
      return data.mission;
    },
    [pushNotification],
  );

  const removeMission = useCallback(async (id: string) => {
    const res = await fetch(`/api/missions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      setMissions((prev) => prev.filter((m) => m.id !== id));
      pushNotification('Mission profile removed', 'info');
    }
  }, [pushNotification]);

  const illuminationNow = useMemo(() => {
    const d = new Date(analysisDateIso);
    const validDate = Number.isNaN(d.getTime()) ? new Date() : d;
    return computeLunarIllumination(
      activeCoordinate.lat,
      activeCoordinate.lon,
      validDate,
      terrain?.horizonAnalysis.samples,
    );
  }, [activeCoordinate.lat, activeCoordinate.lon, analysisDateIso, terrain]);

  const illuminationTimeline = useMemo(() => {
    const d = new Date(analysisDateIso);
    const validDate = Number.isNaN(d.getTime()) ? new Date() : d;
    return computeIlluminationTimeline(
      activeCoordinate.lat,
      activeCoordinate.lon,
      validDate,
      30,
      terrain?.horizonAnalysis.samples,
    );
  }, [activeCoordinate.lat, activeCoordinate.lon, analysisDateIso, terrain]);

  const suitability = useMemo(() => {
    if (!terrain) return null;
    return evaluateLandingSite(terrain, illuminationTimeline, settings.defaultWeights);
  }, [terrain, illuminationTimeline, settings.defaultWeights]);

  const selectedFacility = useMemo(() => {
    return (
      GLOBAL_LAUNCH_FACILITIES.find((f) => f.id === selectedFacilityId) ??
      GLOBAL_LAUNCH_FACILITIES[0]
    );
  }, [selectedFacilityId]);

  const formatLon = useCallback(
    (lon: number) => {
      if (settings.lonFormat === 'east360') {
        const l360 = ((lon % 360) + 360) % 360;
        return `${l360.toFixed(3)}° E`;
      }
      return `${lon >= 0 ? '+' : ''}${lon.toFixed(3)}°`;
    },
    [settings.lonFormat],
  );

  const safetyReport = useMemo(() => {
    if (!terrain) return null;
    const report = evaluateLunaMissionSafety({
      coordinateLabel: activeCoordinate.label,
      terrain,
      illuminationNow,
      timeline: illuminationTimeline,
      facilityName: selectedFacility.shortName,
      earthMoonDistanceKm: illuminationNow.earthMoonDistanceKm,
      criteria: acceptanceCriteria,
      fault: faultInjection,
      previousHistoryMap: historyMapRef.current,
    });
    const nextHist: Record<string, EvaluatedThreat['history']> = {};
    for (const t of report.threats) nextHist[t.id] = t.history;
    historyMapRef.current = nextHist;
    return report;
  }, [
    terrain,
    activeCoordinate.label,
    illuminationNow,
    illuminationTimeline,
    selectedFacility.shortName,
    acceptanceCriteria,
    faultInjection,
  ]);

  const applyLabScenario = useCallback(
    (scenarioId: string) => {
      const found = THREAT_LAB_SCENARIOS.find((s) => s.id === scenarioId);
      if (!found) return;
      setFaultInjection({
        ...DEFAULT_FAULT_INJECTION,
        ...found.injection,
        scenarioId: found.id,
        scenarioName: found.name,
      });
      pushNotification(`Loaded Threat Lab scenario: ${found.name}`, 'info');
    },
    [pushNotification],
  );

  const resetFaultInjection = useCallback(() => {
    setFaultInjection(DEFAULT_FAULT_INJECTION);
    pushNotification('Reset fault injections to Nominal Live NASA Baseline', 'info');
  }, [pushNotification]);

  const runThreatExperiment = useCallback(
    (labelOverride?: string): ThreatExperimentRun | null => {
      if (!safetyReport) return null;
      const faultsList: string[] = [];
      if (faultInjection.active) {
        if (faultInjection.forceCraterHazard) faultsList.push('Crater Hazard');
        if (faultInjection.forceSteepSlopeDeg !== null) faultsList.push(`Slope ${faultInjection.forceSteepSlopeDeg}°`);
        if (faultInjection.forcePoorIlluminationDeg !== null) faultsList.push(`Solar ${faultInjection.forcePoorIlluminationDeg}°`);
        if (faultInjection.cameraFailure) faultsList.push('Camera Fail');
        if (faultInjection.cameraSaturation) faultsList.push('Camera Glare');
        if (faultInjection.altimeterFault) faultsList.push('Altimeter Fault');
        if (faultInjection.velocimeterDropout) faultsList.push('Doppler Loss');
        if (faultInjection.altimeterNoiseM > 5) faultsList.push(`Noise ${faultInjection.altimeterNoiseM}m`);
        if (faultInjection.thrustDegradationPct > 0) faultsList.push(`Thrust -${faultInjection.thrustDegradationPct}%`);
        if (faultInjection.legImbalanceCm > 0) faultsList.push(`Leg Step ${faultInjection.legImbalanceCm}cm`);
        if (faultInjection.rfBlackout) faultsList.push('RF Blackout');
        if (faultInjection.simulatedSpeRadiation) faultsList.push('Sim SPE');
        if (faultInjection.powerBusDegradationPct > 0) faultsList.push(`Power -${faultInjection.powerBusDegradationPct}%`);
      }

      const run: ThreatExperimentRun = {
        id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        runAtUtc: new Date().toISOString(),
        scenarioName: labelOverride ?? faultInjection.scenarioName,
        coordinateLabel: activeCoordinate.label,
        lat: activeCoordinate.lat,
        lon: activeCoordinate.lon,
        injectedFaultsSummary: faultsList.length > 0 ? faultsList.join(', ') : 'None (Live NASA Baseline)',
        controllerProfile: faultInjection.controllerProfile,
        outcome: safetyReport.simulationOutcome,
        mitigatedCount: safetyReport.counts.mitigated,
        unresolvedCount: safetyReport.counts.unresolved,
        abortCount: safetyReport.counts.abortRequired,
        navConfidence: safetyReport.subsystems.navigation.navConfidence,
        safestPadSlopeDeg: safetyReport.subsystems.terrain.safestPadSlopeDeg,
        touchdownTiltDeg: safetyReport.subsystems.structural.estimatedTiltDeg,
        reportSnapshot: safetyReport,
      };
      setExperimentRuns((prev) => [run, ...prev].slice(0, 20));
      pushNotification(`Recorded Threat Experiment: ${run.scenarioName}`, 'success');
      return run;
    },
    [safetyReport, faultInjection, activeCoordinate, pushNotification],
  );

  const replayExperiment = useCallback(
    (run: ThreatExperimentRun) => {
      const matchingScenario = THREAT_LAB_SCENARIOS.find((s) => s.name === run.scenarioName);
      selectCoordinate({
        lat: run.lat,
        lon: run.lon,
        label: run.coordinateLabel,
        region: 'Experiment Replay',
        source: 'Threat Testing Lab Replay',
      });
      if (matchingScenario) {
        setFaultInjection({
          ...DEFAULT_FAULT_INJECTION,
          ...matchingScenario.injection,
          scenarioId: matchingScenario.id,
          scenarioName: matchingScenario.name,
          controllerProfile: run.controllerProfile,
        });
      }
      pushNotification(`Replaying experiment: ${run.scenarioName}`, 'info');
    },
    [selectCoordinate, pushNotification],
  );

  const value: MissionContextValue = {
    activePage,
    setActivePage,
    activeCoordinate,
    selectCoordinate,
    analysisRadiusKm,
    setAnalysisRadiusKm,
    analysisDateIso,
    setAnalysisDateIso,
    terrain,
    terrainLoading,
    terrainError,
    refreshTerrain: fetchTerrain,
    illuminationNow,
    illuminationTimeline,
    suitability,
    selectedFacility,
    setSelectedFacilityId,
    savedCoordinates,
    addSavedCoordinate,
    removeSavedCoordinate,
    missions,
    createMission,
    removeMission,
    settings,
    updateSettings,
    aiDrawerOpen,
    setAiDrawerOpen,
    notifications,
    pushNotification,
    dismissNotification,
    formatLon,
    acceptanceCriteria,
    setAcceptanceCriteria,
    faultInjection,
    setFaultInjection,
    applyLabScenario,
    resetFaultInjection,
    safetyReport,
    experimentRuns,
    runThreatExperiment,
    replayExperiment,
  };

  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}

export function useMission() {
  const ctx = useContext(MissionContext);
  if (!ctx) throw new Error('useMission must be used inside MissionProvider');
  return ctx;
}
