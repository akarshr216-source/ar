import type { TerrainAnalysisResult } from '../types/lunar';
import type { IlluminationWindowSummary, LunarIlluminationState } from './lunarEphemeris';
import { runLolaThreatScan } from './threatDetection';
import type {
  AcceptanceCriteriaConfig,
  CommsSubsystemState,
  DustPlumeSubsystemState,
  EnvironmentalSubsystemState,
  FaultInjectionConfig,
  NavigationSubsystemState,
  PropulsionSubsystemState,
  StructuralSubsystemState,
  TerrainHazardCell,
  TerrainSubsystemState,
  VisibilitySubsystemState,
} from '../types/threats';

export function evaluateTerrainSubsystem(
  terrain: TerrainAnalysisResult,
  criteria: AcceptanceCriteriaConfig,
  fault: FaultInjectionConfig,
): TerrainSubsystemState {
  const n = terrain.gridSize;
  const scan = runLolaThreatScan(terrain);

  let depressionCount = 0;
  let maxDiscontinuityM = 0;
  let candidatePadCount = 0;
  const hazardCells: TerrainHazardCell[] = [];

  const degPerCell = (terrain.cellSpacingKm / 1737.4) * (180 / Math.PI);
  const cosLat = Math.max(0.1, Math.cos((terrain.centerLat * Math.PI) / 180));

  for (let r = 1; r < n - 1; r++) {
    for (let c = 1; c < n - 1; c++) {
      const e = terrain.elevationGrid[r][c];
      const baseSlope = terrain.slopeGrid[r][c];
      const slope =
        fault.active && fault.forceSteepSlopeDeg !== null
          ? Math.max(baseSlope, fault.forceSteepSlopeDeg)
          : baseSlope;

      const neighbors = [
        terrain.elevationGrid[r - 1][c - 1],
        terrain.elevationGrid[r - 1][c],
        terrain.elevationGrid[r - 1][c + 1],
        terrain.elevationGrid[r][c - 1],
        terrain.elevationGrid[r][c + 1],
        terrain.elevationGrid[r + 1][c - 1],
        terrain.elevationGrid[r + 1][c],
        terrain.elevationGrid[r + 1][c + 1],
      ];
      const minN = Math.min(...neighbors);
      // Hidden depression: center strictly recessed >= 45m below all 8 neighbors
      const isHiddenDepression = e < minN - 45;
      if (isHiddenDepression) depressionCount++;

      // Step discontinuity across immediate 4-neighbors
      const orthoDiffs = [
        Math.abs(e - terrain.elevationGrid[r - 1][c]),
        Math.abs(e - terrain.elevationGrid[r + 1][c]),
        Math.abs(e - terrain.elevationGrid[r][c - 1]),
        Math.abs(e - terrain.elevationGrid[r][c + 1]),
      ];
      const cellMaxStep = Math.max(...orthoDiffs);
      if (cellMaxStep > maxDiscontinuityM) maxDiscontinuityM = cellMaxStep;
      const isDiscontinuity = cellMaxStep >= 420;

      const isHazard = slope > criteria.maxPadSlopeDeg || isHiddenDepression || isDiscontinuity;
      const isCandidatePad = !isHazard && slope <= criteria.maxPadSlopeDeg;
      if (isCandidatePad) candidatePadCount++;

      const dR = r - (n - 1) / 2;
      const dC = c - (n - 1) / 2;
      hazardCells.push({
        r,
        c,
        lat: Number((terrain.centerLat - dR * degPerCell).toFixed(4)),
        lon: Number((terrain.centerLon + (dC * degPerCell) / cosLat).toFixed(4)),
        elevationM: Number(e.toFixed(1)),
        slopeDeg: Number(slope.toFixed(2)),
        isHiddenDepression,
        isDiscontinuity,
        isCandidatePad,
        isHazard,
      });
    }
  }

  const injectedSlope = fault.active && fault.forceSteepSlopeDeg !== null ? fault.forceSteepSlopeDeg : null;
  const safestPadSlopeDeg =
    injectedSlope !== null ? Math.max(scan.safestPad.slopeDeg, injectedSlope) : scan.safestPad.slopeDeg;
  const safestPadNeighborSlopeDeg =
    injectedSlope !== null
      ? Math.max(scan.safestPad.neighborMaxSlopeDeg, injectedSlope + 1.4)
      : scan.safestPad.neighborMaxSlopeDeg;

  const craterHazardCount =
    fault.active && fault.forceCraterHazard ? Math.max(2, scan.craterThreatCount) : scan.craterThreatCount;
  const craterClearanceKm =
    fault.active && fault.forceCraterHazard ? 0.25 : scan.safestPad.craterClearanceKm;

  return {
    depressionCount,
    maxDiscontinuityM: Math.round(maxDiscontinuityM),
    steepCellCount:
      injectedSlope !== null && injectedSlope >= 12 ? hazardCells.length : scan.steepSlopeCellCount,
    craterHazardCount,
    safestPadSlopeDeg: Number(safestPadSlopeDeg.toFixed(2)),
    safestPadNeighborSlopeDeg: Number(safestPadNeighborSlopeDeg.toFixed(2)),
    craterClearanceKm: Number(craterClearanceKm.toFixed(2)),
    divertDistanceM: scan.safestPad.divertDistanceFromTargetM,
    candidatePadCount: injectedSlope !== null && injectedSlope > criteria.maxPadSlopeDeg ? 0 : candidatePadCount,
    resolutionMeters: terrain.provenance.resolutionMetersAtEquator,
    subMeterBouldersAvailable: false, // LOLA LDEM_16 is 1,895 m/px; LROC NAC sub-meter map not installed
    inSituRegolithBearingAvailable: false, // No local penetrometer data
    hazardCells,
  };
}

