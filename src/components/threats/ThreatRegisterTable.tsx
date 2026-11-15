import React, { useMemo, useState } from 'react';
import type { EvaluatedThreat, ThreatStatus } from '../../types/threats';

interface ThreatRegisterTableProps {
  threats: EvaluatedThreat[];
  showFilters?: boolean;
  title?: string;
}

const STATUS_TEXT_STYLE: Record<ThreatStatus, string> = {
  DETECTED: 'text-amber-300',
  'UNDER ANALYSIS': 'text-sky-300',
  'MITIGATION ACTIVE': 'text-cyan-300',
  MITIGATED: 'text-emerald-400',
  MONITORING: 'text-sky-300',
  UNRESOLVED: 'text-amber-400',
  'ABORT REQUIRED': 'text-rose-400 font-semibold',
  'DATA UNAVAILABLE': 'text-slate-400',
};

const LIFECYCLE_STEPS = [
  'DETECTION',
  'CLASSIFICATION',
  'DATA VALIDATION',
  'RISK ASSESSMENT',
  'MITIGATION SELECTION',
  'SIMULATED MITIGATION',
  'POST-MITIGATION MEASUREMENT',
  'VERIFICATION',
  'STATUS UPDATE',
] as const;

export function ThreatRegisterTable({
  threats,
  showFilters = true,
  title = 'Threat Register & Lifecycle Verification',
}: ThreatRegisterTableProps) {
  const [searchId, setSearchId] = useState('');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [phaseFilter, setPhaseFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [confidenceFilter, setConfidenceFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(threats[0]?.id ?? null);

  const filtered = useMemo(() => {
    const q = searchId.trim().toLowerCase();
    return threats.filter((t) => {
      if (q && !t.id.toLowerCase().includes(q) && !t.name.toLowerCase().includes(q)) return false;
      if (severityFilter !== 'ALL' && t.severity !== severityFilter) return false;
      if (phaseFilter !== 'ALL' && t.missionPhase !== phaseFilter) return false;
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (confidenceFilter !== 'ALL' && t.confidence !== confidenceFilter) return false;
      if (sourceFilter !== 'ALL' && t.dataClassification !== sourceFilter) return false;
      return true;
    });
  }, [threats, searchId, severityFilter, phaseFilter, statusFilter, confidenceFilter, sourceFilter]);

  const inspected = useMemo(
    () => filtered.find((t) => t.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  return (
    <div className="space-y-4">
      <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-display font-semibold text-slate-100">{title}</h3>
          <span className="text-xs font-mono tabular-nums text-slate-400">
            Showing {filtered.length} / {threats.length} threat categories
          </span>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
            <input
              type="text"
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              placeholder="Filter ID or name (e.g. T03)"
              className="bg-[#07090E] border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 focus:outline-none focus:border-cyan-500"
            />
            <select
              aria-label="Filter by severity"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="bg-[#07090E] border border-slate-700 rounded px-2 py-1.5 text-slate-200"
            >
              <option value="ALL">Severity: All</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MODERATE">MODERATE</option>
              <option value="LOW">LOW</option>
            </select>
            <select
              aria-label="Filter by mission phase"
              value={phaseFilter}
              onChange={(e) => setPhaseFilter(e.target.value)}
              className="bg-[#07090E] border border-slate-700 rounded px-2 py-1.5 text-slate-200"
            >
              <option value="ALL">Phase: All</option>
              <option value="Pre-Descent & Planning">Pre-Descent &amp; Planning</option>
              <option value="Deorbit & Approach">Deorbit &amp; Approach</option>
              <option value="Powered Descent">Powered Descent</option>
              <option value="Terminal Hazard Avoidance">Terminal Hazard Avoidance</option>
              <option value="Touchdown & Post-Landing">Touchdown &amp; Post-Landing</option>
              <option value="All Descent Phases">All Descent Phases</option>
            </select>
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#07090E] border border-slate-700 rounded px-2 py-1.5 text-slate-200"
            >
              <option value="ALL">Status: All</option>
              <option value="MITIGATED">MITIGATED</option>
              <option value="MITIGATION ACTIVE">MITIGATION ACTIVE</option>
              <option value="MONITORING">MONITORING</option>
              <option value="UNRESOLVED">UNRESOLVED</option>
              <option value="ABORT REQUIRED">ABORT REQUIRED</option>
              <option value="DATA UNAVAILABLE">DATA UNAVAILABLE</option>
            </select>
            <select
              aria-label="Filter by confidence"
              value={confidenceFilter}
              onChange={(e) => setConfidenceFilter(e.target.value)}
              className="bg-[#07090E] border border-slate-700 rounded px-2 py-1.5 text-slate-200"
            >
              <option value="ALL">Confidence: All</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
              <option value="UNAVAILABLE">UNAVAILABLE</option>
            </select>
            <select
              aria-label="Filter by data source"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="bg-[#07090E] border border-slate-700 rounded px-2 py-1.5 text-slate-200"
            >
              <option value="ALL">Data Source: All</option>
              <option value="Measured">Measured</option>
              <option value="Derived">Derived</option>
              <option value="Estimated">Estimated</option>
              <option value="Simulated">Simulated</option>
              <option value="Assumed">Assumed</option>
              <option value="Unavailable">Unavailable</option>
            </select>
          </div>
        )}

        <div className="overflow-x-auto max-h-[380px] overflow-y-auto border border-slate-800 rounded">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#07090E] text-slate-400 sticky top-0 border-b border-slate-800">
              <tr>
                <th className="py-2 px-3">ID</th>
                <th className="py-2 px-3">Threat</th>
                <th className="py-2 px-3">Phase</th>
                <th className="py-2 px-3">Source</th>
                <th className="py-2 px-3">Severity</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Measured / Post-Mitigation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filtered.map((t) => {
                const active = inspected?.id === t.id;
                return (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`cursor-pointer transition-colors ${
                      active ? 'bg-cyan-950/35' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="py-2 px-3 font-mono tabular-nums text-cyan-300">{t.id}</td>
                    <td className="py-2 px-3 font-medium text-slate-100">{t.name}</td>
                    <td className="py-2 px-3 text-slate-400">{t.missionPhase}</td>
                    <td className="py-2 px-3 font-mono text-slate-300">{t.dataClassification}</td>
                    <td className="py-2 px-3 font-mono text-slate-300">{t.severity}</td>
                    <td className={`py-2 px-3 font-mono ${STATUS_TEXT_STYLE[t.status]}`}>{t.status}</td>
                    <td className="py-2 px-3 font-mono text-slate-300 max-w-[280px] truncate">
                      {t.measuredValue} / {t.postMitigationValue}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Threat Lifecycle & Mitigation Inspector */}
      {inspected && (
        <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-slate-400">
                {inspected.id} · {inspected.categoryLabel} · {inspected.missionPhase} · {inspected.dataClassification} ({inspected.confidence} Confidence)
              </div>
              <h4 className="text-base font-display font-semibold text-slate-100 mt-0.5">
                {inspected.name}
              </h4>
            </div>
            <div className={`text-xs font-mono ${STATUS_TEXT_STYLE[inspected.status]}`}>
              {inspected.status} · {inspected.severity}
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">{inspected.description}</p>

          {/* 9-Step Response Lifecycle Ribbon */}
          <div className="grid grid-cols-3 sm:grid-cols-9 gap-1 text-[10px] font-mono">
            {LIFECYCLE_STEPS.map((step, idx) => {
              const reachedIdx = LIFECYCLE_STEPS.indexOf(inspected.lifecycleStage);
              const done = idx <= reachedIdx;
              return (
                <div
                  key={step}
                  className={`px-1.5 py-1.5 rounded border text-center truncate ${
                    done
                      ? inspected.verificationPassed
                        ? 'bg-emerald-950/35 border-emerald-800 text-emerald-300'
                        : 'bg-cyan-950/35 border-cyan-800 text-cyan-200'
                      : 'bg-[#07090E] border-slate-800 text-slate-500'
                  }`}
                  title={step}
                >
                  {idx + 1}. {step.split(' ')[0]}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="bg-[#07090E] border border-slate-800 rounded p-3 space-y-1.5">
              <div><span className="text-slate-400">Detection Method:</span> <span className="text-slate-200">{inspected.detectionMethod}</span></div>
              <div><span className="text-slate-400">Sensor / Dataset:</span> <span className="text-cyan-300 font-mono">{inspected.requiredSensorOrDataset}</span></div>
              <div><span className="text-slate-400">Consequences:</span> <span className="text-slate-200">{inspected.consequences}</span></div>
              {inspected.probabilityEstimate !== null && (
                <div><span className="text-slate-400">Estimated Scenario Probability:</span> <span className="font-mono text-amber-300">{(inspected.probabilityEstimate * 100).toFixed(0)}%</span></div>
              )}
            </div>
            <div className="bg-[#07090E] border border-slate-800 rounded p-3 space-y-1.5">
              <div><span className="text-slate-400">Mitigation Strategy:</span> <span className="text-slate-200">{inspected.mitigationStrategy}</span></div>
              <div><span className="text-slate-400">Recovery Strategy:</span> <span className="text-slate-200">{inspected.recoveryStrategy}</span></div>
              <div><span className="text-slate-400">Verification Criteria:</span> <span className="text-slate-200">{inspected.verificationCriteria}</span></div>
              <div><span className="text-slate-400">Audit Result:</span> <span className={inspected.verificationPassed ? 'text-emerald-400' : 'text-amber-300'}>{inspected.verificationNote}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
