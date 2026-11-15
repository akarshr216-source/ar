import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  AlertOctagon,
  Camera,
  ShieldCheck,
  ShieldAlert,
  Rocket,
  CheckCircle2,
  ArrowRight,
  Shuffle,
  Sun,
  Gauge,
  Compass,
  Clock,
  MousePointerClick,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { CoordinateSelectorBar } from '../components/shared/CoordinateSelectorBar';
import { ProvenanceBar } from '../components/shared/ProvenanceBar';
import { EarthMoonTransitViewport3D } from '../components/three/EarthMoonTransitViewport3D';
import { LandingSimViewport3D, type SimTelemetryFrame } from '../components/three/LandingSimViewport3D';
import { RealCameraScanner } from '../components/simulation/RealCameraScanner';
import { GLOBAL_LAUNCH_FACILITIES, LUNAR_SITE_PRESETS } from '../lib/nasaCatalog';
import { computeEducationalMissionMechanics } from '../lib/orbitalMechanics';
import { computeIlluminationTimeline, formatTimeInZone } from '../lib/lunarEphemeris';
import {
  generateRandomCraterTestField,
  runLolaThreatScan,
  type RandomizedTestField,
} from '../lib/threatDetection';

const APOLLO_11_TIMELINE = [
  { met: '000:00:00', phase: 'Saturn V Liftoff — KSC LC-39A', note: 'July 16, 1969 13:32:00 UTC · 28.5729° N, 80.6490° W.' },
  { met: '002:44:16', phase: 'Trans-Lunar Injection (TLI)', note: 'S-IVB third stage burn injecting Apollo 11 onto lunar free-return trajectory.' },
  { met: '075:49:50', phase: 'Lunar Orbit Insertion (LOI-1)', note: 'SPS burn behind lunar farside entering 111 × 313 km lunar orbit.' },
  { met: '102:33:05', phase: 'Powered Descent Initiation (PDI)', note: 'Descent engine ignition at ~50,000 ft toward Mare Tranquillitatis.' },
  { met: '102:44:10', phase: 'Boulder Crater Hazard Avoidance', note: 'Manual attitude hover past West Crater boulder field (Program Alarm 1202 cleared).' },
  { met: '102:45:40', phase: 'Contact Light — Tranquility Base', note: 'Confirmed Eagle safe touchdown at 0.67408° N, 23.47297° E (LRO NAC verified).' },
];

type TransitStage = 'STANDBY' | 'LAUNCH_TLI' | 'TRANSLUNAR_COAST' | 'LOI_INSERTION' | 'POWERED_DESCENT';