export function evaluateVisibilitySubsystem(
  terrain: TerrainAnalysisResult,
  illuminationNow: LunarIlluminationState,
  criteria: AcceptanceCriteriaConfig,
  fault: FaultInjectionConfig,
): VisibilitySubsystemState {
  const effectiveSolarDeg =
    fault.active && fault.forcePoorIlluminationDeg !== null
      ? fault.forcePoorIlluminationDeg
      : illuminationNow.solarElevationDeg;

  const horizonBlocked = effectiveSolarDeg <= terrain.horizonAnalysis.meanHorizonDeg * 0.5 && effectiveSolarDeg <= 0;
  const cameraOperational = !(fault.active && fault.cameraFailure);
  const cameraSaturationRisk = fault.active && fault.cameraSaturation;
  const dustObscurationFactor = Number(
    Math.min(1, Math.max(0, fault.syntheticDustObscuration)).toFixed(2),
  );

  // Optical contrast peaks around moderate Sun elevation (12°-40°) and degrades in shadow, glare, or dust
  let contrastIndex = 0;
  if (effectiveSolarDeg > 0) {
    const sunBand = Math.sin(Math.min(Math.PI / 2, (effectiveSolarDeg / 45) * (Math.PI / 2)));
    const highNoonWashout = effectiveSolarDeg > 70 ? 0.72 : 1;
    contrastIndex = Math.max(0.08, Math.min(0.95, 0.25 + 0.68 * sunBand * highNoonWashout));
  }
  if (cameraSaturationRisk) contrastIndex *= 0.22;
  contrastIndex *= 1 - dustObscurationFactor * 0.78;
  if (!cameraOperational) contrastIndex = 0;

  let opticalNavConfidence = contrastIndex;
  if (!cameraOperational || effectiveSolarDeg <= 0) {
    opticalNavConfidence = 0;
  } else if (effectiveSolarDeg < criteria.minSolarElevationDeg) {
    opticalNavConfidence *= 0.62;
  }
  opticalNavConfidence = Number(Math.max(0, Math.min(1, opticalNavConfidence)).toFixed(2));

  let fallbackMode: VisibilitySubsystemState['fallbackMode'] = 'OPTICAL_PRIMARY';
  if (opticalNavConfidence < criteria.minOpticalConfidence) {
    const altimeterHealthy = !(fault.active && fault.altimeterFault) && !(fault.active && fault.altimeterNoiseM > 25);
    fallbackMode = altimeterHealthy ? 'ALTIMETER_INERTIAL_FALLBACK' : 'NAVIGATION_UNCERTAIN';
  }

  return {
    solarElevationDeg: Number(effectiveSolarDeg.toFixed(2)),
    horizonBlocked,
    contrastIndex: Number(contrastIndex.toFixed(2)),
    cameraSaturationRisk,
    dustObscurationFactor,
    cameraOperational,
    opticalNavConfidence,
    fallbackMode,
  };
}

