export type ThreatCategoryId =
  | 'terrain'
  | 'illumination'
  | 'navigation'
  | 'propulsion'
  | 'dust-plume'
  | 'structural'
  | 'communications'
  | 'environmental';

export type ThreatStatus =
  | 'DETECTED'
  | 'UNDER ANALYSIS'
  | 'MITIGATION ACTIVE'
  | 'MITIGATED'
  | 'MONITORING'
  | 'UNRESOLVED'
  | 'ABORT REQUIRED'
  | 'DATA UNAVAILABLE';

export type ThreatSeverity = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export type ThreatConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE';

export type DataClassification =
  | 'Measured'
  | 'Derived'
  | 'Estimated'
  | 'Simulated'
  | 'Assumed'
  | 'Unavailable';

export type ThreatLifecycleStage =
  | 'DETECTION'
  | 'CLASSIFICATION'
  | 'DATA VALIDATION'
  | 'RISK ASSESSMENT'
  | 'MITIGATION SELECTION'
  | 'SIMULATED MITIGATION'
  | 'POST-MITIGATION MEASUREMENT'
  | 'VERIFICATION'
  | 'STATUS UPDATE';

export type ThreatMissionPhase =
  | 'Pre-Descent & Planning'
  | 'Deorbit & Approach'
  | 'Powered Descent'
  | 'Terminal Hazard Avoidance'
  | 'Touchdown & Post-Landing'
  | 'All Descent Phases';

export interface ThreatHistoryEntry {
  timestampUtc: string;
  coordinateLabel: string;
  status: ThreatStatus;
  metricSummary: string;
  mitigationApplied: string;
  verified: boolean;
}

export interface ThreatDefinition {
  id: string; // T01..T58
  category: ThreatCategoryId;
  categoryLabel: string;
  name: string;
  description: string;
  detectionMethod: string;
  requiredSensorOrDataset: string;
  severity: ThreatSeverity;
  missionPhase: ThreatMissionPhase;
  consequences: string;
  mitigationStrategy: string;
  recoveryStrategy: string;
  verificationCriteria: string;
  dataClassification: DataClassification;
}

export interface EvaluatedThreat extends ThreatDefinition {
  status: ThreatStatus;
  confidence: ThreatConfidence;
  probabilityEstimate: number | null; // 0..1 when scientifically grounded or scenario-computed, else null
  lifecycleStage: ThreatLifecycleStage;
  measuredValue: string;
  postMitigationValue: string;
  verificationPassed: boolean;
  verificationNote: string;
  history: ThreatHistoryEntry[];
}

export interface AcceptanceCriteriaConfig {
  maxPadSlopeDeg: number; // Default 12°
  maxAbortSlopeDeg: number; // Default 16°
  minCraterClearanceKm: number; // Default 0.6 km
  minSolarElevationDeg: number; // Default 5°
  minOpticalConfidence: number; // Default 0.65
  minNavConfidence: number; // Default 0.72
  maxSensorDisagreementM: number; // Default 25 m
  minPropulsionReservePct: number; // Default 14%
  maxTouchdownTiltDeg: number; // Default 10°
  maxTouchdownVerticalVelMS: number; // Default 3.0 m/s
  minPowerMarginPct: number; // Default 20%
}

export interface FaultInjectionConfig {
  scenarioId: string;
  scenarioName: string;
  active: boolean;
  // Terrain overrides / stress tests
  forceCraterHazard: boolean;
  forceSteepSlopeDeg: number | null;
  // Illumination & camera
  forcePoorIlluminationDeg: number | null;
  cameraFailure: boolean;
  cameraSaturation: boolean;
  syntheticDustObscuration: number; // 0..1
  // Navigation & sensors
  altimeterNoiseM: number; // additional 1-sigma noise (m)
  sensorLatencyMs: number; // 0..1200
  altimeterFault: boolean;
  velocimeterDropout: boolean;
  imuDriftDegPerHr: number;
  // Propulsion
  thrustDegradationPct: number; // 0..50
  actuatorDelayMs: number; // 0..600
  propellantLeakPct: number; // 0..25
  controllerProfile: 'conservative' | 'nominal' | 'aggressive';
  // Structural
  legImbalanceCm: number; // 0..85
  // Comms
  rfBlackout: boolean;
  commsLatencyExtraMs: number;
  // Environmental
  simulatedSpeRadiation: boolean;
  thermalConstraintShiftK: number;
  powerBusDegradationPct: number;
}

export interface TerrainHazardCell {
  r: number;
  c: number;
  lat: number;
  lon: number;
  elevationM: number;
  slopeDeg: number;
  isHiddenDepression: boolean;
  isDiscontinuity: boolean;
  isCandidatePad: boolean;
  isHazard: boolean;
}

export interface TerrainSubsystemState {
  depressionCount: number;
  maxDiscontinuityM: number;
  steepCellCount: number;
  craterHazardCount: number;
  safestPadSlopeDeg: number;
  safestPadNeighborSlopeDeg: number;
  craterClearanceKm: number;
  divertDistanceM: number;
  candidatePadCount: number;
  resolutionMeters: number;
  subMeterBouldersAvailable: boolean;
  inSituRegolithBearingAvailable: boolean;
  hazardCells: TerrainHazardCell[];
}

