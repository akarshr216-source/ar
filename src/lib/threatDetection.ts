import type { TerrainAnalysisResult } from '../types/lunar';

export interface ThreatCraterMarker {
  id: string;
  x: number;
  z: number;
  y: number;
  radiusUnits: number;
  diameterKm: number;
  depthM: number | null;
  source?: 'lola' | 'randomized-test';
}

export interface SteepSlopeMarker {
  x: number;
  z: number;
  y: number;
  slopeDeg: number;
}

export interface RandomCraterFeature {
  id: string;
  x: number;
  z: number;
  radiusUnits: number;
  depthM: number;
  rimHeightM: number;
  diameterM: number;
}

export interface RandomBoulderFeature {
  id: string;
  x: number;
  z: number;
  scale: number;
}

export interface RandomizedTestField {
  seed: number;
  targetX: number;
  targetZ: number;
  escapeRadiusM: number;
  extraCraters: RandomCraterFeature[];
  boulders: RandomBoulderFeature[];
}

export interface ThreatAssessmentSummary {
  steepSlopeCellCount: number;
  moderateSlopeCellCount: number;
  craterThreatCount: number;
  craterMarkers: ThreatCraterMarker[];
  steepMarkers: SteepSlopeMarker[];
  targetPoint: {
    x: number;
    z: number;
    lat: number;
    lon: number;
  };
  safestPad: {
    x: number;
    z: number;
    y: number;
    lat: number;
    lon: number;
    offsetNorthM: number;
    offsetEastM: number;
    slopeDeg: number;
    neighborMaxSlopeDeg: number;
    craterClearanceKm: number;
    nearestCraterClearanceM: number;
    nearestCraterDepthM: number | null;
    divertDistanceFromTargetM: number;
    safe: boolean;
  };
  overallThreatLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  threatsDetected: string[];
}

export const SIM_SPAN_UNITS = 40;

const DEG_TO_M_MOON = 30323.0; // ~1,737.4 km * pi / 180

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates an extra randomized hazard crater field + boulders + randomized landing target
 * constrained so a verified safe escape pad always exists within `escapeRadiusM` (default 100 m).
 */
export function generateRandomCraterTestField(
  terrain: TerrainAnalysisResult,
  seed: number = Date.now(),
  escapeRadiusM = 100,
): RandomizedTestField {
  const rand = mulberry32(seed);
  const metersPerUnit = (terrain.radiusKm * 2000) / SIM_SPAN_UNITS;
  const maxEscapeUnits = Math.max(0.15, escapeRadiusM / Math.max(1, metersPerUnit));

  // Pick a randomized target point inside a flat-ish or crater-adjacent sector of the corridor
  const angle = rand() * Math.PI * 2;
  const distUnits = 2.0 + rand() * 5.5;
  const targetX = Number((Math.cos(angle) * distUnits).toFixed(3));
  const targetZ = Number((Math.sin(angle) * distUnits).toFixed(3));

  // Choose one clean safe escape offset <= 100 m from target that no randomized crater is allowed to cover
  const safeAngle = rand() * Math.PI * 2;
  const safeDistUnits = Math.min(maxEscapeUnits * 0.78, Math.max(0.08, maxEscapeUnits * (0.45 + rand() * 0.35)));
  const protectedSafeX = targetX + Math.cos(safeAngle) * safeDistUnits;
  const protectedSafeZ = targetZ + Math.sin(safeAngle) * safeDistUnits;

  const extraCraters: RandomCraterFeature[] = [];
  // Always place 1-2 immediate near-target threat craters to force real threat escape within 100 m
  const immediateCount = 2;
  for (let i = 0; i < immediateCount; i++) {
    const oppAngle = safeAngle + Math.PI + (rand() - 0.5) * 1.3;
    const radiusUnits = 0.75 + rand() * 0.65;
    const offset = radiusUnits * 0.55 + rand() * 0.45;
    const cx = targetX + Math.cos(oppAngle) * offset;
    const cz = targetZ + Math.sin(oppAngle) * offset;
    if (Math.hypot(cx - protectedSafeX, cz - protectedSafeZ) > radiusUnits + 0.32) {
      const depthM = Math.round(45 + rand() * 140);
      extraCraters.push({
        id: `RND-CR-${i + 1}`,
        x: Number(cx.toFixed(3)),
        z: Number(cz.toFixed(3)),
        radiusUnits: Number(radiusUnits.toFixed(3)),
        depthM,
        rimHeightM: Math.round(depthM * 0.22),
        diameterM: Math.round(radiusUnits * 2 * metersPerUnit),
      });
    }
  }

  // Fill out up to 12 additional randomized test craters across the landing zone
  let attempts = 0;
  while (extraCraters.length < 13 && attempts < 80) {
    attempts++;
    const cx = (rand() - 0.5) * 26;
    const cz = (rand() - 0.5) * 26;
    const radiusUnits = 0.65 + rand() * 1.45;
    // Keep the verified 100m escape pad unobstructed
    if (Math.hypot(cx - protectedSafeX, cz - protectedSafeZ) < radiusUnits + 0.55) continue;
    if (extraCraters.some((c) => Math.hypot(c.x - cx, c.z - cz) < c.radiusUnits + radiusUnits * 0.65)) continue;

    const depthM = Math.round(35 + rand() * 195);
    extraCraters.push({
      id: `RND-CR-${extraCraters.length + 1}`,
      x: Number(cx.toFixed(3)),
      z: Number(cz.toFixed(3)),
      radiusUnits: Number(radiusUnits.toFixed(3)),
      depthM,
      rimHeightM: Math.round(depthM * 0.22),
      diameterM: Math.round(radiusUnits * 2 * metersPerUnit),
    });
  }

  const boulders: RandomBoulderFeature[] = [];
  for (let i = 0; i < 28; i++) {
    const bx = (rand() - 0.5) * 28;
    const bz = (rand() - 0.5) * 28;
    if (Math.hypot(bx - protectedSafeX, bz - protectedSafeZ) < 0.7) continue;
    boulders.push({
      id: `BLD-${i + 1}`,
      x: Number(bx.toFixed(3)),
      z: Number(bz.toFixed(3)),
      scale: Number((0.18 + rand() * 0.36).toFixed(2)),
    });
  }

  return {
    seed,
    targetX,
    targetZ,
    escapeRadiusM,
    extraCraters,
    boulders,
  };
}