export function evaluateNavigationSubsystem(
  terrain: TerrainAnalysisResult,
  visibility: VisibilitySubsystemState,
  criteria: AcceptanceCriteriaConfig,
  fault: FaultInjectionConfig,
): NavigationSubsystemState {
  // Reference terminal approach snapshot at ~120 m AGL
  const actualAltM = 120.0;
  const actualVelMS = -2.4;

  const altNoise = fault.active ? fault.altimeterNoiseM : 1.5;
  const latencyMs = fault.active ? fault.sensorLatencyMs : 65;
  const imuDrift = fault.active ? fault.imuDriftDegPerHr : 0.15;
  const altFault = fault.active && fault.altimeterFault;
  const velDropout = fault.active && fault.velocimeterDropout;

  const isolatedSensors: string[] = [];
  const warningEvents: string[] = [];

  if (altFault) {
    isolatedSensors.push('Radar Altimeter Channel A (Bias Fault)');
    warningEvents.push('Radar altimeter range outlier exceeded 3-sigma innovation gate and was isolated.');
  }
  if (velDropout) {
    isolatedSensors.push('Doppler Velocimeter (Surface Lock Lost)');
    warningEvents.push('Doppler horizontal velocity lost; relying on optical flow / IMU dead-reckoning.');
  }
  if (!visibility.cameraOperational) {
    isolatedSensors.push('Optical Nadir TRN Camera (Offline)');
    warningEvents.push('Optical camera offline — landmark TRN correlation unavailable.');
  } else if (visibility.cameraSaturationRisk) {
    warningEvents.push('Optical frames saturated; weight shifted toward inertial propagation.');
  }

  // Compute disagreement between radar altimeter and optical/DEM expected height
  const altimeterBiasM = altFault ? 46.5 : 0;
  const rawSensorDisagreementM = altimeterBiasM + altNoise * 0.45 + (visibility.cameraOperational ? 1.2 : 18.0);
  const sensorDisagreementM = Number(rawSensorDisagreementM.toFixed(1));

  // Position uncertainty (3-sigma meters) grows with DEM pixel spacing effect, latency, noise, and lost sensors
  const latencyErrorM = (latencyMs / 1000) * Math.abs(actualVelMS) * 1.4;
  const demRegUncertaintyM = Math.min(18, terrain.slopeStats.meanDeg * 0.9);
  const altTerm = altFault ? 38 : altNoise * 1.35;
  const velTerm = velDropout && !visibility.cameraOperational ? 26 : velDropout ? 11 : 1.2;
  const imuTerm = Math.min(15, imuDrift * 1.8);
  const positionUncertaintyM = Number((2.5 + latencyErrorM + altTerm + velTerm + imuTerm + demRegUncertaintyM * 0.25).toFixed(1));

  const estimatedAltM = Number((actualAltM + (altFault ? 28.4 : altNoise * 0.35)).toFixed(1));
  const estimatedVelMS = Number((actualVelMS + (velDropout ? -0.95 : -0.06)).toFixed(2));

  // Weighted navigation integrity confidence 0..1
  let conf = 0.96;
  if (altFault) conf -= 0.34;
  if (velDropout) conf -= 0.16;
  if (!visibility.cameraOperational) conf -= 0.18;
  else if (visibility.opticalNavConfidence < criteria.minOpticalConfidence) conf -= 0.08;
  if (altNoise > 12) conf -= Math.min(0.28, (altNoise - 12) * 0.008);
  if (latencyMs > 180) conf -= Math.min(0.18, (latencyMs - 180) * 0.0004);
  if (sensorDisagreementM > criteria.maxSensorDisagreementM) conf -= 0.18;

  const navConfidence = Number(Math.max(0.05, Math.min(0.99, conf)).toFixed(2));
  const landingPermitBlocked =
    navConfidence < criteria.minNavConfidence ||
    (altFault && !visibility.cameraOperational) ||
    sensorDisagreementM > criteria.maxSensorDisagreementM * 1.4;

  if (landingPermitBlocked) {
    warningEvents.push(
      `Navigation confidence (${(navConfidence * 100).toFixed(0)}%) below ${(criteria.minNavConfidence * 100).toFixed(0)}% threshold — landing success claim BLOCKED.`,
    );
  }

  return {
    actualAltM,
    estimatedAltM,
    actualVelMS,
    estimatedVelMS,
    positionUncertaintyM,
    altimeterNoiseM: altNoise,
    sensorLatencyMs: latencyMs,
    sensorDisagreementM,
    isolatedSensors,
    navConfidence,
    landingPermitBlocked,
    warningEvents,
  };
}