export function LandingSimulatorPage() {
  const {
    activeCoordinate,
    selectCoordinate,
    terrain,
    illuminationNow,
    selectedFacility,
    setSelectedFacilityId,
    setAnalysisDateIso,
    settings,
    formatLon,
    safetyReport,
    setActivePage,
    pushNotification,
  } = useMission();

  const [mode, setMode] = useState<'manual' | 'assisted' | 'autonomous'>('autonomous');
  const [running, setRunning] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [apolloMode, setApolloMode] = useState(false);
  const [sampleImageMode, setSampleImageMode] = useState<'live-sim-nadir' | 'sample-crater-test'>('live-sim-nadir');

  // Viewport & launch backdrop controls
  const [viewportTab, setViewportTab] = useState<'auto' | 'earth-moon' | 'lunar-descent'>('auto');
  const [greenLaunchBackdrop, setGreenLaunchBackdrop] = useState<boolean>(true);
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 5 | 10 | 20>(1);
  const [autoLandingBoost, setAutoLandingBoost] = useState<boolean>(true);

  // Interactive left-click coordinate controls
  const [terrainClickAction, setTerrainClickAction] = useState<'move-target-pin' | 'relocate-corridor'>('move-target-pin');
  const [targetOverride, setTargetOverride] = useState<{ x: number; z: number; lat: number; lon: number } | null>(null);
  const [customEarthOrigin, setCustomEarthOrigin] = useState<{ lat: number; lon: number } | null>(null);

  // Randomized Crater & Target mode (<= 100m escape)
  const [randomTestField, setRandomTestField] = useState<RandomizedTestField | null>(null);

  // Live 1s station clock
  const [nowIso, setNowIso] = useState<string>(() => new Date().toISOString());
  useEffect(() => {
    const id = window.setInterval(() => setNowIso(new Date().toISOString()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Peak Sunlight South Pole Recommendation banner triggered on launch
  const [launchPeakRec, setLaunchPeakRec] = useState<{
    peakDateUtc: string;
    maxSolarElevationDeg: number;
    recommendedLaunchLocal: string;
    tzName: string;
    stationName: string;
  } | null>(null);

  // End-to-End Earth-to-Moon Transit Sequencer state
  const [transitStage, setTransitStage] = useState<TransitStage>('STANDBY');
  const [transitPct, setTransitPct] = useState<number>(0);

  const [manualInput, setManualInput] = useState({ throttleDelta: 0, pitchX: 0, rollZ: 0 });
  const [telemetry, setTelemetry] = useState<SimTelemetryFrame>({
    simTimeSec: 0,
    altitudeM: 900,
    verticalVelMS: -22,
    horizontalVelMS: 3.0,
    totalSpeedMS: 22.2,
    initialVelMS: 22.2,
    accelerationMS2: 0,
    throttlePct: 44,
    distanceFromTargetM: 320,
    offsetNorthM: 210,
    offsetEastM: 240,
    predictedLat: activeCoordinate.lat,
    predictedLon: activeCoordinate.lon,
    lolaElevationM: Math.round(terrain?.centerElevationM ?? 0),
    nearestCraterDepthM: terrain?.detectedCraters[0]?.depthM ?? null,
    nearestCraterClearanceM: 450,
    localSlopeDeg: terrain?.slopeStats.meanDeg ?? 0,
    phase: 'IDLE',
    hazardStatus: 'Ready for simulated descent · Rover stowed in bay',
    divertActive: false,
    selectedPadSlopeDeg: terrain?.slopeStats.meanDeg ?? 0,
    initialThreatCredits: 28,
    remainingThreatCredits: 28,
    landingStepIndex: 0,
    landingSteps: [],
    roverStatus: 'STOWED_IN_BAY',
    roverHeadingDeg: 90,
    effectiveSpeedX: 1,
  });

  const cameraCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const stationClock = useMemo(
    () => formatTimeInZone(nowIso, selectedFacility.timeZone),
    [nowIso, selectedFacility.timeZone],
  );

  const effectiveEarthLat = customEarthOrigin ? customEarthOrigin.lat : selectedFacility.lat;
  const effectiveEarthLon = customEarthOrigin ? customEarthOrigin.lon : selectedFacility.lon;

  const transferMechanics = useMemo(
    () =>
      computeEducationalMissionMechanics({
        earthMoonDistanceKm: illuminationNow.earthMoonDistanceKm,
        launchLatDeg: effectiveEarthLat,
        earthParkingAltKm: 200,
        lunarOrbitAltKm: 100,
      }),
    [illuminationNow.earthMoonDistanceKm, effectiveEarthLat],
  );

  const threatScan = useMemo(
    () => (terrain ? runLolaThreatScan(terrain, illuminationNow.solarElevationDeg, randomTestField, targetOverride) : null),
    [terrain, illuminationNow.solarElevationDeg, randomTestField, targetOverride],
  );

  const computeAndShowPeakRecommendation = () => {
    const summary = computeIlluminationTimeline(-89.54, 0, new Date(), 30);
    const peakUtc = summary.peakSunlightUtc ?? new Date().toISOString();
    const transitMs = transferMechanics.transferDurationHours * 3600_000;
    const recLaunchIso = new Date(new Date(peakUtc).getTime() - transitMs).toISOString();
    const localRec = formatTimeInZone(recLaunchIso, selectedFacility.timeZone);
    setLaunchPeakRec({
      peakDateUtc: peakUtc,
      maxSolarElevationDeg: summary.maxSolarElevationDeg,
      recommendedLaunchLocal: localRec.localTime,
      tzName: localRec.tzName,
      stationName: customEarthOrigin
        ? `Earth (${customEarthOrigin.lat.toFixed(2)}°, ${customEarthOrigin.lon.toFixed(2)}°)`
        : selectedFacility.shortName,
    });
  };

  useEffect(() => {
    if (transitStage === 'STANDBY' || transitStage === 'POWERED_DESCENT') return;
    const step = Math.max(2, Math.min(8, Math.round(2.5 * Math.min(4, speedMultiplier))));
    const id = window.setInterval(() => {
      setTransitPct((prev) => {
        const next = Math.min(100, prev + step);
        if (next < 28) setTransitStage('LAUNCH_TLI');
        else if (next < 80) setTransitStage('TRANSLUNAR_COAST');
        else if (next < 100) setTransitStage('LOI_INSERTION');
        else {
          setTransitStage('POWERED_DESCENT');
          setRunning(true);
        }
        return next;
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [transitStage, speedMultiplier]);

  const launchFullEarthToMoonMission = (apolloPreset = false) => {
    if (apolloPreset) {
      setCustomEarthOrigin(null);
      setSelectedFacilityId('ksc-lc39a');
      const apollo = LUNAR_SITE_PRESETS.find((p) => p.id === 'apollo-11');
      if (apollo) {
        selectCoordinate({
          lat: apollo.lat,
          lon: apollo.lon,
          label: apollo.label,
          region: apollo.region,
          source: apollo.source,
        });
      }
      setApolloMode(true);
    } else {
      setApolloMode(false);
    }
    computeAndShowPeakRecommendation();
    setMode('autonomous');
    setViewportTab('auto');
    setRunning(false);
    setResetSignal((s) => s + 1);
    setTransitPct(2);
    setTransitStage('LAUNCH_TLI');
  };

  const startDirectDescent = () => {
    computeAndShowPeakRecommendation();
    setTransitPct(100);
    setTransitStage('POWERED_DESCENT');
    setViewportTab('auto');
    setRunning(true);
  };

  const resetAll = () => {
    setRunning(false);
    setTransitPct(0);
    setTransitStage('STANDBY');
    setResetSignal((s) => s + 1);
  };

  const handleRandomizeCraters = () => {
    if (!terrain) return;
    const field = generateRandomCraterTestField(terrain, Date.now(), 100);
    setTargetOverride(null);
    setRandomTestField(field);
    setMode('autonomous');
    setTransitPct(100);
    setTransitStage('POWERED_DESCENT');
    setViewportTab('lunar-descent');
    setResetSignal((s) => s + 1);
    setRunning(true);
    pushNotification(
      `Generated ${field.extraCraters.length} extra craters & randomized landing target (<=100 m threat escape active)`,
      'info',
    );
  };

  const handleMapClickTerrain = (info: { x: number; z: number; lat: number; lon: number }) => {
    if (terrainClickAction === 'relocate-corridor') {
      setTargetOverride(null);
      selectCoordinate({
        lat: info.lat,
        lon: info.lon,
        label: `Map Target (${info.lat.toFixed(3)}°, ${info.lon.toFixed(3)}°)`,
        region: activeCoordinate.region || 'Custom Map Click',
        source: 'LOLA 3D Map Left-Click',
      });
      pushNotification(`Corridor relocated to ${info.lat.toFixed(4)}°, ${formatLon(info.lon)}`, 'info');
    } else {
      setTargetOverride(info);
      pushNotification(`Target pin moved on map to ${info.lat.toFixed(4)}°, ${formatLon(info.lon)}`, 'info');
    }
  };

  const showingEarthMoon3D =
    viewportTab === 'earth-moon' ||
    (viewportTab === 'auto' && transitStage !== 'STANDBY' && transitStage !== 'POWERED_DESCENT');

  const currentDistanceCoveredKm = Math.round((transitPct / 100) * transferMechanics.earthMoonDistanceKm);

  const baselineTargetSlope = useMemo(() => {
    if (!terrain || !threatScan) return 0;
    const n = terrain.gridSize;
    const u = Math.max(0, Math.min(1, (threatScan.targetPoint.x + 20) / 40)) * (n - 1);
    const v = Math.max(0, Math.min(1, (threatScan.targetPoint.z + 20) / 40)) * (n - 1);
    return Number(terrain.slopeGrid[Math.round(v)][Math.round(u)].toFixed(2));
  }, [terrain, threatScan]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-100">
            Earth-to-Moon Transit, Safe Landing &amp; Rover Egress Simulator
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Official NASA 3D Earth &amp; Moon models (exact 3.67:1 ratio, 3.84 km scaled span), surface space stations including Null Island (0°,0°), 3-stage separation, LOLA threat escape, and left-click map coordinate control.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => launchFullEarthToMoonMission(true)}
            className={`px-3 py-2 text-xs font-medium rounded-md border inline-flex items-center gap-1.5 cursor-pointer ${
              apolloMode
                ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                : 'bg-[#0D121C] border-amber-700/70 hover:border-amber-400 text-amber-200'
            }`}
          >
            <Rocket className="w-3.5 h-3.5" />
            Run Safe Apollo 11 Mission
          </button>

          <button
            type="button"
            onClick={() => launchFullEarthToMoonMission(false)}
            className="px-3.5 py-2 text-xs font-medium rounded-md bg-cyan-600 hover:bg-cyan-500 text-slate-950 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Rocket className="w-3.5 h-3.5" />
            Launch Simulation
          </button>

          <button
            type="button"
            onClick={handleRandomizeCraters}
            className="px-3 py-2 text-xs font-medium rounded-md bg-violet-600/20 hover:bg-violet-600/30 border border-violet-600/80 text-violet-200 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Shuffle className="w-3.5 h-3.5" />
            Randomize Craters &amp; Target (100 m Escape)
          </button>
        </div>
      </div>

      {/* South Pole Peak Sunlight Recommendation (Displayed on Launch) */}
      {launchPeakRec && (
        <div className="bg-amber-950/25 border border-amber-700/70 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <Sun className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-amber-200">
                South Pole Peak Sunlight Landing &amp; Launch Recommendation
              </div>
              <div className="text-[11px] font-mono text-slate-200 mt-0.5 tabular-nums">
                Optimal Landing Window: <strong className="text-amber-300">{launchPeakRec.peakDateUtc.replace('T', ' ').slice(0, 16)} UTC</strong> (Peak Solar {launchPeakRec.maxSolarElevationDeg.toFixed(2)}°) ·
                Recommended {launchPeakRec.stationName} Liftoff: <strong className="text-cyan-300">{launchPeakRec.recommendedLaunchLocal} ({launchPeakRec.tzName})</strong>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAnalysisDateIso(launchPeakRec.peakDateUtc);
                pushNotification(`Scheduled simulation clock to South Pole peak sunlight (${launchPeakRec.peakDateUtc.slice(0, 10)})`, 'success');
              }}
              className="px-3 py-1 text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium rounded cursor-pointer"
            >
              Schedule Peak Sunlight Day
            </button>
            <button
              type="button"
              onClick={() => setLaunchPeakRec(null)}
              className="px-2 py-1 text-xs border border-slate-700 text-slate-300 rounded cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Surface Station Origin & Destination Matrix */}
      <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
          <div className="lg:col-span-5 space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">
              1. Origin Earth Surface Space Station (or Left-Click Earth 3D Globe)
            </label>
            <select
              value={selectedFacility.id}
              onChange={(e) => {
                setCustomEarthOrigin(null);
                setSelectedFacilityId(e.target.value);
              }}
              className="w-full bg-[#07090E] border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              {GLOBAL_LAUNCH_FACILITIES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.shortName} · ({f.lat.toFixed(2)}°, {f.lon.toFixed(2)}°) · {f.cityLabel}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-mono text-slate-400 tabular-nums">
              {customEarthOrigin ? (
                <span className="text-emerald-300">
                  Custom Earth Click: ({customEarthOrigin.lat.toFixed(3)}°, {customEarthOrigin.lon.toFixed(3)}°)
                  <button
                    type="button"
                    onClick={() => setCustomEarthOrigin(null)}
                    className="ml-2 underline text-slate-300 cursor-pointer"
                  >
                    Use Station
                  </button>
                </span>
              ) : (
                <span>Operator: {selectedFacility.operator}</span>
              )}
              <span className="text-cyan-300 inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {stationClock.localTime} ({stationClock.tzName})
              </span>
            </div>
          </div>

          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono tabular-nums">
            <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
              <div className="text-[10px] font-sans text-slate-400">TLI Δv (Derived)</div>
              <div className="text-sm font-semibold text-cyan-300">{transferMechanics.tliDeltaVKmS} km/s</div>
            </div>
            <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
              <div className="text-[10px] font-sans text-slate-400">Hohmann Transit</div>
              <div className="text-sm font-semibold text-slate-100">{transferMechanics.transferDurationHours} h</div>
            </div>
            <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
              <div className="text-[10px] font-sans text-slate-400">LOI Capture Δv</div>
              <div className="text-sm font-semibold text-slate-100">{transferMechanics.loiDeltaVKmS} km/s</div>
            </div>
            <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
              <div className="text-[10px] font-sans text-slate-400">Total Ref. Δv</div>
              <div className="text-sm font-semibold text-amber-300">{transferMechanics.totalReferenceDeltaVKmS} km/s</div>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-slate-300">
              2. Destination Lunar Coordinate (Presets, Inputs, or Left-Click 3D Map)
            </span>
            {targetOverride && (
              <span className="text-[11px] font-mono text-emerald-300">
                Map Target Pin: {targetOverride.lat.toFixed(4)}°, {formatLon(targetOverride.lon)}
                <button
                  type="button"
                  onClick={() => setTargetOverride(null)}
                  className="ml-2 underline text-slate-300 cursor-pointer"
                >
                  Reset Pin
                </button>
              </span>
            )}
          </div>
          <CoordinateSelectorBar compact />
        </div>

        {/* End-to-End Mission Phase Progress Pipeline */}
        <div className="pt-2 border-t border-slate-800 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
            <span className="text-slate-300">
              Corridor:{' '}
              <strong className="text-emerald-300">
                {customEarthOrigin
                  ? `Earth (${effectiveEarthLat.toFixed(2)}°, ${effectiveEarthLon.toFixed(2)}°)`
                  : selectedFacility.shortName}
              </strong>{' '}
              ({effectiveEarthLat.toFixed(2)}°, {effectiveEarthLon.toFixed(2)}°) →{' '}
              <strong className="text-cyan-300">{activeCoordinate.label}</strong> (
              {(targetOverride?.lat ?? activeCoordinate.lat).toFixed(3)}°,{' '}
              {formatLon(targetOverride?.lon ?? activeCoordinate.lon)})
            </span>
            <span className="text-amber-300">
              Transit: {currentDistanceCoveredKm.toLocaleString()} / {transferMechanics.earthMoonDistanceKm.toLocaleString()} km ({transitPct}%)
            </span>
          </div>

          <div className="w-full h-2 bg-[#07090E] border border-slate-800 rounded overflow-hidden">
            <div
              className="h-full bg-cyan-500 transition-all duration-150"
              style={{ width: `${transitPct}%` }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] font-mono">
            {[
              { key: 'LAUNCH_TLI', label: '1. Launch / 3-Stage Sep', active: transitStage === 'LAUNCH_TLI', done: transitPct >= 28 },
              { key: 'TRANSLUNAR_COAST', label: '2. Trans-Lunar Coast', active: transitStage === 'TRANSLUNAR_COAST', done: transitPct >= 80 },
              { key: 'LOI_INSERTION', label: '3. LOI (100 km Orbit)', active: transitStage === 'LOI_INSERTION', done: transitPct >= 100 },
              {
                key: 'THREAT_SCAN',
                label: '4. LOLA Threat Escape',
                active: transitStage === 'POWERED_DESCENT' && telemetry.phase !== 'LANDED' && telemetry.phase !== 'ABORTED',
                done: telemetry.phase === 'LANDED',
              },
              {
                key: 'TOUCHDOWN',
                label:
                  telemetry.phase === 'ABORTED'
                    ? '5. Safety Abort'
                    : telemetry.phase === 'LANDED'
                      ? '5. Landed + Rover Egress'
                      : '5. Touchdown & Rover',
                active: telemetry.phase === 'LANDED' || telemetry.phase === 'ABORTED',
                done: telemetry.roverStatus === 'SURFACE_PATROL',
              },
            ].map((step) => (
              <div
                key={step.key}
                className={`px-2.5 py-1.5 rounded border flex items-center justify-between gap-1 ${
                  step.done && !step.active
                    ? 'bg-emerald-950/30 border-emerald-800/70 text-emerald-300'
                    : step.active
                      ? 'bg-cyan-950/40 border-cyan-500 text-cyan-200 font-semibold'
                      : 'bg-[#07090E] border-slate-800 text-slate-500'
                }`}
              >
                <span className="truncate">{step.label}</span>
                {step.done && <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-400" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live Intelligence Modules Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs font-mono tabular-nums">
        <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] font-sans text-slate-400">Terrain Slope</div>
          <div className="text-sm font-semibold text-slate-100 mt-0.5">{telemetry.localSlopeDeg}°</div>
          <div className="text-[10px] text-slate-500">Pad Target: {telemetry.selectedPadSlopeDeg}°</div>
        </div>
        <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] font-sans text-slate-400">LOLA Elevation</div>
          <div className="text-sm font-semibold text-cyan-300 mt-0.5">{telemetry.lolaElevationM} m</div>
          <div className="text-[10px] text-slate-500">LDEM_16 datum</div>
        </div>
        <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] font-sans text-slate-400">Nearest Crater Depth</div>
          <div className="text-sm font-semibold text-amber-300 mt-0.5">
            {telemetry.nearestCraterDepthM !== null ? `${telemetry.nearestCraterDepthM} m` : 'None nearby'}
          </div>
          <div className="text-[10px] text-slate-500">Clearance: {telemetry.nearestCraterClearanceM} m</div>
        </div>
        <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] font-sans text-slate-400">Threat Credits Left</div>
          <div className="text-sm font-semibold text-emerald-300 mt-0.5">
            {telemetry.remainingThreatCredits} / {telemetry.initialThreatCredits}
          </div>
          <div className="text-[10px] text-slate-500">T01–T58 mitigated</div>
        </div>
        <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] font-sans text-slate-400">Solar Visibility</div>
          <div className="text-sm font-semibold text-slate-100 mt-0.5">
            {illuminationNow.solarElevationDeg.toFixed(1)}°
          </div>
          <div className="text-[10px] text-slate-500">
            {illuminationNow.sunlitTerrain ? 'Sunlit Zone' : 'Shadow Caution'}
          </div>
        </div>
        <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-3">
          <div className="text-[10px] font-sans text-slate-400 flex items-center gap-1">
            <Compass className="w-3 h-3 text-cyan-400" />
            Rover Dispatch Vector
          </div>
          <div className="text-sm font-semibold text-cyan-300 mt-0.5">{telemetry.roverHeadingDeg}° Az</div>
          <div className="text-[10px] text-slate-400 truncate">{telemetry.roverStatus.replace(/_/g, ' ')}</div>
        </div>
      </div>

      {threatScan && !threatScan.safestPad.safe && (
        <div className="bg-rose-950/50 border border-rose-700 rounded-md px-4 py-3 text-xs text-rose-200 flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
          <span>
            Critical Terrain Hazard: No verified safe landing pad (&lt;=16° slope) exists inside the LOLA approach corridor (minimum found {threatScan.safestPad.slopeDeg}°). Autonomous Threat Detection will command an abort.
          </span>
        </div>
      )}

      {safetyReport && (
        <div
          className={`rounded-md px-4 py-3 border text-xs flex flex-wrap items-center justify-between gap-3 ${
            safetyReport.canClaimLandingSuccess
              ? 'bg-emerald-950/25 border-emerald-800/70 text-emerald-200'
              : 'bg-rose-950/40 border-rose-700 text-rose-200'
          }`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <ShieldAlert className={`w-4 h-4 shrink-0 mt-0.5 ${safetyReport.canClaimLandingSuccess ? 'text-emerald-400' : 'text-rose-400'}`} />
            <div>
              <div className="font-mono font-semibold">
                LUNA SAFETY MANAGER (T01–T58): {safetyReport.simulationOutcome}
                {!safetyReport.canClaimLandingSuccess ? ' — LANDING SUCCESS CLAIM BLOCKED' : ' — VERIFICATION CRITERIA SATISFIED'}
              </div>
              <div className="text-[11px] opacity-90 mt-0.5 font-mono tabular-nums">
                Mitigated {safetyReport.counts.mitigated} · Monitoring {safetyReport.counts.monitoring} · Unresolved {safetyReport.counts.unresolved} · Abort {safetyReport.counts.abortRequired} · Unavailable {safetyReport.counts.dataUnavailable}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActivePage('threat-mitigation')}
            className="px-3 py-1.5 rounded border border-slate-700 bg-[#07090E] hover:border-cyan-500 text-cyan-300 font-medium inline-flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            Open 58-Threat Lab
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-4">
          {/* Viewport Switcher, Left-Click Mode & Speed Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0D121C] border border-slate-800 rounded-lg px-3 py-2 text-xs">
            <div className="flex items-center gap-1 bg-[#07090E] p-1 rounded border border-slate-800">
              {(
                [
                  { id: 'auto', label: 'Auto Handoff' },
                  { id: 'earth-moon', label: 'Earth–Moon 3D (3.67:1)' },
                  { id: 'lunar-descent', label: 'LOLA Descent & Rover' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setViewportTab(tab.id)}
                  className={`px-2.5 py-1 rounded text-xs cursor-pointer ${
                    viewportTab === tab.id ? 'bg-cyan-600 text-slate-950 font-medium' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {!showingEarthMoon3D && (
              <div className="flex items-center gap-1 bg-[#07090E] p-1 rounded border border-slate-800">
                <MousePointerClick className="w-3.5 h-3.5 text-cyan-400 mx-1" />
                <button
                  type="button"
                  onClick={() => setTerrainClickAction('move-target-pin')}
                  className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                    terrainClickAction === 'move-target-pin'
                      ? 'bg-emerald-600 text-slate-950 font-medium'
                      : 'text-slate-300'
                  }`}
                >
                  Click: Target Pin
                </button>
                <button
                  type="button"
                  onClick={() => setTerrainClickAction('relocate-corridor')}
                  className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                    terrainClickAction === 'relocate-corridor'
                      ? 'bg-cyan-600 text-slate-950 font-medium'
                      : 'text-slate-300'
                  }`}
                >
                  Click: Relocate Lat/Lon
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setGreenLaunchBackdrop((g) => !g)}
                className={`px-2.5 py-1 rounded border text-[11px] font-mono cursor-pointer ${
                  greenLaunchBackdrop
                    ? 'bg-emerald-950/50 border-emerald-700 text-emerald-300'
                    : 'bg-[#07090E] border-slate-700 text-slate-400'
                }`}
              >
                Green Launch Bg: {greenLaunchBackdrop ? 'ON' : 'OFF'}
              </button>

              <div className="flex items-center gap-1 bg-[#07090E] p-1 rounded border border-slate-800 font-mono">
                <Gauge className="w-3.5 h-3.5 text-cyan-400 mx-1" />
                {([1, 5, 10, 20] as const).map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => setSpeedMultiplier(spd)}
                    className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                      speedMultiplier === spd ? 'bg-cyan-600 text-slate-950 font-semibold' : 'text-slate-300'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setAutoLandingBoost((b) => !b)}
                className={`px-2.5 py-1 rounded border text-[11px] font-mono cursor-pointer ${
                  autoLandingBoost
                    ? 'bg-amber-950/50 border-amber-700 text-amber-300'
                    : 'bg-[#07090E] border-slate-700 text-slate-400'
                }`}
              >
                Auto 10x/20x Boost: {autoLandingBoost ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* 3D Scene Container */}
          {showingEarthMoon3D ? (
            <EarthMoonTransitViewport3D
              selectedFacilityId={selectedFacility.id}
              customEarthCoord={customEarthOrigin}
              targetLat={targetOverride?.lat ?? activeCoordinate.lat}
              targetLon={targetOverride?.lon ?? activeCoordinate.lon}
              transitPct={transitPct}
              greenLaunchBackdrop={greenLaunchBackdrop}
              lightweightMode={settings.lightweightMode}
              onSelectFacility={(f) => {
                setCustomEarthOrigin(null);
                setSelectedFacilityId(f.id);
                pushNotification(`Selected launch station: ${f.shortName}`, 'info');
              }}
              onSelectEarthCoord={(lat, lon) => {
                setCustomEarthOrigin({ lat, lon });
                pushNotification(`Earth launch coordinate set to ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`, 'info');
              }}
              onSelectMoonCoord={(lat, lon) => {
                setTargetOverride(null);
                selectCoordinate({
                  lat,
                  lon,
                  label: `Moon Map (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
                  region: '3D Globe Selection',
                  source: 'Earth-Moon 3D Left-Click',
                });
                pushNotification(`Lunar destination set to ${lat.toFixed(3)}°, ${formatLon(lon)}`, 'info');
              }}
            />
          ) : terrain ? (
            <LandingSimViewport3D
              terrain={terrain}
              mode={mode}
              running={running}
              resetSignal={resetSignal}
              manualInput={manualInput}
              lightweightMode={settings.lightweightMode}
              solarElevationDeg={illuminationNow.solarElevationDeg}
              speedMultiplier={speedMultiplier}
              autoLandingBoost={autoLandingBoost}
              randomTestField={randomTestField}
              targetOverride={targetOverride}
              onMapClickTerrain={handleMapClickTerrain}
              cameraCanvasRef={cameraCanvasRef}
              onTelemetry={setTelemetry}
            />
          ) : (
            <div className="h-[440px] bg-[#0D121C] border border-slate-800 rounded-lg flex items-center justify-center text-xs font-mono text-cyan-300">
              Loading NASA LOLA terrain mesh...
            </div>
          )}

          {/* Simulation Controls Bar */}
          <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-1 bg-[#07090E] p-1 rounded border border-slate-800">
              {(['manual', 'assisted', 'autonomous'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 text-xs rounded capitalize cursor-pointer ${
                    mode === m ? 'bg-cyan-600 text-slate-950 font-medium' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {m} Mode
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {randomTestField && (
                <button
                  type="button"
                  onClick={() => {
                    setRandomTestField(null);
                    setResetSignal((s) => s + 1);
                  }}
                  className="px-3 py-1.5 bg-[#07090E] hover:border-slate-500 border border-violet-700 text-violet-300 text-xs rounded-md cursor-pointer"
                >
                  Clear Random Craters ({randomTestField.extraCraters.length})
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (transitStage !== 'POWERED_DESCENT') {
                    startDirectDescent();
                  } else {
                    setRunning((r) => !r);
                  }
                }}
                className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-medium text-xs rounded-md inline-flex items-center gap-1.5 cursor-pointer"
              >
                {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {running ? 'Pause Descent' : transitStage === 'POWERED_DESCENT' ? 'Resume Descent' : 'Start Terminal Descent'}
              </button>

              <button
                type="button"
                onClick={resetAll}
                className="px-3 py-1.5 bg-[#07090E] hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-md inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Mission
              </button>
            </div>
          </div>

          {mode !== 'autonomous' && (
            <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <label className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>Manual Thrust Trim</span>
                  <span className="font-mono">{manualInput.throttleDelta.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={manualInput.throttleDelta}
                  onChange={(e) => setManualInput((p) => ({ ...p, throttleDelta: Number(e.target.value) }))}
                  className="w-full accent-cyan-500"
                />
              </label>
              <label className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>East/West Pitch</span>
                  <span className="font-mono">{manualInput.pitchX.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.1}
                  value={manualInput.pitchX}
                  onChange={(e) => setManualInput((p) => ({ ...p, pitchX: Number(e.target.value) }))}
                  className="w-full accent-cyan-500"
                />
              </label>
              <label className="space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>North/South Roll</span>
                  <span className="font-mono">{manualInput.rollZ.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.1}
                  value={manualInput.rollZ}
                  onChange={(e) => setManualInput((p) => ({ ...p, rollZ: Number(e.target.value) }))}
                  className="w-full accent-cyan-500"
                />
              </label>
            </div>
          )}

          {/* Side-by-Side Comparison: Baseline Unassisted vs LUNASIGHT-Assisted */}
          {threatScan && (
            <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-100">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Side-by-Side Landing Comparison: Unassisted Baseline vs. LUNASIGHT Divert
                </div>
                <span className="text-[11px] font-mono text-cyan-300">
                  {randomTestField ? `<= ${randomTestField.escapeRadiusM} m Escape Radius Mode` : 'Full Corridor LOLA Scan'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-[#07090E] border border-rose-900/60 rounded p-3 space-y-1.5 font-mono tabular-nums">
                  <div className="font-sans font-semibold text-rose-300">
                    Unassisted Baseline Target (No Hazard Escape)
                  </div>
                  <div>Coords: {threatScan.targetPoint.lat.toFixed(4)}°, {formatLon(threatScan.targetPoint.lon)}</div>
                  <div>Local Slope: {baselineTargetSlope}°</div>
                  <div>Crater Hazard Exposure: {threatScan.craterThreatCount} craters unmitigated</div>
                  <div className="text-rose-400 font-sans text-[11px]">
                    Lands blindly at approach target without crater/roughness divert.
                  </div>
                </div>

                <div className="bg-[#07090E] border border-emerald-800/70 rounded p-3 space-y-1.5 font-mono tabular-nums">
                  <div className="font-sans font-semibold text-emerald-300">
                    LUNASIGHT Assisted Solution (Verified Non-Crater Pad)
                  </div>
                  <div>Coords: {threatScan.safestPad.lat.toFixed(4)}°, {formatLon(threatScan.safestPad.lon)}</div>
                  <div>Pad Slope: {threatScan.safestPad.slopeDeg}° (3×3 max {threatScan.safestPad.neighborMaxSlopeDeg}°)</div>
                  <div>
                    Divert Offset: {threatScan.safestPad.divertDistanceFromTargetM} m · Crater Rim Clearance:{' '}
                    {threatScan.safestPad.nearestCraterClearanceM >= 50000
                      ? 'Clear'
                      : `${threatScan.safestPad.nearestCraterClearanceM} m`}
                  </div>
                  <div className="text-emerald-400 font-sans text-[11px]">
                    Credits Mitigated: {telemetry.initialThreatCredits} → {telemetry.remainingThreatCredits} residual.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Zero-Preload Live Optical Camera Scanner */}
          <RealCameraScanner />
        </div>

        {/* Right Telemetry + 6-Step Landing Sequence + Onboard Nadir Camera */}
        <div className="space-y-4">
          <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-display font-semibold text-slate-100">
                Detailed Landing Telemetry ({telemetry.effectiveSpeedX}x)
              </span>
              <span
                className={`text-xs font-mono px-2 py-0.5 rounded border ${
                  telemetry.phase === 'LANDED' && (!safetyReport || safetyReport.canClaimLandingSuccess)
                    ? 'bg-emerald-950/50 border-emerald-700 text-emerald-300'
                    : telemetry.phase === 'ABORTED' || (telemetry.phase === 'LANDED' && safetyReport && !safetyReport.canClaimLandingSuccess)
                      ? 'bg-rose-950/50 border-rose-700 text-rose-300'
                      : 'bg-[#07090E] border-slate-700 text-cyan-300'
                }`}
              >
                {telemetry.phase === 'LANDED' && safetyReport && !safetyReport.canClaimLandingSuccess
                  ? 'SAFETY GATE HOLD'
                  : telemetry.phase}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
              <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                <div className="text-slate-400 font-sans text-[11px]">Initial Velocity (V₀)</div>
                <div className="text-sm font-semibold text-slate-200">{telemetry.initialVelMS} m/s</div>
              </div>
              <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                <div className="text-slate-400 font-sans text-[11px]">Live Total Speed</div>
                <div className="text-sm font-semibold text-cyan-300">{telemetry.totalSpeedMS} m/s</div>
              </div>
              <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                <div className="text-slate-400 font-sans text-[11px]">Altitude (AGL)</div>
                <div className="text-sm font-semibold text-slate-100">{telemetry.altitudeM} m</div>
              </div>
              <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                <div className="text-slate-400 font-sans text-[11px]">Vertical / Horiz Vel</div>
                <div className="text-xs font-semibold text-slate-100">
                  {telemetry.verticalVelMS} / {telemetry.horizontalVelMS} m/s
                </div>
              </div>
              <div className="bg-[#07090E] border border-slate-800 rounded p-2.5 col-span-2">
                <div className="text-slate-400 font-sans text-[11px]">Predicted Landing Coordinates</div>
                <div className="text-xs font-semibold text-emerald-300 mt-0.5">
                  {telemetry.predictedLat.toFixed(4)}° N, {formatLon(telemetry.predictedLon)} · LOLA {telemetry.lolaElevationM} m
                </div>
              </div>
            </div>

            <div className="bg-[#07090E] border border-slate-800 rounded p-2.5 text-xs text-slate-300">
              {telemetry.hazardStatus}
            </div>
          </div>

          {/* 6-Step Detailed Landing & Rover Choreography Sequence */}
          <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-display font-semibold text-slate-100">
                6-Step Landing &amp; Rover Dispatch Sequence
              </span>
              <span className="font-mono text-emerald-300 tabular-nums">
                Credits: {telemetry.initialThreatCredits} → {telemetry.remainingThreatCredits}
              </span>
            </div>

            <div className="space-y-1.5 text-[11px]">
              {(telemetry.landingSteps.length > 0
                ? telemetry.landingSteps
                : [
                    { id: '1', label: '1. Powered Deorbit Brake', status: 'PENDING' as const, detail: 'Awaiting PDI' },
                    { id: '2', label: '2. LOLA Hazard & Crater Mapping', status: 'PENDING' as const, detail: 'Scan corridor craters' },
                    { id: '3', label: '3. Crater-Escape Divert Burn', status: 'PENDING' as const, detail: 'Steer onto flat pad' },
                    { id: '4', label: '4. Terminal Vertical Flare', status: 'PENDING' as const, detail: 'Zero horizontal slip' },
                    { id: '5', label: '5. Safe Surface Contact Light', status: 'PENDING' as const, detail: 'Rover stays stowed' },
                    { id: '6', label: '6. Ramp Unfold & Rover Dispatch', status: 'PENDING' as const, detail: 'Egress -> NavCam -> Patrol' },
                  ]
              ).map((st) => (
                <div
                  key={st.id}
                  className={`p-2 rounded border ${
                    st.status === 'DONE'
                      ? 'bg-emerald-950/25 border-emerald-800/70 text-emerald-200'
                      : st.status === 'ACTIVE'
                        ? 'bg-cyan-950/35 border-cyan-600 text-cyan-200'
                        : st.status === 'ABORTED'
                          ? 'bg-rose-950/40 border-rose-700 text-rose-200'
                          : 'bg-[#07090E] border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between font-mono font-medium">
                    <span>{st.label}</span>
                    <span>{st.status}</span>
                  </div>
                  <div className="text-[10px] opacity-85 mt-0.5">{st.detail}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Camera-Integrated Nadir Feed */}
          <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
                <Camera className="w-3.5 h-3.5 text-cyan-400" />
                Simulated Onboard Nadir Camera
              </div>
              <select
                value={sampleImageMode}
                onChange={(e) => setSampleImageMode(e.target.value as typeof sampleImageMode)}
                className="bg-[#07090E] border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200"
              >
                <option value="live-sim-nadir">Sim Nadir Optical</option>
                <option value="sample-crater-test">LOLA Hazard Compare</option>
              </select>
            </div>

            <div className="relative bg-[#07090E] border border-slate-800 rounded overflow-hidden h-36 flex items-center justify-center">
              {sampleImageMode === 'live-sim-nadir' ? (
                <canvas ref={cameraCanvasRef} width={280} height={160} className="w-full h-full object-cover" />
              ) : (
                <div className="p-3 text-[11px] font-mono text-slate-300 space-y-1">
                  <div className="text-cyan-300">Optical-to-DEM Hazard Comparison</div>
                  <div>Target: {activeCoordinate.label}</div>
                  <div>Detected LOLA Craters: {terrain?.detectedCraters.length ?? 0}</div>
                  <div>Extra Random Craters: {randomTestField?.extraCraters.length ?? 0}</div>
                </div>
              )}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-10 h-10 border border-cyan-400/70 rounded-full flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                </div>
              </div>
            </div>
          </div>

          {apolloMode && (
            <div className="bg-[#0D121C] border border-amber-800/60 rounded-lg p-4 space-y-2">
              <div className="text-xs font-display font-semibold text-amber-300">
                Apollo 11 Historical NASA Timeline (Reference)
              </div>
              <div className="space-y-2 text-[11px]">
                {APOLLO_11_TIMELINE.map((ev) => (
                  <div key={ev.met} className="bg-[#07090E] border border-slate-800 rounded p-2">
                    <div className="font-mono text-amber-200">MET {ev.met} · {ev.phase}</div>
                    <div className="text-slate-400 mt-0.5">{ev.note}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <ProvenanceBar
        sourceName="NASA Earth (#2393) + LRO Moon (#14959) + LOLA LDEM_16 Descent & Ramp Rover Choreography"
        datasetId="SIMULATED-AUTOPILOT + LRO-L-LOLA-4-GDR-V1.0"
        classification="Simulated Environment"
        resolution="1,895 m/px underlying DEM · Exact 3.67:1 Earth-Moon scale"
        sourceUrl="https://www.lroc.asu.edu/featured_sites/view_site/1"
      />
    </div>
  );
}
