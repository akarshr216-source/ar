import assert from 'node:assert/strict';
import { lolaService } from '../server/lolaService.js';
import {
  DEFAULT_ACCEPTANCE_CRITERIA,
  DEFAULT_FAULT_INJECTION,
  THREAT_CATEGORIES,
  THREAT_DATABASE,
  THREAT_LAB_SCENARIOS,
} from '../src/lib/threatDatabase.js';
import { computeLunarIllumination, computeIlluminationTimeline } from '../src/lib/lunarEphemeris.js';
import { evaluateLunaMissionSafety, exportSafetyReportCsv } from '../src/lib/safetyManager.js';

function runTests() {
  console.log('Running ARC LUNA 58-Threat Mitigation Verification Suite...');

  // 1. Validate centralized database covers all 58 threats across 8 categories
  assert.equal(THREAT_DATABASE.length, 58, 'THREAT_DATABASE must contain exactly 58 threats (T01-T58)');
  assert.equal(THREAT_CATEGORIES.length, 8, 'THREAT_CATEGORIES must have 8 categories');
  for (let i = 1; i <= 58; i++) {
    const id = `T${String(i).padStart(2, '0')}`;
    const found = THREAT_DATABASE.find((t) => t.id === id);
    assert.ok(found, `Missing threat ID ${id}`);
    assert.ok(found.mitigationStrategy.length > 10, `${id} must define mitigationStrategy`);
    assert.ok(found.recoveryStrategy.length > 10, `${id} must define recoveryStrategy`);
    assert.ok(found.verificationCriteria.length > 10, `${id} must define verificationCriteria`);
  }
  assert.ok(THREAT_LAB_SCENARIOS.length >= 13, 'Expected Nominal + at least 12 lab stress scenarios');

  // 2. Real NASA LOLA terrain patch at Apollo 11 Tranquility Base (0.674, 23.473)
  const apolloTerrain = lolaService.analyzeTerrainPatch(0.674, 23.473, 30, 33);
  assert.equal(apolloTerrain.provenance.available, true, 'NASA LOLA LDEM_16 must be available');

  // Pick a noon-ish sunlit UTC timestamp at Tranquility Base so solar elevation is comfortably positive
  const noonSunDate = new Date('2026-06-22T12:00:00Z');
  let testDate = noonSunDate;
  for (let d = 0; d < 29; d++) {
    const candidate = new Date(Date.UTC(2026, 5, 1 + d, 12, 0, 0));
    const st = computeLunarIllumination(apolloTerrain.centerLat, apolloTerrain.centerLon, candidate, apolloTerrain.horizonAnalysis.samples);
    if (st.solarElevationDeg >= 15) {
      testDate = candidate;
      break;
    }
  }
  const illumNow = computeLunarIllumination(
    apolloTerrain.centerLat,
    apolloTerrain.centerLon,
    testDate,
    apolloTerrain.horizonAnalysis.samples,
  );
  const timeline = computeIlluminationTimeline(
    apolloTerrain.centerLat,
    apolloTerrain.centerLon,
    testDate,
    30,
    apolloTerrain.horizonAnalysis.samples,
  );

  // 3. Baseline nominal run: verify honest DATA UNAVAILABLE handling & safe landing verification
  const baseline = evaluateLunaMissionSafety({
    coordinateLabel: 'Apollo 11 — Mare Tranquillitatis',
    terrain: apolloTerrain,
    illuminationNow: illumNow,
    timeline,
    facilityName: 'Kennedy Space Center LC-39A',
    earthMoonDistanceKm: illumNow.earthMoonDistanceKm,
    criteria: DEFAULT_ACCEPTANCE_CRITERIA,
    fault: DEFAULT_FAULT_INJECTION,
  });

  assert.equal(baseline.counts.total, 58, 'Report must evaluate all 58 threats');
  assert.equal(baseline.canClaimLandingSuccess, true, `Baseline Apollo 11 should verify safe landing: ${baseline.outcomeReason}`);

  const t02 = baseline.threats.find((t) => t.id === 'T02');
  const t09 = baseline.threats.find((t) => t.id === 'T09');
  const t55 = baseline.threats.find((t) => t.id === 'T55');
  assert.equal(t02?.status, 'DATA UNAVAILABLE', 'T02 sub-meter boulders without LROC NAC must be DATA UNAVAILABLE');
  assert.equal(t09?.status, 'DATA UNAVAILABLE', 'T09 in-situ soil mechanics must be DATA UNAVAILABLE');
  assert.equal(t55?.status, 'DATA UNAVAILABLE', 'T55 live GCR/SPE particle flux must be DATA UNAVAILABLE unless simulated');

  // 4. Steep slope fault (>16°) MUST block landing success & trigger ABORT REQUIRED
  const steepSlopeReport = evaluateLunaMissionSafety({
    coordinateLabel: 'Stress Steep Slope',
    terrain: apolloTerrain,
    illuminationNow: illumNow,
    timeline,
    facilityName: 'KSC LC-39A',
    earthMoonDistanceKm: illumNow.earthMoonDistanceKm,
    criteria: DEFAULT_ACCEPTANCE_CRITERIA,
    fault: { ...DEFAULT_FAULT_INJECTION, active: true, forceSteepSlopeDeg: 22 },
  });
  assert.equal(steepSlopeReport.canClaimLandingSuccess, false, 'Slope 22° (>16° abort limit) must block landing success');
  assert.equal(steepSlopeReport.simulationOutcome, 'ABORT_REQUIRED');

  // 5. Severe thrust degradation (-36%) MUST trigger ABORT REQUIRED & block landing
  const thrustAbortReport = evaluateLunaMissionSafety({
    coordinateLabel: 'Thrust Failure',
    terrain: apolloTerrain,
    illuminationNow: illumNow,
    timeline,
    facilityName: 'KSC LC-39A',
    earthMoonDistanceKm: illumNow.earthMoonDistanceKm,
    criteria: DEFAULT_ACCEPTANCE_CRITERIA,
    fault: { ...DEFAULT_FAULT_INJECTION, active: true, thrustDegradationPct: 36 },
  });
  assert.equal(thrustAbortReport.canClaimLandingSuccess, false, 'Thrust -36% must block landing success');
  assert.equal(thrustAbortReport.simulationOutcome, 'ABORT_REQUIRED');

  // 6. Altimeter fault + camera failure MUST fail verification and block landing permit
  const navLockoutReport = evaluateLunaMissionSafety({
    coordinateLabel: 'Dual Sensor Outage',
    terrain: apolloTerrain,
    illuminationNow: illumNow,
    timeline,
    facilityName: 'KSC LC-39A',
    earthMoonDistanceKm: illumNow.earthMoonDistanceKm,
    criteria: DEFAULT_ACCEPTANCE_CRITERIA,
    fault: { ...DEFAULT_FAULT_INJECTION, active: true, altimeterFault: true, cameraFailure: true },
  });
  assert.equal(navLockoutReport.subsystems.navigation.landingPermitBlocked, true);
  assert.equal(navLockoutReport.canClaimLandingSuccess, false);

  // 7. Leg imbalance (54 cm) MUST report unstable touchdown
  const structuralReport = evaluateLunaMissionSafety({
    coordinateLabel: 'Leg Imbalance',
    terrain: apolloTerrain,
    illuminationNow: illumNow,
    timeline,
    facilityName: 'KSC LC-39A',
    earthMoonDistanceKm: illumNow.earthMoonDistanceKm,
    criteria: DEFAULT_ACCEPTANCE_CRITERIA,
    fault: { ...DEFAULT_FAULT_INJECTION, active: true, legImbalanceCm: 54 },
  });
  assert.equal(structuralReport.subsystems.structural.touchdownStable, false);
  assert.equal(structuralReport.canClaimLandingSuccess, false);

  // 8. Simulated SPE Radiation toggles T55 into MONITORING/MITIGATION (not DATA UNAVAILABLE)
  const speReport = evaluateLunaMissionSafety({
    coordinateLabel: 'Simulated SPE Storm',
    terrain: apolloTerrain,
    illuminationNow: illumNow,
    timeline,
    facilityName: 'KSC LC-39A',
    earthMoonDistanceKm: illumNow.earthMoonDistanceKm,
    criteria: DEFAULT_ACCEPTANCE_CRITERIA,
    fault: { ...DEFAULT_FAULT_INJECTION, active: true, simulatedSpeRadiation: true },
  });
  const t55Sim = speReport.threats.find((t) => t.id === 'T55');
  assert.notEqual(t55Sim?.status, 'DATA UNAVAILABLE', 'T55 under simulated SPE should actively monitor/mitigate');

  // 9. CSV export produces header + all 58 rows
  const csv = exportSafetyReportCsv(baseline);
  const csvLines = csv.trim().split('\n');
  assert.equal(csvLines.length, 59, 'CSV must have 1 header line + 58 threat lines');

  console.log(
    `ALL PASSED: 58/58 threats verified | Baseline (${baseline.simulationOutcome}: ${baseline.counts.mitigated} mitigated, ${baseline.counts.monitoring} monitoring, ${baseline.counts.dataUnavailable} data unavailable)`,
  );
}

runTests();
