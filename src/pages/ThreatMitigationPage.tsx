import React, { useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { CoordinateSelectorBar } from '../components/shared/CoordinateSelectorBar';
import { ProvenanceBar } from '../components/shared/ProvenanceBar';
import { ThreatRegisterTable } from '../components/threats/ThreatRegisterTable';
import { TerrainHazardMapCanvas } from '../components/threats/TerrainHazardMapCanvas';
import { THREAT_CATEGORIES, THREAT_LAB_SCENARIOS } from '../lib/threatDatabase';
import { downloadSafetyReportPdf, exportSafetyReportCsv } from '../lib/safetyManager';

type ThreatSubViewId =
  | 'overview'
  | 'terrain'
  | 'illumination'
  | 'navigation'
  | 'propulsion'
  | 'dust-plume'
  | 'structural'
  | 'communications'
  | 'environmental'
  | 'control-center'
  | 'testing-lab'
  | 'reports';

const SUB_VIEWS: Array<{ id: ThreatSubViewId; label: string }> = [
  { id: 'overview', label: '1. Threat Overview' },
  { id: 'terrain', label: '2. Terrain (T01–T10)' },
  { id: 'illumination', label: '3. Illumination (T11–T17)' },
  { id: 'navigation', label: '4. Navigation (T18–T26)' },
  { id: 'propulsion', label: '5. Propulsion (T27–T34)' },
  { id: 'dust-plume', label: '6. Dust & Plume (T35–T40)' },
  { id: 'structural', label: '7. Structural (T41–T46)' },
  { id: 'communications', label: '8. Comms (T47–T52)' },
  { id: 'environmental', label: '9. Environmental (T53–T58)' },
  { id: 'control-center', label: '10. Mitigation Control' },
  { id: 'testing-lab', label: '11. Threat Testing Lab' },
  { id: 'reports', label: '12. History & Reports' },
];

export function ThreatMitigationPage() {
  const {
    activeCoordinate,
    terrain,
    safetyReport,
    acceptanceCriteria,
    setAcceptanceCriteria,
    faultInjection,
    setFaultInjection,
    applyLabScenario,
    resetFaultInjection,
    experimentRuns,
    runThreatExperiment,
    replayExperiment,
    pushNotification,
  } = useMission();

  const [subView, setSubView] = useState<ThreatSubViewId>('overview');

  const downloadJsonReport = () => {
    if (!safetyReport) return;
    const blob = new Blob([JSON.stringify(safetyReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arc-luna-safety-report-${activeCoordinate.lat.toFixed(2)}-${activeCoordinate.lon.toFixed(2)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushNotification('Exported Mission Safety Report JSON', 'success');
  };

  const downloadCsvReport = () => {
    if (!safetyReport) return;
    const csv = exportSafetyReportCsv(safetyReport);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arc-luna-safety-report-${activeCoordinate.lat.toFixed(2)}-${activeCoordinate.lon.toFixed(2)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushNotification('Exported 58-Threat CSV Report', 'success');
  };

  const outcomeBannerClass = !safetyReport
    ? 'border-slate-800 bg-[#0D121C] text-slate-300'
    : safetyReport.simulationOutcome === 'ABORT_REQUIRED'
      ? 'border-rose-700 bg-rose-950/40 text-rose-200'
      : safetyReport.simulationOutcome === 'HOLD_UNRESOLVED'
        ? 'border-amber-700 bg-amber-950/35 text-amber-200'
        : 'border-emerald-800/80 bg-emerald-950/25 text-emerald-200';

  const threatsByCat = (catId: string) =>
    safetyReport?.threats.filter((t) => t.category === catId) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-100">
            LUNA Autonomous Mission Safety Manager (T01–T58)
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Integrated detection, verification-gated mitigation, failure injection, and safety reporting across all 58 lunar landing threat categories.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {faultInjection.active && (
            <button
              type="button"
              onClick={resetFaultInjection}
              className="px-3 py-1.5 text-xs bg-amber-500/20 border border-amber-600 text-amber-200 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Clear Injected Faults
            </button>
          )}
          <button
            type="button"
            onClick={() => runThreatExperiment()}
            className="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-medium rounded-md inline-flex items-center gap-1.5 cursor-pointer"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            Snapshot Experiment
          </button>
        </div>
      </div>

      <CoordinateSelectorBar />

      {/* 12-Module Sub-Navigation Tabs */}
      <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-2 flex flex-wrap gap-1">
        {SUB_VIEWS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubView(tab.id)}
            className={`px-2.5 py-1.5 text-xs rounded transition-colors cursor-pointer whitespace-nowrap ${
              subView === tab.id
                ? 'bg-cyan-600 text-slate-950 font-medium'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!safetyReport || !terrain ? (
        <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-8 text-center text-xs font-mono text-cyan-300">
          Evaluating 58 threat modules against NASA LOLA LDEM_16 &amp; JPL ephemeris...
        </div>
      ) : (
        <>
          {/* Mission Safety Outcome Gate */}
          <div className={`border rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs ${outcomeBannerClass}`}>
            <div className="flex items-center gap-2.5">
              {safetyReport.simulationOutcome === 'ABORT_REQUIRED' || safetyReport.simulationOutcome === 'HOLD_UNRESOLVED' ? (
                <ShieldAlert className="w-4 h-4 shrink-0" />
              ) : (
                <ShieldCheck className="w-4 h-4 shrink-0" />
              )}
              <div>
                <span className="font-mono font-semibold">{safetyReport.simulationOutcome}</span>
                <span className="mx-2 text-slate-500">·</span>
                <span>{safetyReport.outcomeReason}</span>
              </div>
            </div>
            <div className="font-mono tabular-nums">
              Scenario: {faultInjection.scenarioName} · Landing Claim Permitted:{' '}
              <strong>{safetyReport.canClaimLandingSuccess ? 'YES' : 'BLOCKED'}</strong>
            </div>
          </div>

          {/* 1. THREAT OVERVIEW DASHBOARD */}
          {subView === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {[
                  { label: 'Total Categories', val: safetyReport.counts.total, cls: 'text-slate-100' },
                  { label: 'Verified Mitigated', val: safetyReport.counts.mitigated, cls: 'text-emerald-400' },
                  { label: 'Monitoring / Active', val: safetyReport.counts.monitoring + safetyReport.counts.mitigationActive, cls: 'text-cyan-300' },
                  { label: 'Unresolved', val: safetyReport.counts.unresolved, cls: 'text-amber-300' },
                  { label: 'Abort Required', val: safetyReport.counts.abortRequired, cls: 'text-rose-400' },
                  { label: 'Data Unavailable', val: safetyReport.counts.dataUnavailable, cls: 'text-slate-400' },
                ].map((k) => (
                  <div key={k.label} className="bg-[#0D121C] border border-slate-800 rounded-lg p-3.5">
                    <div className="text-[11px] text-slate-400">{k.label}</div>
                    <div className={`text-2xl font-mono tabular-nums font-semibold mt-1 ${k.cls}`}>{k.val}</div>
                  </div>
                ))}
              </div>

              {/* 8 Subsystem Category Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {THREAT_CATEGORIES.map((cat) => {
                  const items = threatsByCat(cat.id);
                  const mit = items.filter((i) => i.status === 'MITIGATED').length;
                  const unres = items.filter((i) => i.status === 'UNRESOLVED' || i.status === 'ABORT REQUIRED').length;
                  const unavail = items.filter((i) => i.status === 'DATA UNAVAILABLE').length;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSubView(cat.id)}
                      className="text-left bg-[#0D121C] hover:bg-slate-900 border border-slate-800 hover:border-cyan-700/70 rounded-lg p-4 space-y-2 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-cyan-400">{cat.range}</span>
                        <span className={unres > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                          {mit}/{items.length} Mitigated
                        </span>
                      </div>
                      <div className="text-sm font-display font-semibold text-slate-100">{cat.label}</div>
                      <div className="text-[11px] font-mono text-slate-400">
                        Unresolved/Abort: {unres} · Unavailable: {unavail}
                      </div>
                    </button>
                  );
                })}
              </div>

              <ThreatRegisterTable threats={safetyReport.threats} title="All 58 Lunar Landing Threats — Live Lifecycle Audit" />
            </div>
          )}

          {/* 2. TERRAIN THREATS (T01–T10) */}
          {subView === 'terrain' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-display font-semibold text-slate-100">
                      LOLA Multi-Hazard Terrain Map (T01–T10)
                    </h2>
                    <span className="text-xs font-mono text-cyan-300">{terrain.provenance.resolutionMetersAtEquator} m/px</span>
                  </div>
                  <TerrainHazardMapCanvas terrain={terrain} terrainSub={safetyReport.subsystems.terrain} />
                </div>

                <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-5 space-y-3 text-xs">
                  <h2 className="text-base font-display font-semibold text-slate-100">
                    Terrain Mitigation &amp; Coverage Assessment
                  </h2>
                  <div className="grid grid-cols-2 gap-2.5 font-mono">
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="text-slate-400 font-sans text-[11px]">Divert Pad Slope</div>
                      <div className="text-base text-emerald-300 mt-0.5">{safetyReport.subsystems.terrain.safestPadSlopeDeg}°</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="text-slate-400 font-sans text-[11px]">Crater Rim Clearance</div>
                      <div className="text-base text-cyan-300 mt-0.5">{safetyReport.subsystems.terrain.craterClearanceKm} km</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="text-slate-400 font-sans text-[11px]">Hidden Pits (T05)</div>
                      <div className="text-base text-violet-300 mt-0.5">{safetyReport.subsystems.terrain.depressionCount} cells</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="text-slate-400 font-sans text-[11px]">Max Step Δz (T10)</div>
                      <div className="text-base text-amber-300 mt-0.5">{safetyReport.subsystems.terrain.maxDiscontinuityM} m</div>
                    </div>
                  </div>
                  <div className="bg-[#07090E] border border-slate-800 rounded p-3 text-slate-300 space-y-1">
                    <div>Candidate Safe Pads: <strong className="font-mono">{safetyReport.subsystems.terrain.candidatePadCount}</strong> grid cells</div>
                    <div>Sub-meter Boulders (T02): <strong className="text-rose-300 font-mono">DATA UNAVAILABLE</strong> (requires LROC NAC / onboard flash LiDAR)</div>
                    <div>Local Regolith Bearing (T09): <strong className="text-rose-300 font-mono">DATA UNAVAILABLE</strong> (no in-situ penetrometer survey)</div>
                  </div>
                </div>
              </div>
              <ThreatRegisterTable threats={threatsByCat('terrain')} showFilters={false} title="Terrain Threats (T01–T10)" />
            </div>
          )}

          {/* 3. VISIBILITY & ILLUMINATION (T11–T17) */}
          {subView === 'illumination' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 bg-[#0D121C] border border-slate-800 rounded-lg p-5">
                <div className="space-y-3">
                  <h2 className="text-base font-display font-semibold text-slate-100">
                    Optical Visibility &amp; Camera Integrity Analyzer (T11–T17)
                  </h2>
                  <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="text-slate-400 font-sans text-[11px]">Solar Elevation</div>
                      <div className="text-base text-amber-300">{safetyReport.subsystems.visibility.solarElevationDeg}°</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="text-slate-400 font-sans text-[11px]">Optical Nav Confidence</div>
                      <div className="text-base text-cyan-300">{(safetyReport.subsystems.visibility.opticalNavConfidence * 100).toFixed(0)}%</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="text-slate-400 font-sans text-[11px]">Contrast Index</div>
                      <div className="text-base text-slate-100">{safetyReport.subsystems.visibility.contrastIndex}</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="text-slate-400 font-sans text-[11px]">Fallback Navigation</div>
                      <div className="text-xs text-emerald-300 mt-1">{safetyReport.subsystems.visibility.fallbackMode}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 text-xs">
                  <h3 className="text-sm font-semibold text-slate-200">Interactive Visibility Stress Controls</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setFaultInjection((f) => ({ ...f, active: true, cameraFailure: !f.cameraFailure }))}
                      className={`px-3 py-1.5 rounded border cursor-pointer ${
                        faultInjection.cameraFailure ? 'bg-rose-950/60 border-rose-600 text-rose-200' : 'bg-[#07090E] border-slate-700 text-slate-300'
                      }`}
                    >
                      Toggle Camera Failure (T15)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFaultInjection((f) => ({ ...f, active: true, cameraSaturation: !f.cameraSaturation }))}
                      className={`px-3 py-1.5 rounded border cursor-pointer ${
                        faultInjection.cameraSaturation ? 'bg-amber-950/60 border-amber-600 text-amber-200' : 'bg-[#07090E] border-slate-700 text-slate-300'
                      }`}
                    >
                      Toggle Glare Saturation (T13)
                    </button>
                  </div>
                  <label className="block space-y-1">
                    <div className="flex justify-between text-slate-300">
                      <span>Synthetic Dust Obscuration (T17)</span>
                      <span className="font-mono">{(faultInjection.syntheticDustObscuration * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={faultInjection.syntheticDustObscuration}
                      onChange={(e) => setFaultInjection((f) => ({ ...f, active: true, syntheticDustObscuration: Number(e.target.value) }))}
                      className="w-full accent-cyan-500"
                    />
                  </label>
                </div>
              </div>
              <ThreatRegisterTable threats={threatsByCat('illumination')} showFilters={false} title="Visibility & Illumination Threats (T11–T17)" />
            </div>
          )}

          {/* 4. NAVIGATION & SENSORS (T18–T26) */}
          {subView === 'navigation' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 bg-[#0D121C] border border-slate-800 rounded-lg p-5 text-xs">
                <div className="space-y-3">
                  <h2 className="text-base font-display font-semibold text-slate-100">
                    Navigation State Comparison &amp; Fault Isolation (T18–T26)
                  </h2>
                  <div className="grid grid-cols-3 gap-2 font-mono">
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">Actual Alt / Vel</div>
                      <div className="text-slate-100 mt-0.5">{safetyReport.subsystems.navigation.actualAltM} m</div>
                      <div className="text-slate-400">{safetyReport.subsystems.navigation.actualVelMS} m/s</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">Estimated State</div>
                      <div className="text-cyan-300 mt-0.5">{safetyReport.subsystems.navigation.estimatedAltM} m</div>
                      <div className="text-cyan-400">{safetyReport.subsystems.navigation.estimatedVelMS} m/s</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">3σ Uncertainty</div>
                      <div className="text-amber-300 mt-0.5">{safetyReport.subsystems.navigation.positionUncertaintyM} m</div>
                      <div className="text-slate-300">Conf {(safetyReport.subsystems.navigation.navConfidence * 100).toFixed(0)}%</div>
                    </div>
                  </div>
                  <div className="bg-[#07090E] border border-slate-800 rounded p-3 space-y-1">
                    <div>Isolated Sensors: <strong className="text-rose-300">{safetyReport.subsystems.navigation.isolatedSensors.join(', ') || 'None'}</strong></div>
                    <div>Disagreement Residual: <strong className="font-mono">{safetyReport.subsystems.navigation.sensorDisagreementM} m</strong> (Max {acceptanceCriteria.maxSensorDisagreementM} m)</div>
                    <div>Landing Permit: <strong className={safetyReport.subsystems.navigation.landingPermitBlocked ? 'text-rose-400' : 'text-emerald-400'}>{safetyReport.subsystems.navigation.landingPermitBlocked ? 'BLOCKED' : 'PERMITTED'}</strong></div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-200">Inject Sensor Faults, Noise &amp; Latency</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setFaultInjection((f) => ({ ...f, active: true, altimeterFault: !f.altimeterFault }))}
                      className={`px-3 py-1.5 rounded border cursor-pointer ${
                        faultInjection.altimeterFault ? 'bg-rose-950/60 border-rose-600 text-rose-200' : 'bg-[#07090E] border-slate-700 text-slate-300'
                      }`}
                    >
                      Inject Altimeter Fault (T24)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFaultInjection((f) => ({ ...f, active: true, velocimeterDropout: !f.velocimeterDropout }))}
                      className={`px-3 py-1.5 rounded border cursor-pointer ${
                        faultInjection.velocimeterDropout ? 'bg-amber-950/60 border-amber-600 text-amber-200' : 'bg-[#07090E] border-slate-700 text-slate-300'
                      }`}
                    >
                      Inject Doppler Dropout (T22)
                    </button>
                  </div>
                  <label className="block space-y-1">
                    <div className="flex justify-between"><span>Altimeter 1σ Noise (T18)</span><span className="font-mono">{faultInjection.altimeterNoiseM} m</span></div>
                    <input type="range" min={1} max={50} step={1} value={faultInjection.altimeterNoiseM} onChange={(e) => setFaultInjection((f) => ({ ...f, active: true, altimeterNoiseM: Number(e.target.value) }))} className="w-full accent-cyan-500" />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between"><span>Sensor Bus Latency (T23)</span><span className="font-mono">{faultInjection.sensorLatencyMs} ms</span></div>
                    <input type="range" min={20} max={800} step={20} value={faultInjection.sensorLatencyMs} onChange={(e) => setFaultInjection((f) => ({ ...f, active: true, sensorLatencyMs: Number(e.target.value) }))} className="w-full accent-cyan-500" />
                  </label>
                </div>
              </div>
              <ThreatRegisterTable threats={threatsByCat('navigation')} showFilters={false} title="Navigation & Sensor Threats (T18–T26)" />
            </div>
          )}

          {/* 5. PROPULSION & VIRTUAL THRUST LAB (T27–T34) */}
          {subView === 'propulsion' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 bg-[#0D121C] border border-slate-800 rounded-lg p-5 text-xs">
                <div className="space-y-3">
                  <h2 className="text-base font-display font-semibold text-slate-100">
                    Virtual Thrust-Management &amp; Controller Test Lab (T27–T34)
                  </h2>
                  <p className="text-slate-400">
                    Isolated virtual kinematics testbed (no real spacecraft hardware interface). Compare controller gains under thrust degradation and actuator lag.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">Cmd / Sim Thrust</div>
                      <div className="text-cyan-300 mt-0.5">{safetyReport.subsystems.propulsion.simulatedThrustN} N</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">Hover Margin</div>
                      <div className="text-emerald-300 mt-0.5">{safetyReport.subsystems.propulsion.hoverMarginPct}%</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">Fuel Reserve</div>
                      <div className="text-amber-300 mt-0.5">{safetyReport.subsystems.propulsion.propellantRemainingPct}%</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">Attitude Error</div>
                      <div className="text-slate-100 mt-0.5">{safetyReport.subsystems.propulsion.attitudeErrorDeg}°</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-sm font-semibold text-slate-200">Select Abstract Controller Configuration</div>
                  <div className="flex items-center gap-1.5">
                    {(['conservative', 'nominal', 'aggressive'] as const).map((prof) => (
                      <button
                        key={prof}
                        type="button"
                        onClick={() => setFaultInjection((f) => ({ ...f, controllerProfile: prof }))}
                        className={`px-3 py-1.5 rounded border capitalize cursor-pointer ${
                          faultInjection.controllerProfile === prof
                            ? 'bg-cyan-600 border-cyan-500 text-slate-950 font-medium'
                            : 'bg-[#07090E] border-slate-700 text-slate-300'
                        }`}
                      >
                        {prof}
                      </button>
                    ))}
                  </div>
                  <label className="block space-y-1">
                    <div className="flex justify-between"><span>Thrust Degradation (T27)</span><span className="font-mono">{faultInjection.thrustDegradationPct}%</span></div>
                    <input type="range" min={0} max={45} step={2} value={faultInjection.thrustDegradationPct} onChange={(e) => setFaultInjection((f) => ({ ...f, active: true, thrustDegradationPct: Number(e.target.value) }))} className="w-full accent-cyan-500" />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between"><span>Actuator Valve Delay (T29)</span><span className="font-mono">{faultInjection.actuatorDelayMs} ms</span></div>
                    <input type="range" min={20} max={500} step={20} value={faultInjection.actuatorDelayMs} onChange={(e) => setFaultInjection((f) => ({ ...f, active: true, actuatorDelayMs: Number(e.target.value) }))} className="w-full accent-cyan-500" />
                  </label>
                </div>
              </div>
              <ThreatRegisterTable threats={threatsByCat('propulsion')} showFilters={false} title="Propulsion & Descent Threats (T27–T34)" />
            </div>
          )}

          {/* 6. DUST & PLUME RESEARCH MODULE (T35–T40) */}
          {subView === 'dust-plume' && (
            <div className="space-y-5">
              <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-5 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-display font-semibold text-slate-100">
                    Plume-Surface Interaction Research Visualizer (T35–T40)
                  </h2>
                  <span className="text-amber-300 font-mono">{safetyReport.subsystems.dustPlume.modelNotice}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono">
                  <div className="bg-[#07090E] border border-slate-800 rounded p-3">
                    <div className="font-sans text-[11px] text-slate-400">Synthetic Impingement (18m AGL)</div>
                    <div className="text-base text-amber-300 mt-0.5">{safetyReport.subsystems.dustPlume.impingementPressurePa} Pa</div>
                  </div>
                  <div className="bg-[#07090E] border border-slate-800 rounded p-3">
                    <div className="font-sans text-[11px] text-slate-400">Optical Visibility Loss</div>
                    <div className="text-base text-rose-300 mt-0.5">{safetyReport.subsystems.dustPlume.opticalDegradationPct}%</div>
                  </div>
                  <div className="bg-[#07090E] border border-slate-800 rounded p-3">
                    <div className="font-sans text-[11px] text-slate-400">Ejecta Standoff Radius</div>
                    <div className="text-base text-cyan-300 mt-0.5">{safetyReport.subsystems.dustPlume.surfaceEjectaRadiusM} m</div>
                  </div>
                  <div className="bg-[#07090E] border border-slate-800 rounded p-3">
                    <div className="font-sans text-[11px] text-slate-400">Contamination Risk</div>
                    <div className="text-base text-slate-100 mt-0.5">{safetyReport.subsystems.dustPlume.sensorContaminationRisk}</div>
                  </div>
                </div>
              </div>
              <ThreatRegisterTable threats={threatsByCat('dust-plume')} showFilters={false} title="Lunar Dust & Plume Threats (T35–T40)" />
            </div>
          )}

          {/* 7. STRUCTURAL & 4-LEG TOUCHDOWN STABILITY (T41–T46) */}
          {subView === 'structural' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 bg-[#0D121C] border border-slate-800 rounded-lg p-5 text-xs">
                <div className="space-y-3">
                  <h2 className="text-base font-display font-semibold text-slate-100">
                    4-Leg Landing Gear Contact &amp; Tilt Stability Model (T41–T46)
                  </h2>
                  <div className="grid grid-cols-2 gap-2.5 font-mono">
                    {safetyReport.subsystems.structural.legs.map((leg) => (
                      <div key={leg.legId} className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                        <div className="flex justify-between">
                          <span className="text-slate-200">{leg.legId}</span>
                          <span className={leg.contact ? 'text-emerald-400' : 'text-rose-400'}>
                            {leg.contact ? 'CONTACT' : 'AIRBORNE'}
                          </span>
                        </div>
                        <div className="text-slate-400 mt-1">
                          Load: {leg.loadN.toLocaleString()} N · Stroke: {leg.strokeCm} cm
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="bg-[#07090E] border border-slate-800 rounded p-3 space-y-1 font-mono">
                    <div>Estimated Tilt: <strong className="text-cyan-300">{safetyReport.subsystems.structural.estimatedTiltDeg}°</strong> (Max {acceptanceCriteria.maxTouchdownTiltDeg}°)</div>
                    <div>Surface Support Uncertainty: <strong className="text-amber-300">{safetyReport.subsystems.structural.surfaceSupportUncertainty}</strong></div>
                    <div>Stability Verdict: <strong className={safetyReport.subsystems.structural.touchdownStable ? 'text-emerald-400' : 'text-rose-400'}>{safetyReport.subsystems.structural.reason}</strong></div>
                  </div>
                  <label className="block space-y-1">
                    <div className="flex justify-between"><span>Inject Footpad Step Imbalance on Leg 3 (T41/T42)</span><span className="font-mono">{faultInjection.legImbalanceCm} cm</span></div>
                    <input type="range" min={0} max={80} step={4} value={faultInjection.legImbalanceCm} onChange={(e) => setFaultInjection((f) => ({ ...f, active: true, legImbalanceCm: Number(e.target.value) }))} className="w-full accent-cyan-500" />
                  </label>
                </div>
              </div>
              <ThreatRegisterTable threats={threatsByCat('structural')} showFilters={false} title="Structural & Touchdown Threats (T41–T46)" />
            </div>
          )}

          {/* 8. COMMUNICATIONS & OPERATIONS (T47–T52) */}
          {subView === 'communications' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 bg-[#0D121C] border border-slate-800 rounded-lg p-5 text-xs">
                <div className="space-y-3">
                  <h2 className="text-base font-display font-semibold text-slate-100">
                    Earth–Moon Comms &amp; Autonomy Separation Monitor (T47–T52)
                  </h2>
                  <div className="grid grid-cols-2 gap-2.5 font-mono">
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">1-Way Light Delay</div>
                      <div className="text-base text-cyan-300">{safetyReport.subsystems.comms.oneWayLightTimeSec} s</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">Round-Trip RTT Latency</div>
                      <div className="text-base text-slate-100">{safetyReport.subsystems.comms.totalRoundTripLatencyMs} ms</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">Earth RF Carrier</div>
                      <div className={safetyReport.subsystems.comms.rfLinkUp ? 'text-emerald-400' : 'text-rose-400'}>
                        {safetyReport.subsystems.comms.rfLinkUp ? 'LINK UP' : 'BLACKOUT'}
                      </div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">Onboard Autonomy GNC</div>
                      <div className="text-emerald-400">
                        {safetyReport.subsystems.comms.onboardAutonomyIntact ? 'INDEPENDENT / INTACT' : 'FAILED'}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setFaultInjection((f) => ({ ...f, active: true, rfBlackout: !f.rfBlackout }))}
                    className={`px-3 py-1.5 rounded border cursor-pointer ${
                      faultInjection.rfBlackout ? 'bg-rose-950/60 border-rose-600 text-rose-200' : 'bg-[#07090E] border-slate-700 text-slate-300'
                    }`}
                  >
                    Inject Earth RF Blackout (T47)
                  </button>
                  <div className="bg-[#07090E] border border-slate-800 rounded p-3 text-slate-300">
                    Preflight Config Audit: {safetyReport.subsystems.comms.configInconsistencies.length === 0 ? 'Zero configuration inconsistencies.' : safetyReport.subsystems.comms.configInconsistencies.join('; ')}
                  </div>
                </div>
              </div>
              <ThreatRegisterTable threats={threatsByCat('communications')} showFilters={false} title="Communication & Operation Threats (T47–T52)" />
            </div>
          )}

          {/* 9. ENVIRONMENTAL THREATS (T53–T58) */}
          {subView === 'environmental' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 bg-[#0D121C] border border-slate-800 rounded-lg p-5 text-xs">
                <div className="space-y-3">
                  <h2 className="text-base font-display font-semibold text-slate-100">
                    Thermal, Radiation &amp; Power Assessment (T53–T58)
                  </h2>
                  <div className="grid grid-cols-2 gap-2.5 font-mono">
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">Derived Surf. Temp</div>
                      <div className="text-base text-cyan-300">{safetyReport.subsystems.environmental.derivedTempK} K ({safetyReport.subsystems.environmental.derivedTempC} °C)</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">Solar Power Margin</div>
                      <div className="text-base text-emerald-300">{safetyReport.subsystems.environmental.solarPowerMarginPct}%</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">Live Radiation Flux (T55)</div>
                      <div className="text-rose-300 mt-0.5">{safetyReport.subsystems.environmental.realTimeRadiationFlux}</div>
                    </div>
                    <div className="bg-[#07090E] border border-slate-800 rounded p-2.5">
                      <div className="font-sans text-[11px] text-slate-400">30d Illumination</div>
                      <div className="text-amber-300 mt-0.5">{safetyReport.subsystems.environmental.illuminationPct30d}%</div>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setFaultInjection((f) => ({ ...f, active: true, simulatedSpeRadiation: !f.simulatedSpeRadiation }))}
                    className={`px-3 py-1.5 rounded border cursor-pointer ${
                      faultInjection.simulatedSpeRadiation ? 'bg-amber-950/60 border-amber-600 text-amber-200' : 'bg-[#07090E] border-slate-700 text-slate-300'
                    }`}
                  >
                    Toggle Simulated Solar Particle Event Scenario (T55)
                  </button>
                  <label className="block space-y-1">
                    <div className="flex justify-between"><span>Solar Power Bus Degradation (T56)</span><span className="font-mono">{faultInjection.powerBusDegradationPct}%</span></div>
                    <input type="range" min={0} max={85} step={5} value={faultInjection.powerBusDegradationPct} onChange={(e) => setFaultInjection((f) => ({ ...f, active: true, powerBusDegradationPct: Number(e.target.value) }))} className="w-full accent-cyan-500" />
                  </label>
                </div>
              </div>
              <ThreatRegisterTable threats={threatsByCat('environmental')} showFilters={false} title="Environmental Threats (T53–T58)" />
            </div>
          )}

          {/* 10. MITIGATION CONTROL CENTER (ACCEPTANCE CRITERIA + ALL 58 FILTERS) */}
          {subView === 'control-center' && (
            <div className="space-y-5">
              <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-5 space-y-3 text-xs">
                <h2 className="text-base font-display font-semibold text-slate-100">
                  Configurable Safety Acceptance Criteria Matrix
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <label className="space-y-1">
                    <div className="flex justify-between"><span>Max Target Slope</span><span className="font-mono">{acceptanceCriteria.maxPadSlopeDeg}°</span></div>
                    <input type="range" min={5} max={20} step={1} value={acceptanceCriteria.maxPadSlopeDeg} onChange={(e) => setAcceptanceCriteria((c) => ({ ...c, maxPadSlopeDeg: Number(e.target.value) }))} className="w-full accent-cyan-500" />
                  </label>
                  <label className="space-y-1">
                    <div className="flex justify-between"><span>Min Nav Confidence</span><span className="font-mono">{(acceptanceCriteria.minNavConfidence * 100).toFixed(0)}%</span></div>
                    <input type="range" min={0.4} max={0.95} step={0.05} value={acceptanceCriteria.minNavConfidence} onChange={(e) => setAcceptanceCriteria((c) => ({ ...c, minNavConfidence: Number(e.target.value) }))} className="w-full accent-cyan-500" />
                  </label>
                  <label className="space-y-1">
                    <div className="flex justify-between"><span>Max Touchdown Tilt</span><span className="font-mono">{acceptanceCriteria.maxTouchdownTiltDeg}°</span></div>
                    <input type="range" min={4} max={18} step={1} value={acceptanceCriteria.maxTouchdownTiltDeg} onChange={(e) => setAcceptanceCriteria((c) => ({ ...c, maxTouchdownTiltDeg: Number(e.target.value) }))} className="w-full accent-cyan-500" />
                  </label>
                  <label className="space-y-1">
                    <div className="flex justify-between"><span>Min Solar Power Margin</span><span className="font-mono">{acceptanceCriteria.minPowerMarginPct}%</span></div>
                    <input type="range" min={5} max={50} step={5} value={acceptanceCriteria.minPowerMarginPct} onChange={(e) => setAcceptanceCriteria((c) => ({ ...c, minPowerMarginPct: Number(e.target.value) }))} className="w-full accent-cyan-500" />
                  </label>
                </div>
              </div>
              <ThreatRegisterTable threats={safetyReport.threats} title="Full 58-Threat Filterable Mitigation Matrix" />
            </div>
          )}

          {/* 11. THREAT TESTING LABORATORY */}
          {subView === 'testing-lab' && (
            <div className="space-y-5">
              <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-display font-semibold text-slate-100">
                      Threat Testing Laboratory — Repeatable Failure Injection Scenarios
                    </h2>
                    <p className="text-xs text-slate-400">
                      Inject predefined individual or combined failures, verify Safety Manager response, record telemetry snapshots, and replay runs fairly.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => runThreatExperiment()}
                      className="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-medium rounded-md inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Record Active Experiment
                    </button>
                    <button
                      type="button"
                      onClick={resetFaultInjection}
                      className="px-3 py-1.5 text-xs bg-[#07090E] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md cursor-pointer"
                    >
                      Reset to Nominal
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 text-xs">
                  {THREAT_LAB_SCENARIOS.map((sc) => {
                    const active = faultInjection.scenarioId === sc.id;
                    return (
                      <div
                        key={sc.id}
                        className={`p-3 rounded-md border space-y-2 ${
                          active ? 'bg-cyan-950/35 border-cyan-600' : 'bg-[#07090E] border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-100">{sc.name}</span>
                          <span className="font-mono text-[11px] text-cyan-400">{sc.targetThreats.join(', ')}</span>
                        </div>
                        <p className="text-[11px] text-slate-400">{sc.description}</p>
                        <button
                          type="button"
                          onClick={() => applyLabScenario(sc.id)}
                          className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-100 rounded cursor-pointer"
                        >
                          {active ? 'Scenario Active' : 'Inject Scenario'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {experimentRuns.length > 0 && (
                <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-5 space-y-3">
                  <h3 className="text-sm font-display font-semibold text-slate-100">
                    Recorded Experiment Comparison Log
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left font-mono">
                      <thead className="text-slate-400 border-b border-slate-800 font-sans">
                        <tr>
                          <th className="py-2 pr-3">Scenario</th>
                          <th className="py-2 pr-3">Outcome</th>
                          <th className="py-2 pr-3">Mitigated / Unres / Abort</th>
                          <th className="py-2 pr-3">Nav Conf</th>
                          <th className="py-2 pr-3">Tilt</th>
                          <th className="py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {experimentRuns.map((run) => (
                          <tr key={run.id}>
                            <td className="py-2 pr-3 font-sans text-slate-100">{run.scenarioName}</td>
                            <td className="py-2 pr-3 text-cyan-300">{run.outcome}</td>
                            <td className="py-2 pr-3">{run.mitigatedCount} / {run.unresolvedCount} / {run.abortCount}</td>
                            <td className="py-2 pr-3">{(run.navConfidence * 100).toFixed(0)}%</td>
                            <td className="py-2 pr-3">{run.touchdownTiltDeg}°</td>
                            <td className="py-2">
                              <button
                                type="button"
                                onClick={() => replayExperiment(run)}
                                className="text-cyan-400 hover:underline font-sans cursor-pointer"
                              >
                                Replay
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 12. THREAT HISTORY & EXPORTABLE MISSION SAFETY REPORT */}
          {subView === 'reports' && (
            <div className="space-y-5">
              <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-display font-semibold text-slate-100">
                      Automated Mission Safety Report
                    </h2>
                    <p className="text-xs text-slate-400">
                      Generated {safetyReport.generatedAtUtc} · {safetyReport.coordinateLabel} ({safetyReport.lat.toFixed(4)}°, {safetyReport.lon.toFixed(4)}°)
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => downloadSafetyReportPdf(safetyReport)}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-medium rounded-md inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Export PDF
                    </button>
                    <button
                      type="button"
                      onClick={downloadCsvReport}
                      className="px-3 py-1.5 bg-[#07090E] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                      Export CSV
                    </button>
                    <button
                      type="button"
                      onClick={downloadJsonReport}
                      className="px-3 py-1.5 bg-[#07090E] hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-cyan-400" />
                      Export JSON
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="bg-[#07090E] border border-slate-800 rounded p-3.5 space-y-1.5">
                    <div className="font-medium text-slate-200 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      Missing Scientific Datasets &amp; Limitations
                    </div>
                    <ul className="list-disc list-inside text-slate-400 space-y-1">
                      {safetyReport.limitations.map((lim) => (
                        <li key={lim}>{lim}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="bg-[#07090E] border border-slate-800 rounded p-3.5 space-y-1.5">
                    <div className="font-medium text-slate-200">Verification &amp; Abort Audit</div>
                    {safetyReport.abortDecisions.length === 0 ? (
                      <div className="text-emerald-400 font-mono">No simulated abort flags triggered under current parameters.</div>
                    ) : (
                      <ul className="list-disc list-inside text-rose-300 space-y-1">
                        {safetyReport.abortDecisions.map((ab) => (
                          <li key={ab}>{ab}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              <ThreatRegisterTable threats={safetyReport.threats} title="Full Report Annex — T01–T58 Verification Status" />
            </div>
          )}

          <ProvenanceBar
            sourceName="NASA PDS LOLA LDEM_16 + JPL Ephemeris + Virtual Aerospace Subsystem Models"
            datasetId="ARC-LUNA-SAFETY-MANAGER-T01-T58"
            classification="Derived Scientific Calculation"
            resolution={`${terrain.provenance.resolutionMetersAtEquator} m/px DEM + Simulated Subsystems`}
            sourceUrl={terrain.provenance.sourceUrl}
          />
        </>
      )}
    </div>
  );
}