export interface VisibilitySubsystemState {
  solarElevationDeg: number;
  horizonBlocked: boolean;
  contrastIndex: number; // 0..1
  cameraSaturationRisk: boolean;
  dustObscurationFactor: number; // 0..1
  cameraOperational: boolean;
  opticalNavConfidence: number; // 0..1
  fallbackMode: 'OPTICAL_PRIMARY' | 'ALTIMETER_INERTIAL_FALLBACK' | 'NAVIGATION_UNCERTAIN';
}

export interface NavigationSubsystemState {
  actualAltM: number;
  estimatedAltM: number;
  actualVelMS: number;
  estimatedVelMS: number;
  positionUncertaintyM: number; // 3-sigma
  altimeterNoiseM: number;
  sensorLatencyMs: number;
  sensorDisagreementM: number;
  isolatedSensors: string[];
  navConfidence: number; // 0..1
  landingPermitBlocked: boolean;
  warningEvents: string[];
}

export interface PropulsionSubsystemState {
  controllerProfile: 'conservative' | 'nominal' | 'aggressive';
  commandedThrustN: number;
  simulatedThrustN: number;
  thrustErrorPct: number;
  actuatorDelayMs: number;
  propellantRemainingPct: number;
  attitudeErrorDeg: number;
  hoverMarginPct: number;
  sufficientForLanding: boolean;
  faultFlags: string[];
}

export interface DustPlumeSubsystemState {
  modelNotice: string;
  altitudeM: number;
  impingementPressurePa: number;
  particleFluxIndex: number; // 0..1 normalized synthetic index
  opticalDegradationPct: number;
  sensorContaminationRisk: 'LOW' | 'MODERATE' | 'HIGH';
  surfaceEjectaRadiusM: number;
  nearbyAssetExposureWarn: boolean;
}

export interface StructuralSubsystemState {
  legs: Array<{
    legId: string;
    contact: boolean;
    loadN: number;
    strokeCm: number;
  }>;
  estimatedTiltDeg: number;
  unevenContactDetected: boolean;
  maxLegLoadN: number;
  surfaceSupportUncertainty: 'LOW' | 'HIGH (Regolith Bearing Unavailable)';
  touchdownStable: boolean;
  reason: string;
}

export interface CommsSubsystemState {
  oneWayLightTimeSec: number;
  totalRoundTripLatencyMs: number;
  rfLinkUp: boolean;
  telemetryAvailable: boolean;
  packetLossPct: number;
  onboardAutonomyIntact: boolean;
  configInconsistencies: string[];
}

export interface EnvironmentalSubsystemState {
  derivedTempK: number;
  derivedTempC: number;
  diurnalGradientEstCPerHr: number;
  illuminationPct30d: number;
  solarPowerMarginPct: number;
  realTimeRadiationFlux: 'DATA UNAVAILABLE' | 'SIMULATED_SPE_SCENARIO';
  simulatedDoseMsv: number | null;
  eclipseActive: boolean;
}

export interface MissionSafetyReport {
  generatedAtUtc: string;
  coordinateLabel: string;
  lat: number;
  lon: number;
  facilityName: string;
  simulationOutcome: 'GO_SAFE_LANDING' | 'CONDITIONAL_MONITORING' | 'HOLD_UNRESOLVED' | 'ABORT_REQUIRED';
  outcomeReason: string;
  canClaimLandingSuccess: boolean;
  counts: {
    total: number;
    detected: number;
    mitigated: number;
    mitigationActive: number;
    monitoring: number;
    unresolved: number;
    abortRequired: number;
    dataUnavailable: number;
  };
  threats: EvaluatedThreat[];
  subsystems: {
    terrain: TerrainSubsystemState;
    visibility: VisibilitySubsystemState;
    navigation: NavigationSubsystemState;
    propulsion: PropulsionSubsystemState;
    dustPlume: DustPlumeSubsystemState;
    structural: StructuralSubsystemState;
    comms: CommsSubsystemState;
    environmental: EnvironmentalSubsystemState;
  };
  missingDatasets: string[];
  abortDecisions: string[];
  limitations: string[];
}

export interface ThreatLabScenario {
  id: string;
  name: string;
  targetThreats: string[];
  description: string;
  injection: Partial<FaultInjectionConfig>;
}

export interface ThreatExperimentRun {
  id: string;
  runAtUtc: string;
  scenarioName: string;
  coordinateLabel: string;
  lat: number;
  lon: number;
  injectedFaultsSummary: string;
  controllerProfile: FaultInjectionConfig['controllerProfile'];
  outcome: MissionSafetyReport['simulationOutcome'];
  mitigatedCount: number;
  unresolvedCount: number;
  abortCount: number;
  navConfidence: number;
  safestPadSlopeDeg: number;
  touchdownTiltDeg: number;
  reportSnapshot: MissionSafetyReport;
}