export function simOffsetToLatLon(
  terrain: TerrainAnalysisResult,
  xUnits: number,
  zUnits: number,
): { lat: number; lon: number } {
  const metersPerUnit = (terrain.radiusKm * 2000) / SIM_SPAN_UNITS;
  const northM = -zUnits * metersPerUnit;
  const eastM = xUnits * metersPerUnit;
  const dLat = northM / DEG_TO_M_MOON;
  const cosLat = Math.max(0.08, Math.cos((terrain.centerLat * Math.PI) / 180));
  const dLon = eastM / (DEG_TO_M_MOON * cosLat);
  return {
    lat: Number((terrain.centerLat + dLat).toFixed(4)),
    lon: Number((terrain.centerLon + dLon).toFixed(4)),
  };
}

export function evaluateRandomCraterDisplacementM(
  xUnits: number,
  zUnits: number,
  testField?: RandomizedTestField | null,
): { deltaElevM: number; inducedSlopeDeg: number; insideCrater: boolean } {
  if (!testField || testField.extraCraters.length === 0) {
    return { deltaElevM: 0, inducedSlopeDeg: 0, insideCrater: false };
  }
  let deltaElevM = 0;
  let inducedSlopeDeg = 0;
  let insideCrater = false;

  for (const cr of testField.extraCraters) {
    const d = Math.hypot(xUnits - cr.x, zUnits - cr.z);
    const r = cr.radiusUnits;
    if (d <= r * 1.35) {
      const q = d / r;
      if (q < 0.85) {
        insideCrater = true;
        // Parabolic bowl
        const bowl = -(1 - (q / 0.85) * (q / 0.85)) * cr.depthM;
        deltaElevM += bowl;
        inducedSlopeDeg = Math.max(inducedSlopeDeg, 16 + (q / 0.85) * 14);
      } else if (q < 1.1) {
        insideCrater = true;
        // Raised crater rim
        const t = 1 - Math.abs(q - 0.96) / 0.14;
        deltaElevM += Math.max(0, t) * cr.rimHeightM;
        inducedSlopeDeg = Math.max(inducedSlopeDeg, 14);
      } else {
        // Gentle ejecta apron
        const t = 1 - (q - 1.1) / 0.25;
        deltaElevM += Math.max(0, t) * (cr.rimHeightM * 0.4);
      }
    }
  }
  return { deltaElevM, inducedSlopeDeg, insideCrater };
}