export function evaluatePropulsionSubsystem(
  terrainStats: TerrainSubsystemState,
  criteria: AcceptanceCriteriaConfig,
  fault: FaultInjectionConfig,
): PropulsionSubsystemState {
  const controllerProfile = fault.controllerProfile;
  const thrustDegrad = fault.active ? fault.thrustDegradationPct : 0;
  const actuatorDelayMs = fault.active ? fault.actuatorDelayMs : 45;
  const leakPct = fault.active ? fault.propellantLeakPct : 0;

  // Virtual 8,000 kg lunar lander descent hover thrust ~12,976 N (g_moon = 1.622 m/s^2)
  const lunarWeightN = 8000 * 1.622;
  const maxRatedThrustN = 26000;
  const commandedThrustN = controllerProfile === 'aggressive' ? 16800 : controllerProfile === 'conservative' ? 14200 : 15200;
  const simulatedThrustN = Math.round(commandedThrustN * (1 - thrustDegrad / 100));
  const availableMaxThrustN = maxRatedThrustN * (1 - thrustDegrad / 100);
  const hoverMarginPct = Number((((availableMaxThrustN - lunarWeightN) / availableMaxThrustN) * 100).toFixed(1));

  // Divert propellant cost + profile penalty + injected leak
  const divertFuelCostPct = Math.min(18, (terrainStats.divertDistanceM / 1000) * 1.15);
  const profileBurnPenalty = controllerProfile === 'aggressive' ? 4.5 : controllerProfile === 'conservative' ? 1.2 : 2.2;
  const propellantRemainingPct = Number(Math.max(0, 34.0 - divertFuelCostPct - profileBurnPenalty - leakPct).toFixed(1));

  const lagAttitudePenalty = actuatorDelayMs > 200 ? (actuatorDelayMs - 200) * 0.015 : 0;
  const profileJitter = controllerProfile === 'aggressive' ? 1.9 : controllerProfile === 'conservative' ? 0.45 : 0.9;
  const attitudeErrorDeg = Number((profileJitter + lagAttitudePenalty + (thrustDegrad > 20 ? 1.8 : 0)).toFixed(2));

  const faultFlags: string[] = [];
  if (thrustDegrad > 15) faultFlags.push(`Thrust loss ${thrustDegrad}% exceeds 15% nominal bound`);
  if (actuatorDelayMs > 160 && controllerProfile !== 'conservative') {
    faultFlags.push(`Actuator delay ${actuatorDelayMs} ms risks terminal bounce with ${controllerProfile} gains`);
  }
  if (propellantRemainingPct < criteria.minPropulsionReservePct) {
    faultFlags.push(`Propellant reserve ${propellantRemainingPct}% below ${criteria.minPropulsionReservePct}% floor`);
  }
  if (hoverMarginPct < 10) {
    faultFlags.push(`Hover T/W margin critically low (${hoverMarginPct}%)`);
  }

  const sufficientForLanding =
    hoverMarginPct >= 10 &&
    propellantRemainingPct >= criteria.minPropulsionReservePct &&
    thrustDegrad <= 28;

  return {
    controllerProfile,
    commandedThrustN,
    simulatedThrustN,
    thrustErrorPct: Number(thrustDegrad.toFixed(1)),
    actuatorDelayMs,
    propellantRemainingPct,
    attitudeErrorDeg,
    hoverMarginPct,
    sufficientForLanding,
    faultFlags,
  };
}