export function runLolaThreatScan(
  terrain: TerrainAnalysisResult,
  solarElevationDeg?: number,
  testField?: RandomizedTestField | null,
  targetOverride?: { x: number; z: number } | null,
): ThreatAssessmentSummary {
  const n = terrain.gridSize;
  const spanUnits = SIM_SPAN_UNITS;
  const relief = Math.max(50, terrain.elevationStats.reliefM);
  const heightScale = 5.5 / relief;
  const centerElev = terrain.centerElevationM;
  const metersPerUnit = (terrain.radiusKm * 2000) / spanUnits;

  const targetX = targetOverride?.x ?? testField?.targetX ?? 0;
  const targetZ = targetOverride?.z ?? testField?.targetZ ?? 0;
  const targetCoord = simOffsetToLatLon(terrain, targetX, targetZ);

  const gridToXZ = (r: number, c: number) => {
    const u = c / Math.max(1, n - 1);
    const v = r / Math.max(1, n - 1);
    return {
      x: (u - 0.5) * spanUnits,
      z: (v - 0.5) * spanUnits,
    };
  };

  const sampleTerrainBase = (x: number, z: number) => {
    const u = Math.max(0, Math.min(1, (x + spanUnits / 2) / spanUnits)) * (n - 1);
    const v = Math.max(0, Math.min(1, (z + spanUnits / 2) / spanUnits)) * (n - 1);
    const r = Math.min(n - 1, Math.max(0, Math.round(v)));
    const c = Math.min(n - 1, Math.max(0, Math.round(u)));
    return {
      elev: terrain.elevationGrid[r][c],
      slope: terrain.slopeGrid[r][c],
      r,
      c,
    };
  };

  // Map detected LOLA craters inside the simulated terrain patch
  const craterMarkers: ThreatCraterMarker[] = [];
  for (const crater of terrain.detectedCraters) {
    if (crater.distanceKm > terrain.radiusKm * 0.95) continue;
    const azRad = (crater.azimuthDeg * Math.PI) / 180;
    const rUnits = (crater.distanceKm / terrain.radiusKm) * (spanUnits / 2);
    const cx = rUnits * Math.sin(azRad);
    const cz = -rUnits * Math.cos(azRad);
    const radiusUnits = Math.max(0.55, ((crater.diameterKm / 2) / terrain.radiusKm) * (spanUnits / 2));
    const cy = (crater.rimElevationM - centerElev) * heightScale;
    craterMarkers.push({
      id: crater.id,
      x: cx,
      z: cz,
      y: cy,
      radiusUnits,
      diameterKm: crater.diameterKm,
      depthM: crater.depthM,
      source: 'lola',
    });
  }

  // Include randomized extra craters
  if (testField) {
    for (const rc of testField.extraCraters) {
      const base = sampleTerrainBase(rc.x, rc.z);
      craterMarkers.push({
        id: rc.id,
        x: rc.x,
        z: rc.z,
        y: (base.elev + rc.rimHeightM - centerElev) * heightScale,
        radiusUnits: rc.radiusUnits,
        diameterKm: Number((rc.diameterM / 1000).toFixed(3)),
        depthM: rc.depthM,
        source: 'randomized-test',
      });
    }
  }

  let steepSlopeCellCount = 0;
  let moderateSlopeCellCount = 0;
  const steepCandidates: SteepSlopeMarker[] = [];

  for (let r = 1; r < n - 1; r++) {
    for (let c = 1; c < n - 1; c++) {
      const slope = terrain.slopeGrid[r][c];
      const elev = terrain.elevationGrid[r][c];
      const y = (elev - centerElev) * heightScale;
      const { x, z } = gridToXZ(r, c);

      if (slope >= 12) {
        steepSlopeCellCount++;
        if (Math.hypot(x, z) < 16) {
          steepCandidates.push({ x, z, y, slopeDeg: slope });
        }
      } else if (slope >= 8) {
        moderateSlopeCellCount++;
      }
    }
  }

  // Helper to score a candidate (x, z) point
  let bestCost = Number.POSITIVE_INFINITY;
  let safest = {
    x: targetX,
    z: targetZ,
    y: (sampleTerrainBase(targetX, targetZ).elev - centerElev) * heightScale,
    slopeDeg: terrain.slopeStats.meanDeg,
    neighborMaxSlopeDeg: terrain.slopeStats.meanDeg,
    craterClearanceKm: 99,
    nearestCraterClearanceM: 99000,
    nearestCraterDepthM: null as number | null,
  };

  const evaluateCandidate = (x: number, z: number, enforceEscapeRadius: boolean) => {
    const base = sampleTerrainBase(x, z);
    const randDisp = evaluateRandomCraterDisplacementM(x, z, testField);
    if (randDisp.insideCrater) return; // Never select a pad inside a crater

    // Ensure point is outside all crater markers (both LOLA and randomized)
    let minClearanceM = 99000;
    let nearestDepthM: number | null = null;
    for (const cr of craterMarkers) {
      const distUnits = Math.hypot(x - cr.x, z - cr.z);
      const edgeDistUnits = distUnits - cr.radiusUnits * 1.12;
      const edgeDistM = edgeDistUnits * metersPerUnit;
      if (edgeDistM < minClearanceM) {
        minClearanceM = edgeDistM;
        nearestDepthM = cr.depthM;
      }
    }
    if (minClearanceM < 0) return; // Strict crater avoidance

    const divertM = Math.hypot(x - targetX, z - targetZ) * metersPerUnit;
    if (enforceEscapeRadius && testField && divertM > testField.escapeRadiusM) return;

    // 3x3 neighborhood slope & relief roughness check
    let neighborMaxSlope = Math.max(base.slope, randDisp.inducedSlopeDeg);
    let elevMin = base.elev;
    let elevMax = base.elev;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = Math.min(n - 1, Math.max(0, base.r + dr));
        const cc = Math.min(n - 1, Math.max(0, base.c + dc));
        const ns = terrain.slopeGrid[rr][cc];
        const ne = terrain.elevationGrid[rr][cc];
        if (ns > neighborMaxSlope) neighborMaxSlope = ns;
        if (ne < elevMin) elevMin = ne;
        if (ne > elevMax) elevMax = ne;
      }
    }
    const localReliefM = elevMax - elevMin;
    const effSlope = Math.max(base.slope, randDisp.inducedSlopeDeg);

    // Boulder clearance when randomized test field active
    let boulderPenalty = 0;
    if (testField) {
      for (const b of testField.boulders) {
        const bd = Math.hypot(x - b.x, z - b.z);
        if (bd < 0.65) boulderPenalty += 80;
      }
    }

    const craterPenalty = minClearanceM < 150 ? 28 : minClearanceM < 450 ? 8 : 0;
    const slopePenalty = effSlope > 12 ? 95 + effSlope * 4 : effSlope * 2.4;
    const cost =
      slopePenalty +
      neighborMaxSlope * 1.1 +
      (localReliefM / 500) * 5 +
      craterPenalty +
      boulderPenalty +
      (divertM / 100) * 1.25;

    if (cost < bestCost) {
      bestCost = cost;
      safest = {
        x,
        z,
        y: (base.elev + randDisp.deltaElevM - centerElev) * heightScale,
        slopeDeg: effSlope,
        neighborMaxSlopeDeg: neighborMaxSlope,
        craterClearanceKm: Number((minClearanceM / 1000).toFixed(3)),
        nearestCraterClearanceM: Math.round(minClearanceM),
        nearestCraterDepthM: nearestDepthM,
      };
    }
  };

  if (testField) {
    // High-resolution polar ring sweep within the <= 100 m escape radius around targetX, targetZ
    const maxUnits = Math.max(0.12, testField.escapeRadiusM / Math.max(1, metersPerUnit));
    for (let ring = 0; ring <= 8; ring++) {
      const rU = (ring / 8) * maxUnits;
      const steps = ring === 0 ? 1 : 24;
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * Math.PI * 2;
        evaluateCandidate(targetX + Math.cos(ang) * rU, targetZ + Math.sin(ang) * rU, true);
      }
    }
  }

  // Fall back / standard LOLA grid search if no escape pad found yet or standard mode
  if (!Number.isFinite(bestCost)) {
    for (let r = 1; r < n - 1; r++) {
      for (let c = 1; c < n - 1; c++) {
        const { x, z } = gridToXZ(r, c);
        if (Math.hypot(x, z) > 14) continue;
        evaluateCandidate(x, z, false);
      }
    }
  }

  // Last-resort fallback if every cell had a small crater edge overlap
  if (!Number.isFinite(bestCost)) {
    for (let r = 2; r < n - 2; r++) {
      for (let c = 2; c < n - 2; c++) {
        const { x, z } = gridToXZ(r, c);
        const slope = terrain.slopeGrid[r][c];
        const elev = terrain.elevationGrid[r][c];
        const cost = slope * 3 + Math.hypot(x - targetX, z - targetZ);
        if (cost < bestCost) {
          bestCost = cost;
          safest = {
            x,
            z,
            y: (elev - centerElev) * heightScale,
            slopeDeg: slope,
            neighborMaxSlopeDeg: slope,
            craterClearanceKm: 0.25,
            nearestCraterClearanceM: 250,
            nearestCraterDepthM: craterMarkers[0]?.depthM ?? null,
          };
        }
      }
    }
  }

  // Pick top 6 steepest distinct hazard hotspots for crisp 3D markers
  steepCandidates.sort((a, b) => b.slopeDeg - a.slopeDeg);
  const steepMarkers: SteepSlopeMarker[] = [];
  for (const cand of steepCandidates) {
    if (steepMarkers.every((m) => Math.hypot(m.x - cand.x, m.z - cand.z) > 2.4)) {
      steepMarkers.push(cand);
      if (steepMarkers.length >= 6) break;
    }
  }

  const padSafe = safest.slopeDeg <= 16 && safest.neighborMaxSlopeDeg <= 22;
  const divertDistanceFromTargetM = Math.round(Math.hypot(safest.x - targetX, safest.z - targetZ) * metersPerUnit);
  const safeCoord = simOffsetToLatLon(terrain, safest.x, safest.z);

  const threatsDetected: string[] = [];
  if (steepSlopeCellCount > 0) {
    threatsDetected.push(`${steepSlopeCellCount} high-slope LOLA cells (>=12°, max ${terrain.slopeStats.maxDeg}°)`);
  }
  if (craterMarkers.length > 0) {
    threatsDetected.push(`${craterMarkers.length} crater depression hazard(s) within landing corridor`);
  }
  if (testField) {
    threatsDetected.push(
      `${testField.extraCraters.length} randomized test craters + ${testField.boulders.length} boulders (<= ${testField.escapeRadiusM} m escape active)`,
    );
  }
  if (terrain.roughness.triMeters > 80) {
    threatsDetected.push(`Elevated topographic roughness index (TRI ${terrain.roughness.triMeters} m)`);
  }
  if (solarElevationDeg !== undefined && solarElevationDeg <= 0) {
    threatsDetected.push(`Low/negative solar elevation (${solarElevationDeg.toFixed(1)}°) — optical shadow hazard`);
  } else if (solarElevationDeg !== undefined && solarElevationDeg < 7) {
    threatsDetected.push(`Grazing solar angle (${solarElevationDeg.toFixed(1)}°) — long crater shadows`);
  }
  if (threatsDetected.length === 0) {
    threatsDetected.push('No regional LOLA macro-slope or crater rim threats detected in landing corridor');
  }

  let overallThreatLevel: ThreatAssessmentSummary['overallThreatLevel'] = 'LOW';
  if (!padSafe) overallThreatLevel = 'CRITICAL';
  else if (steepSlopeCellCount > 25 || craterMarkers.length >= 3 || terrain.slopeStats.p95Deg > 15 || Boolean(testField)) {
    overallThreatLevel = 'HIGH';
  } else if (steepSlopeCellCount > 0 || craterMarkers.length > 0 || moderateSlopeCellCount > 15) {
    overallThreatLevel = 'MODERATE';
  }

  return {
    steepSlopeCellCount,
    moderateSlopeCellCount,
    craterThreatCount: craterMarkers.length,
    craterMarkers,
    steepMarkers,
    targetPoint: {
      x: targetX,
      z: targetZ,
      lat: targetCoord.lat,
      lon: targetCoord.lon,
    },
    safestPad: {
      x: safest.x,
      z: safest.z,
      y: safest.y,
      lat: safeCoord.lat,
      lon: safeCoord.lon,
      offsetNorthM: Math.round(-safest.z * metersPerUnit),
      offsetEastM: Math.round(safest.x * metersPerUnit),
      slopeDeg: Number(safest.slopeDeg.toFixed(2)),
      neighborMaxSlopeDeg: Number(safest.neighborMaxSlopeDeg.toFixed(2)),
      craterClearanceKm: safest.craterClearanceKm,
      nearestCraterClearanceM: safest.nearestCraterClearanceM,
      nearestCraterDepthM: safest.nearestCraterDepthM,
      divertDistanceFromTargetM,
      safe: padSafe,
    },
    overallThreatLevel,
    threatsDetected,
  };
}