export function evaluateDustPlumeSubsystem(
  visibility: VisibilitySubsystemState,
  fault: FaultInjectionConfig,
): DustPlumeSubsystemState {
  const altitudeM = 18;
  const dustObs = visibility.dustObscurationFactor;
  const thrustRatio = fault.active ? 1 - fault.thrustDegradationPct / 100 : 1;

  // Research-grade qualitative scaling (NASA PSI / SPLICE conceptual scaling — explicitly NOT a validated DSMC/CFD solver)
  const impingementPressurePa = Math.round(1850 * thrustRatio * Math.pow(15 / Math.max(5, altitudeM), 1.6));
  const particleFluxIndex = Number(Math.min(1, dustObs * 0.85 + 0.15).toFixed(2));
  const opticalDegradationPct = Math.round(particleFluxIndex * 88);
  const surfaceEjectaRadiusM = Math.round(240 + particleFluxIndex * 620);

  const sensorContaminationRisk: DustPlumeSubsystemState['sensorContaminationRisk'] =
    particleFluxIndex >= 0.72 ? 'HIGH' : particleFluxIndex >= 0.4 ? 'MODERATE' : 'LOW';

  return {
    modelNotice: 'Synthetic Research Scaling Model (NASA PSI/SPLICE conceptual boundary — NOT a validated CFD/DSMC plume solver)',
    altitudeM,
    impingementPressurePa,
    particleFluxIndex,
    opticalDegradationPct,
    sensorContaminationRisk,
    surfaceEjectaRadiusM,
    nearbyAssetExposureWarn: surfaceEjectaRadiusM > 650,
  };
}

export function evaluateStructuralSubsystem(
  terrainState: TerrainSubsystemState,
  propulsion: PropulsionSubsystemState,
  criteria: AcceptanceCriteriaConfig,
  fault: FaultInjectionConfig,
): StructuralSubsystemState {
  const imbalanceCm = fault.active ? fault.legImbalanceCm : 0;
  const padSlopeDeg = terrainState.safestPadSlopeDeg;
  const landingSinkMS = propulsion.sufficientForLanding ? 1.1 : 4.2;

  // Approximate 4.2 m footpad span stance -> differential stroke from slope + fault imbalance
  const slopeDropCm = Math.tan((padSlopeDeg * Math.PI) / 180) * 420;
  const totalTiltRad = Math.atan((slopeDropCm + imbalanceCm) / 420);
  const estimatedTiltDeg = Number(((totalTiltRad * 180) / Math.PI).toFixed(2));

  const nominalLegLoadN = 8000 * 1.622 * 0.25 * (landingSinkMS > 3 ? 4.4 : 1.35);
  const legs = [
    { legId: 'Leg 1 (+X)', contact: true, loadN: Math.round(nominalLegLoadN * (1 + padSlopeDeg * 0.02)), strokeCm: Number((4 + slopeDropCm * 0.2).toFixed(1)) },
    { legId: 'Leg 2 (+Z)', contact: true, loadN: Math.round(nominalLegLoadN * 0.96), strokeCm: 5.2 },
    {
      legId: 'Leg 3 (-X)',
      contact: imbalanceCm < 45,
      loadN: imbalanceCm >= 45 ? 0 : Math.round(nominalLegLoadN * 1.18),
      strokeCm: Number((4 + imbalanceCm * 0.45).toFixed(1)),
    },
    { legId: 'Leg 4 (-Z)', contact: true, loadN: Math.round(nominalLegLoadN * 1.12), strokeCm: Number((6 + slopeDropCm * 0.35).toFixed(1)) },
  ];

  const maxLegLoadN = Math.max(...legs.map((l) => l.loadN));
  const unevenContactDetected = legs.some((l) => !l.contact) || imbalanceCm >= 25;
  const touchdownStable =
    estimatedTiltDeg <= criteria.maxTouchdownTiltDeg &&
    !legs.some((l) => !l.contact) &&
    maxLegLoadN <= 45000 &&
    landingSinkMS <= criteria.maxTouchdownVerticalVelMS;

  const reason = !touchdownStable
    ? `Touchdown stability unverified (tilt ${estimatedTiltDeg}°, max leg ${maxLegLoadN} N, ${unevenContactDetected ? 'uneven leg contact' : 'high impact velocity'})`
    : `All 4 footpads seated cleanly at ${estimatedTiltDeg}° tilt (<= ${criteria.maxTouchdownTiltDeg}° threshold)`;

  return {
    legs,
    estimatedTiltDeg,
    unevenContactDetected,
    maxLegLoadN,
    surfaceSupportUncertainty: terrainState.inSituRegolithBearingAvailable
      ? 'LOW'
      : 'HIGH (Regolith Bearing Unavailable)',
    touchdownStable,
    reason,
  };
}

export function evaluateCommsSubsystem(
  earthMoonDistanceKm: number,
  criteria: AcceptanceCriteriaConfig,
  fault: FaultInjectionConfig,
): CommsSubsystemState {
  const oneWayLightTimeSec = Number((earthMoonDistanceKm / 299792.458).toFixed(3));
  const extraMs = fault.active ? fault.commsLatencyExtraMs : 0;
  const totalRoundTripLatencyMs = Math.round(oneWayLightTimeSec * 2000 + 180 + extraMs);
  const rfLinkUp = !(fault.active && fault.rfBlackout);
  const packetLossPct = !rfLinkUp ? 100 : extraMs > 1000 ? 18 : 0.4;

  const configInconsistencies: string[] = [];
  if (criteria.maxPadSlopeDeg > criteria.maxAbortSlopeDeg) {
    configInconsistencies.push(
      `Invalid acceptance thresholds: maxPadSlopeDeg (${criteria.maxPadSlopeDeg}°) exceeds maxAbortSlopeDeg (${criteria.maxAbortSlopeDeg}°).`,
    );
  }
  if (criteria.minNavConfidence < 0.5) {
    configInconsistencies.push(`Unsafe minNavConfidence (${criteria.minNavConfidence}) below 0.50 floor.`);
  }

  return {
    oneWayLightTimeSec,
    totalRoundTripLatencyMs,
    rfLinkUp,
    telemetryAvailable: rfLinkUp,
    packetLossPct,
    onboardAutonomyIntact: true, // Explicit distinction: Earth RF blackout does not disable onboard GNC unless nav fails
    configInconsistencies,
  };
}

export function evaluateEnvironmentalSubsystem(
  illuminationNow: LunarIlluminationState,
  timeline: IlluminationWindowSummary,
  visibility: VisibilitySubsystemState,
  fault: FaultInjectionConfig,
): EnvironmentalSubsystemState {
  const shiftK = fault.active ? fault.thermalConstraintShiftK : 0;
  const derivedTempK = Number(Math.max(40, Math.min(410, illuminationNow.derivedSurfaceTempK + shiftK)).toFixed(1));
  const derivedTempC = Number((derivedTempK - 273.15).toFixed(1));
  const diurnalGradientEstCPerHr = Number((Math.abs(shiftK) > 50 ? 16.4 : visibility.solarElevationDeg < 5 ? 9.2 : 3.1).toFixed(1));

  const powerDegrad = fault.active ? fault.powerBusDegradationPct : 0;
  const solarIncidenceFactor =
    visibility.solarElevationDeg <= 0 ? 0 : Math.min(1, Math.max(0.18, Math.sin((visibility.solarElevationDeg * Math.PI) / 180) * 1.45));
  const solarPowerMarginPct = Number(Math.max(0, 88 * solarIncidenceFactor * (1 - powerDegrad / 100)).toFixed(1));

  const simSpe = fault.active && fault.simulatedSpeRadiation;

  return {
    derivedTempK,
    derivedTempC,
    diurnalGradientEstCPerHr,
    illuminationPct30d: timeline.illuminationPct,
    solarPowerMarginPct,
    realTimeRadiationFlux: simSpe ? 'SIMULATED_SPE_SCENARIO' : 'DATA UNAVAILABLE',
    simulatedDoseMsv: simSpe ? 142.5 : null,
    eclipseActive: visibility.solarElevationDeg <= 0,
  };
}
