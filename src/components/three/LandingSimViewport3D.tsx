import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TerrainAnalysisResult } from '../../types/lunar';
import {
  evaluateRandomCraterDisplacementM,
  runLolaThreatScan,
  SIM_SPAN_UNITS,
  simOffsetToLatLon,
  type RandomizedTestField,
} from '../../lib/threatDetection';
import {
  applyStudioEnvironment,
  buildLunarLanderGroup,
  buildLunarRoverRig,
  createConfiguredRenderer,
  detectSoftwareWebGL,
  scheduleAfterDraw,
} from './ThreeUtils';

export type RoverChoreographyStatus =
  | 'STOWED_IN_BAY'
  | 'RAMP_UNFOLDING'
  | 'EGRESS_DOWN_RAMP'
  | 'NAVCAM_SCAN'
  | 'SURFACE_PATROL';

export interface LandingSequenceStep {
  id: string;
  label: string;
  status: 'PENDING' | 'ACTIVE' | 'DONE' | 'ABORTED';
  detail: string;
}

export interface SimTelemetryFrame {
  simTimeSec: number;
  altitudeM: number;
  verticalVelMS: number;
  horizontalVelMS: number;
  totalSpeedMS: number;
  initialVelMS: number;
  accelerationMS2: number;
  throttlePct: number;
  distanceFromTargetM: number;
  offsetNorthM: number;
  offsetEastM: number;
  predictedLat: number;
  predictedLon: number;
  lolaElevationM: number;
  nearestCraterDepthM: number | null;
  nearestCraterClearanceM: number;
  localSlopeDeg: number;
  phase: 'IDLE' | 'DEORBIT_BRAKE' | 'APPROACH_EVAL' | 'HAZARD_DIVERT' | 'TERMINAL_DESCENT' | 'LANDED' | 'ABORTED';
  hazardStatus: string;
  divertActive: boolean;
  selectedPadSlopeDeg: number;
  initialThreatCredits: number;
  remainingThreatCredits: number;
  landingStepIndex: number;
  landingSteps: LandingSequenceStep[];
  roverStatus: RoverChoreographyStatus;
  roverHeadingDeg: number;
  effectiveSpeedX: number;
}

interface LandingSimViewport3DProps {
  terrain: TerrainAnalysisResult;
  mode: 'manual' | 'assisted' | 'autonomous';
  running: boolean;
  resetSignal: number;
  manualInput: { throttleDelta: number; pitchX: number; rollZ: number };
  lightweightMode: boolean;
  solarElevationDeg: number;
  speedMultiplier: 1 | 5 | 10 | 20;
  autoLandingBoost: boolean;
  randomTestField?: RandomizedTestField | null;
  targetOverride?: { x: number; z: number } | null;
  onMapClickTerrain?: (info: { x: number; z: number; lat: number; lon: number }) => void;
  cameraCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onTelemetry: (frame: SimTelemetryFrame) => void;
}

export function LandingSimViewport3D({
  terrain,
  mode,
  running,
  resetSignal,
  manualInput,
  lightweightMode,
  solarElevationDeg,
  speedMultiplier,
  autoLandingBoost,
  randomTestField,
  targetOverride,
  onMapClickTerrain,
  cameraCanvasRef,
  onTelemetry,
}: LandingSimViewport3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const manualRef = useRef(manualInput);
  manualRef.current = manualInput;
  const speedRef = useRef(speedMultiplier);
  speedRef.current = speedMultiplier;
  const boostRef = useRef(autoLandingBoost);
  boostRef.current = autoLandingBoost;
  const targetOverrideRef = useRef(targetOverride);
  targetOverrideRef.current = targetOverride;
  const onMapClickRef = useRef(onMapClickTerrain);
  onMapClickRef.current = onMapClickTerrain;
  const syncTargetRef = useRef<() => void>(() => {});
  const onTelemetryRef = useRef(onTelemetry);
  onTelemetryRef.current = onTelemetry;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = container.clientWidth || 760;
    const height = container.clientHeight || 460;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070c);
    scene.fog = new THREE.FogExp2(0x05070c, 0.008);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 400);
    camera.position.set(20, 16, 25);

    const renderer = createConfiguredRenderer(width, height, isSoftwareGl, lightweightMode);
    renderer.domElement.style.cursor = 'crosshair';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const envTex = applyStudioEnvironment(renderer, scene);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.maxPolarAngle = Math.PI * 0.48;

    const sunRad = THREE.MathUtils.degToRad(Math.max(5, Math.min(85, solarElevationDeg)));
    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.3);
    keyLight.position.set(Math.cos(sunRad) * 40, Math.sin(sunRad) * 40 + 8, 25);
    keyLight.castShadow = !isSoftwareGl && !lightweightMode;
    scene.add(keyLight);
    scene.add(new THREE.HemisphereLight(0x475569, 0x090d16, 0.38));

    // Deterministic multi-factor LOLA + randomized crater Threat Detection
    let activeThreatScan = runLolaThreatScan(
      terrain,
      solarElevationDeg,
      randomTestField,
      targetOverrideRef.current,
    );

    // Terrain mesh from real NASA LOLA elevationGrid (+ sculpted test craters if active)
    const n = terrain.gridSize;
    const spanUnits = SIM_SPAN_UNITS;
    const minE = terrain.elevationStats.minM;
    const relief = Math.max(50, terrain.elevationStats.reliefM);
    const heightScale = 5.5 / relief;
    const centerElev = terrain.centerElevationM;
    const metersPerUnit = (terrain.radiusKm * 2000) / spanUnits;

    const planeGeo = new THREE.PlaneGeometry(spanUnits, spanUnits, n - 1, n - 1);
    planeGeo.rotateX(-Math.PI / 2);
    const posAttr = planeGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(posAttr.count * 3);
    const col = new THREE.Color();

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const idx = r * n + c;
        const u = c / Math.max(1, n - 1);
        const v = r / Math.max(1, n - 1);
        const vx = (u - 0.5) * spanUnits;
        const vz = (v - 0.5) * spanUnits;

        const randDisp = evaluateRandomCraterDisplacementM(vx, vz, randomTestField);
        const elev = terrain.elevationGrid[r][c] + randDisp.deltaElevM;
        const slope = Math.max(terrain.slopeGrid[r][c], randDisp.inducedSlopeDeg);
        const y = (elev - centerElev) * heightScale;
        posAttr.setY(idx, y);

        if (randDisp.insideCrater) col.setHex(0xd97706);
        else if (slope < 5) col.setHex(0xf1f5f9);
        else if (slope < 10) col.setHex(0xdbeafe);
        else if (slope < 15) col.setHex(0xfbbf24);
        else col.setHex(0xf87171);

        colors[idx * 3] = col.r;
        colors[idx * 3 + 1] = col.g;
        colors[idx * 3 + 2] = col.b;
      }
    }
    planeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    planeGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.03,
      flatShading: false,
    });
    const terrainMesh = new THREE.Mesh(planeGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    let wacTexture: THREE.Texture | null = null;
    const texLoader = new THREE.TextureLoader();
    texLoader.load(
      `/api/nasa/moon-trek/tile?layer=wac&lat=${terrain.centerLat}&lon=${terrain.centerLon}&z=4`,
      (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        wacTexture = tex;
        terrainMat.map = tex;
        terrainMat.needsUpdate = true;
      },
    );

    const gridOverlay = new THREE.GridHelper(spanUnits, 16, 0x1e293b, 0x0f172a);
    gridOverlay.position.y = (minE - centerElev) * heightScale - 0.1;
    scene.add(gridOverlay);

    const sampleGroundY = (sx: number, sz: number): { y: number; slope: number; elevM: number; insideCrater: boolean } => {
      const u = THREE.MathUtils.clamp((sx + spanUnits / 2) / spanUnits, 0, 1) * (n - 1);
      const v = THREE.MathUtils.clamp((sz + spanUnits / 2) / spanUnits, 0, 1) * (n - 1);
      const r = Math.min(n - 1, Math.max(0, Math.round(v)));
      const c = Math.min(n - 1, Math.max(0, Math.round(u)));
      const randDisp = evaluateRandomCraterDisplacementM(sx, sz, randomTestField);
      const elevM = terrain.elevationGrid[r][c] + randDisp.deltaElevM;
      return {
        y: (elevM - centerElev) * heightScale,
        slope: Math.max(terrain.slopeGrid[r][c], randDisp.inducedSlopeDeg),
        elevM,
        insideCrater: randDisp.insideCrater,
      };
    };

    const threatDisposables: Array<{ dispose: () => void }> = [];

    // Crater Hazard Rings (LOLA craters + Randomized Test craters)
    const craterRingMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    threatDisposables.push(craterRingMat);

    for (const cm of activeThreatScan.craterMarkers) {
      const geo = new THREE.RingGeometry(Math.max(0.35, cm.radiusUnits * 0.86), cm.radiusUnits, 28);
      threatDisposables.push(geo);
      const mesh = new THREE.Mesh(geo, craterRingMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cm.x, sampleGroundY(cm.x, cm.z).y + 0.14, cm.z);
      scene.add(mesh);
    }

    // Instanced boulders when Randomized Crater Field is active
    if (randomTestField && randomTestField.boulders.length > 0) {
      const boulderGeo = new THREE.DodecahedronGeometry(0.45, 0);
      const boulderMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.88, metalness: 0.08 });
      const inst = new THREE.InstancedMesh(boulderGeo, boulderMat, randomTestField.boulders.length);
      const dummy = new THREE.Object3D();
      randomTestField.boulders.forEach((b, idx) => {
        const g = sampleGroundY(b.x, b.z);
        dummy.position.set(b.x, g.y + b.scale * 0.25, b.z);
        dummy.scale.setScalar(b.scale);
        dummy.rotation.set(idx * 0.5, idx * 1.1, idx * 0.3);
        dummy.updateMatrix();
        inst.setMatrixAt(idx, dummy.matrix);
      });
      inst.castShadow = true;
      inst.receiveShadow = true;
      scene.add(inst);
      threatDisposables.push(boulderGeo, boulderMat);
    }

    // Steep slope hotspot rings
    const steepRingMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    threatDisposables.push(steepRingMat);

    for (const sm of activeThreatScan.steepMarkers) {
      const geo = new THREE.RingGeometry(0.55, 0.78, 20);
      threatDisposables.push(geo);
      const mesh = new THREE.Mesh(geo, steepRingMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(sm.x, sm.y + 0.14, sm.z);
      scene.add(mesh);
    }

    // 100 m Escape Boundary Circle when randomized test mode is active
    let escRing: THREE.Mesh | null = null;
    if (randomTestField) {
      const escUnits = Math.max(0.4, randomTestField.escapeRadiusM / Math.max(1, metersPerUnit));
      const escGeo = new THREE.RingGeometry(Math.max(0.25, escUnits - 0.08), escUnits, 48);
      const escMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
      escRing = new THREE.Mesh(escGeo, escMat);
      escRing.rotation.x = -Math.PI / 2;
      scene.add(escRing);
      threatDisposables.push(escGeo, escMat);
    }

    // Nominal Target Ring (Cyan) & Verified Safest Divert Pad Ring (Emerald)
    const targetRingGeo = new THREE.RingGeometry(0.8, 1.05, 32);
    const targetRingMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4, side: THREE.DoubleSide });
    const targetRing = new THREE.Mesh(targetRingGeo, targetRingMat);
    targetRing.rotation.x = -Math.PI / 2;
    scene.add(targetRing);
    threatDisposables.push(targetRingGeo, targetRingMat);

    const safeRingGeo = new THREE.RingGeometry(0.85, 1.12, 32);
    const safeRingMat = new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide });
    const safeRing = new THREE.Mesh(safeRingGeo, safeRingMat);
    safeRing.rotation.x = -Math.PI / 2;
    scene.add(safeRing);
    threatDisposables.push(safeRingGeo, safeRingMat);

    // 3D Rover Dispatch Direction Vector Arrow (visible after touchdown / dispatch)
    let dispatchYaw = 0;
    let roverHeadingDeg = 0;
    const dispatchArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0.35, 0),
      5.2,
      0x22d3ee,
      0.85,
      0.45,
    );
    dispatchArrow.visible = false;
    scene.add(dispatchArrow);

    const syncTargetVisuals = () => {
      activeThreatScan = runLolaThreatScan(
        terrain,
        solarElevationDeg,
        randomTestField,
        targetOverrideRef.current,
      );
      const safePad = activeThreatScan.safestPad;
      const targetPt = activeThreatScan.targetPoint;

      const tG = sampleGroundY(targetPt.x, targetPt.z);
      targetRing.position.set(targetPt.x, tG.y + 0.12, targetPt.z);
      if (escRing) escRing.position.set(targetPt.x, tG.y + 0.12, targetPt.z);

      const sG = sampleGroundY(safePad.x, safePad.z);
      safeRing.position.set(safePad.x, sG.y + 0.16, safePad.z);
      safeRingMat.color.setHex(safePad.safe ? 0x10b981 : 0xef4444);

      let bestDirScore = -999;
      for (let deg = 0; deg < 360; deg += 30) {
        const rad = THREE.MathUtils.degToRad(deg);
        const px = safePad.x + Math.sin(rad) * 4.5;
        const pz = safePad.z + Math.cos(rad) * 4.5;
        const g = sampleGroundY(px, pz);
        if (g.insideCrater) continue;
        const minCrDist = activeThreatScan.craterMarkers.reduce(
          (acc, cm) => Math.min(acc, Math.hypot(px - cm.x, pz - cm.z) - cm.radiusUnits),
          99,
        );
        const score = minCrDist * 4 - g.slope;
        if (score > bestDirScore) {
          bestDirScore = score;
          dispatchYaw = rad;
        }
      }
      roverHeadingDeg = Math.round(((THREE.MathUtils.radToDeg(dispatchYaw) % 360) + 360) % 360);
      dispatchArrow.setDirection(new THREE.Vector3(Math.sin(dispatchYaw), 0, Math.cos(dispatchYaw)).normalize());
      dispatchArrow.position.set(safePad.x, sG.y + 0.35, safePad.z);
    };
    syncTargetRef.current = syncTargetVisuals;
    syncTargetVisuals();

    // Guidance Divert Line from Lander to Target/Safe Pad
    const guideLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(activeThreatScan.targetPoint.x + 4.5, 18, activeThreatScan.targetPoint.z - 3.5),
      new THREE.Vector3(activeThreatScan.safestPad.x, safeRing.position.y, activeThreatScan.safestPad.z),
    ]);
    const guideLineMat = new THREE.LineBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.7,
    });
    const guideLine = new THREE.Line(guideLineGeo, guideLineMat);
    scene.add(guideLine);
    threatDisposables.push(guideLineGeo, guideLineMat);

    // Composite Lunar Lander with Hinged Ramp
    const { group: lander, plume, rampPivot } = buildLunarLanderGroup();
    const LANDER_SCALE = 0.85;
    lander.scale.setScalar(LANDER_SCALE);
    scene.add(lander);

    // Composite Articulated Rover (STRICTLY STOWED / HIDDEN during descent!)
    const roverRig = buildLunarRoverRig();
    roverRig.group.scale.setScalar(0.42);
    roverRig.group.visible = false;
    scene.add(roverRig.group);

    const landerCam = new THREE.PerspectiveCamera(55, 1.33, 0.2, 200);

    // Left-click terrain raycasting to control target coordinates
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let downButton = -1;
    const onPointerDown = (e: PointerEvent) => {
      downButton = e.button;
      downX = e.clientX;
      downY = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (downButton !== 0 || e.button !== 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const hits = raycaster.intersectObject(terrainMesh, false);
      if (hits.length > 0) {
        const px = THREE.MathUtils.clamp(Number(hits[0].point.x.toFixed(3)), -16, 16);
        const pz = THREE.MathUtils.clamp(Number(hits[0].point.z.toFixed(3)), -16, 16);
        const coord = simOffsetToLatLon(terrain, px, pz);
        onMapClickRef.current?.({ x: px, z: pz, lat: coord.lat, lon: coord.lon });
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const ALT_SCALE_M = 50;
    const INITIAL_ALT_M = 900;
    const INITIAL_VY = -22;
    const INITIAL_VX = -2.4;
    const INITIAL_VZ = 1.8;
    const INITIAL_SPEED_MS = Number(Math.hypot(INITIAL_VY, INITIAL_VX, INITIAL_VZ).toFixed(2));
    const initialThreatCredits = Math.max(
      12,
      Math.round(activeThreatScan.craterThreatCount * 6 + activeThreatScan.steepSlopeCellCount * 0.45 + 14),
    );

    const state = {
      simTime: 0,
      x: activeThreatScan.targetPoint.x + 4.2,
      z: activeThreatScan.targetPoint.z - 3.4,
      altM: INITIAL_ALT_M,
      vy: INITIAL_VY,
      vx: INITIAL_VX,
      vz: INITIAL_VZ,
      phase: 'DEORBIT_BRAKE' as SimTelemetryFrame['phase'],
      aborted: false,
      landed: false,
      divertActive: false,
      postTouchdownSec: 0,
      roverStatus: 'STOWED_IN_BAY' as RoverChoreographyStatus,
      hazardStatus: 'Threat scanner nominal · Rover locked stowed in payload bay',
    };

    const gMoon = 1.622;

    const resetSim = () => {
      const safePad = activeThreatScan.safestPad;
      const targetPt = activeThreatScan.targetPoint;
      state.simTime = 0;
      state.x = THREE.MathUtils.clamp(targetPt.x + 4.2, -17, 17);
      state.z = THREE.MathUtils.clamp(targetPt.z - 3.4, -17, 17);
      state.altM = INITIAL_ALT_M;
      state.vy = INITIAL_VY;
      state.vx = INITIAL_VX;
      state.vz = INITIAL_VZ;
      state.aborted = !safePad.safe && modeRef.current === 'autonomous';
      state.phase = state.aborted ? 'ABORTED' : 'DEORBIT_BRAKE';
      state.landed = false;
      state.divertActive = false;
      state.postTouchdownSec = 0;
      state.roverStatus = 'STOWED_IN_BAY';
      rampPivot.rotation.x = 0;
      roverRig.group.visible = false;
      dispatchArrow.visible = false;
      state.hazardStatus = state.aborted
        ? `SIMULATED ABORT: No safe pad <=16° slope found in LOLA corridor (min ${safePad.slopeDeg}°).`
        : `LOLA Threat Scan locked onto safe pad (${safePad.slopeDeg}° slope, ${safePad.nearestCraterClearanceM} m crater clearance)`;
    };
    resetSim();

    let frameId = 0;
    let disposed = false;
    let lastTime = performance.now();
    let camTickCounter = 0;

    const buildLandingSteps = (): LandingSequenceStep[] => {
      const safePad = activeThreatScan.safestPad;
      const p = state.phase;
      const doneIdx =
        p === 'ABORTED'
          ? -1
          : p === 'LANDED'
            ? state.postTouchdownSec >= 3.2
              ? 6
              : 5
            : p === 'TERMINAL_DESCENT'
              ? 3
              : p === 'HAZARD_DIVERT'
                ? 2
                : state.altM < 720
                  ? 1
                  : 0;

      const definitions = [
        { id: 'deorbit', label: '1. Powered Deorbit Brake', detail: `V0 ${INITIAL_SPEED_MS} m/s -> 20 m/s vertical sink arrest` },
        { id: 'lola-scan', label: '2. LOLA Hazard & Crater Mapping', detail: `${activeThreatScan.craterThreatCount} craters & ${activeThreatScan.steepSlopeCellCount} steep cells analyzed` },
        { id: 'divert', label: '3. Crater-Escape Divert Burn', detail: `Avoided crater rims · ${safePad.divertDistanceFromTargetM} m divert vector` },
        { id: 'flare', label: '4. Terminal Vertical Flare', detail: `Precision attitude hold toward ${safePad.slopeDeg}° slope pad` },
        { id: 'touchdown', label: '5. Safe Surface Contact Light', detail: `Ground contact on non-crater LOLA datum` },
        { id: 'rover-egress', label: '6. Ramp Unfold & Rover Dispatch', detail: `Hinged ramp -> NavCam scan -> ${roverHeadingDeg}° patrol heading` },
      ];

      return definitions.map((d, idx) => ({
        ...d,
        status:
          state.aborted && idx === 2
            ? 'ABORTED'
            : idx < doneIdx
              ? 'DONE'
              : idx === doneIdx
                ? 'ACTIVE'
                : 'PENDING',
      }));
    };

    const emitTelemetry = (throttleAcc: number, netAy: number, finalGround: { y: number; slope: number; elevM: number }, effectiveSpeedX: number) => {
      const safePad = activeThreatScan.safestPad;
      const targetPt = activeThreatScan.targetPoint;
      const goalX = modeRef.current === 'autonomous' ? safePad.x : targetPt.x;
      const goalZ = modeRef.current === 'autonomous' ? safePad.z : targetPt.z;
      const distMeters = Math.hypot(state.x - goalX, state.z - goalZ) * metersPerUnit;
      const totalSpeedMS = Math.hypot(state.vy, state.vx, state.vz);
      const predCoord = simOffsetToLatLon(terrain, state.x, state.z);

      const progressFrac = state.landed
        ? 1
        : THREE.MathUtils.clamp((INITIAL_ALT_M - state.altM) / INITIAL_ALT_M, 0, 1);
      const remainingCredits = state.aborted
        ? initialThreatCredits
        : state.landed
          ? 0
          : Math.max(0, Math.round(initialThreatCredits * (1 - progressFrac * 0.92)));

      const steps = buildLandingSteps();
      const activeIdx = Math.max(0, steps.findIndex((s) => s.status === 'ACTIVE'));

      onTelemetryRef.current({
        simTimeSec: Number(state.simTime.toFixed(1)),
        altitudeM: Number(state.altM.toFixed(1)),
        verticalVelMS: Number(state.vy.toFixed(2)),
        horizontalVelMS: Number(Math.hypot(state.vx, state.vz).toFixed(2)),
        totalSpeedMS: Number(totalSpeedMS.toFixed(2)),
        initialVelMS: INITIAL_SPEED_MS,
        accelerationMS2: Number(netAy.toFixed(2)),
        throttlePct: Number(Math.min(100, (throttleAcc / 5.2) * 100).toFixed(0)),
        distanceFromTargetM: Number(distMeters.toFixed(0)),
        offsetNorthM: Number((-state.z * metersPerUnit).toFixed(0)),
        offsetEastM: Number((state.x * metersPerUnit).toFixed(0)),
        predictedLat: state.landed ? predCoord.lat : safePad.lat,
        predictedLon: state.landed ? predCoord.lon : safePad.lon,
        lolaElevationM: Math.round(finalGround.elevM),
        nearestCraterDepthM: safePad.nearestCraterDepthM,
        nearestCraterClearanceM: safePad.nearestCraterClearanceM,
        localSlopeDeg: Number(finalGround.slope.toFixed(2)),
        phase: state.phase,
        hazardStatus: state.hazardStatus,
        divertActive: state.divertActive,
        selectedPadSlopeDeg: safePad.slopeDeg,
        initialThreatCredits,
        remainingThreatCredits: remainingCredits,
        landingStepIndex: state.landed ? 5 : activeIdx,
        landingSteps: steps,
        roverStatus: state.roverStatus,
        roverHeadingDeg,
        effectiveSpeedX,
      });
    };

    const stepRoverChoreography = (rawDt: number) => {
      const visualDt = Math.min(0.05, rawDt * Math.min(4, speedRef.current));
      state.postTouchdownSec += visualDt;
      const t = state.postTouchdownSec;

      const landerGround = sampleGroundY(state.x, state.z);
      lander.position.set(state.x, landerGround.y, state.z);
      lander.rotation.set(0, 0, 0);
      plume.visible = false;

      if (t < 1.0) {
        state.roverStatus = 'STOWED_IN_BAY';
        rampPivot.rotation.x = 0;
        roverRig.group.visible = false;
        dispatchArrow.visible = false;
        state.hazardStatus = 'Touchdown settled · Preparing egress ramp locks';
      } else if (t < 3.0) {
        state.roverStatus = 'RAMP_UNFOLDING';
        const k = THREE.MathUtils.smootherstep(t, 1.0, 3.0);
        rampPivot.rotation.x = k * 1.94;
        roverRig.group.visible = false;
        dispatchArrow.visible = false;
        state.hazardStatus = `Egress ramp unfolding (${Math.round(k * 100)}%)`;
      } else if (t < 7.4) {
        state.roverStatus = 'EGRESS_DOWN_RAMP';
        rampPivot.rotation.x = 1.94;
        roverRig.group.visible = true;
        dispatchArrow.visible = true;
        dispatchArrow.position.set(state.x, landerGround.y + 0.32, state.z);

        const k = THREE.MathUtils.smootherstep(t, 3.0, 7.4);
        const startZ = state.z + 1.15 * LANDER_SCALE;
        const endZ = state.z + 3.25 * LANDER_SCALE;
        const startY = landerGround.y + 0.92 * LANDER_SCALE;
        const endY = sampleGroundY(state.x, endZ).y;

        const rx = state.x;
        const rz = THREE.MathUtils.lerp(startZ, endZ, k);
        const ry = THREE.MathUtils.lerp(startY, endY, k);

        roverRig.group.position.set(rx, ry, rz);
        roverRig.group.rotation.set(0.32 * (1 - k), 0, 0);
        for (const w of roverRig.wheels) w.rotation.x += visualDt * 2.8;
        state.hazardStatus = `Rover rolling down egress ramp (${Math.round(k * 100)}%)`;
      } else if (t < 9.2) {
        state.roverStatus = 'NAVCAM_SCAN';
        rampPivot.rotation.x = 1.94;
        roverRig.group.visible = true;
        dispatchArrow.visible = true;
        const k = THREE.MathUtils.smootherstep(t, 7.4, 9.2);
        const baseZ = state.z + 3.25 * LANDER_SCALE;
        const g = sampleGroundY(state.x, baseZ);
        roverRig.group.position.set(state.x, g.y, baseZ);
        roverRig.group.rotation.set(0, THREE.MathUtils.lerp(0, dispatchYaw, k), 0);
        roverRig.navCamHead.rotation.y = Math.sin((t - 7.4) * 3.5) * 0.7;
        state.hazardStatus = `NavCam terrain sweep · Aligning to ${roverHeadingDeg}° dispatch heading`;
      } else {
        state.roverStatus = 'SURFACE_PATROL';
        rampPivot.rotation.x = 1.94;
        roverRig.group.visible = true;
        dispatchArrow.visible = true;
        const patrolTime = t - 9.2;
        const distOut = Math.min(7.5, patrolTime * 0.65);
        const baseX = state.x;
        const baseZ = state.z + 3.25 * LANDER_SCALE;
        const rx = baseX + Math.sin(dispatchYaw) * distOut;
        const rz = baseZ + Math.cos(dispatchYaw) * distOut;
        const g = sampleGroundY(rx, rz);

        roverRig.group.position.set(rx, g.y, rz);
        roverRig.group.rotation.set(0, dispatchYaw, 0);
        roverRig.navCamHead.rotation.y = Math.sin(patrolTime * 1.4) * 0.45;
        if (distOut < 7.48) {
          for (const w of roverRig.wheels) w.rotation.x += visualDt * 2.4;
        }
        state.hazardStatus = `Rover deployed & patrolling (${roverHeadingDeg}° azimuth · ${distOut.toFixed(1)} u traversed)`;
      }
    };

    const stepPhysics = (rawDt: number) => {
      const safePad = activeThreatScan.safestPad;
      const targetPt = activeThreatScan.targetPoint;
      const baseGround = sampleGroundY(state.x, state.z);
      const goalX = modeRef.current === 'autonomous' ? safePad.x : targetPt.x;
      const goalZ = modeRef.current === 'autonomous' ? safePad.z : targetPt.z;

      const landerY = baseGround.y + state.altM / ALT_SCALE_M;
      guideLine.visible = modeRef.current === 'autonomous' && !state.landed && !state.aborted;
      if (guideLine.visible) {
        const posArr = guideLine.geometry.attributes.position as THREE.BufferAttribute;
        posArr.setXYZ(0, state.x, landerY, state.z);
        posArr.setXYZ(1, safePad.x, safeRing.position.y, safePad.z);
        posArr.needsUpdate = true;
      }

      let effectiveMult: number = speedRef.current;
      if (boostRef.current && !state.landed) {
        const boostFactor = state.altM > 260 ? 20 : state.altM > 70 ? 10 : 4;
        effectiveMult = Math.max(effectiveMult, boostFactor);
      }

      if (!runningRef.current) {
        lander.position.set(state.x, landerY, state.z);
        plume.visible = false;
        emitTelemetry(0, 0, baseGround, effectiveMult);
        return;
      }

      if (state.aborted) {
        lander.position.set(state.x, landerY, state.z);
        plume.visible = false;
        emitTelemetry(0, 0, baseGround, effectiveMult);
        return;
      }

      if (state.landed) {
        stepRoverChoreography(rawDt);
        emitTelemetry(0, 0, baseGround, effectiveMult);
        return;
      }

      const totalDt = rawDt * effectiveMult;
      const subSteps = Math.max(1, Math.min(20, Math.ceil(totalDt / 0.04)));
      const dt = totalDt / subSteps;

      let lastThrottleAcc = 0;
      let lastNetAy = 0;

      for (let s = 0; s < subSteps; s++) {
        if (state.landed || state.aborted) break;
        const ground = sampleGroundY(state.x, state.z);
        state.simTime += dt;

        let throttleAcc = 0;
        let ax = 0;
        let az = 0;

        if (modeRef.current === 'manual') {
          const inp = manualRef.current;
          throttleAcc = THREE.MathUtils.clamp(2.2 + inp.throttleDelta * 2.4, 0, 5.0);
          ax = inp.pitchX * 1.4;
          az = inp.rollZ * 1.4;
          state.phase = state.altM > 250 ? 'APPROACH_EVAL' : 'TERMINAL_DESCENT';
          state.divertActive = false;
          state.hazardStatus =
            ground.slope > 12 || ground.insideCrater
              ? `THREAT WARN: ${ground.insideCrater ? 'Crater floor below' : `Slope ${ground.slope.toFixed(1)}°`}`
              : 'Manual descent active · Rover stowed';
        } else if (modeRef.current === 'assisted') {
          const desiredVy = state.altM > 180 ? -12 : state.altM > 35 ? -4.5 : -1.5;
          throttleAcc = THREE.MathUtils.clamp(gMoon + (desiredVy - state.vy) * 0.65, 0, 4.8);
          ax = -state.vx * 0.6 + manualRef.current.pitchX * 1.2;
          az = -state.vz * 0.6 + manualRef.current.rollZ * 1.2;
          state.phase = state.altM > 220 ? 'APPROACH_EVAL' : 'TERMINAL_DESCENT';
          state.divertActive = false;
          state.hazardStatus = `Assisted damping · Slope below ${ground.slope.toFixed(1)}°`;
        } else {
          const dx = goalX - state.x;
          const dz = goalZ - state.z;
          const distUnits = Math.hypot(dx, dz);

          if (state.altM > 540) {
            state.phase = 'DEORBIT_BRAKE';
            state.divertActive = false;
            state.hazardStatus = `Deorbit Braking · ${activeThreatScan.craterThreatCount} craters & ${activeThreatScan.steepSlopeCellCount} steep cells mapped`;
          } else if (distUnits > 0.18 && state.altM > 35) {
            state.phase = 'HAZARD_DIVERT';
            state.divertActive = true;
            state.hazardStatus = `Threat Divert Active · Escaping ${Math.round(distUnits * metersPerUnit)} m to non-crater ${safePad.slopeDeg}° pad`;
          } else {
            state.phase = 'TERMINAL_DESCENT';
            state.divertActive = false;
            state.hazardStatus = `Terminal Vertical Flare · Safe pad slope ${ground.slope.toFixed(1)}° (Rover stowed)`;
          }

          const desiredVx = THREE.MathUtils.clamp(dx * 1.85, -7.5, 7.5);
          const desiredVz = THREE.MathUtils.clamp(dz * 1.85, -7.5, 7.5);
          ax = (desiredVx - state.vx) * 1.9;
          az = (desiredVz - state.vz) * 1.9;

          const desiredVy =
            state.altM > 450
              ? -20
              : state.altM > 150
                ? -10.5
                : state.altM > 40
                  ? -3.5
                  : -1.0;
          throttleAcc = THREE.MathUtils.clamp(gMoon + (desiredVy - state.vy) * 0.95, 0, 5.4);
        }

        const netAy = throttleAcc - gMoon;
        state.vy += netAy * dt;
        state.vx += ax * dt;
        state.vz += az * dt;

        state.altM += state.vy * dt;
        state.x = THREE.MathUtils.clamp(state.x + (state.vx * dt) / 10, -18, 18);
        state.z = THREE.MathUtils.clamp(state.z + (state.vz * dt) / 10, -18, 18);

        lander.rotation.z = THREE.MathUtils.clamp(-ax * 0.05, -0.25, 0.25);
        lander.rotation.x = THREE.MathUtils.clamp(az * 0.05, -0.25, 0.25);

        plume.visible = throttleAcc > 0.35;
        plume.scale.setScalar(0.6 + (throttleAcc / 5.4) * 0.7);

        lastThrottleAcc = throttleAcc;
        lastNetAy = netAy;

        if (state.altM <= 0) {
          state.altM = 0;
          const speedImpact = Math.abs(state.vy);
          const touchGround = sampleGroundY(state.x, state.z);
          if (speedImpact > 6.5 || touchGround.slope > 18 || (modeRef.current === 'autonomous' && touchGround.insideCrater)) {
            state.aborted = true;
            state.phase = 'ABORTED';
            state.hazardStatus = `Touchdown out-of-envelope (Vz=${speedImpact.toFixed(1)} m/s, Slope=${touchGround.slope.toFixed(1)}°)`;
          } else {
            state.landed = true;
            state.phase = 'LANDED';
            state.postTouchdownSec = 0;
            state.roverStatus = 'STOWED_IN_BAY';
            state.hazardStatus = `SAFE TOUCHDOWN CONFIRMED · Slope ${touchGround.slope.toFixed(1)}° · Vz=${speedImpact.toFixed(2)} m/s`;
          }
          state.vy = 0;
          state.vx = 0;
          state.vz = 0;
          plume.visible = false;
          lander.rotation.set(0, 0, 0);
        }
      }

      const finalGround = sampleGroundY(state.x, state.z);
      lander.position.set(state.x, finalGround.y + state.altM / ALT_SCALE_M, state.z);
      if (!state.landed) roverRig.group.visible = false;
      emitTelemetry(lastThrottleAcc, lastNetAy, finalGround, effectiveMult);
    };

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      const rawDt = Math.min(0.08, (now - lastTime) / 1000);
      lastTime = now;

      stepPhysics(rawDt);
      controls.update();
      renderer.render(scene, camera);

      camTickCounter++;
      const feedCanvas = cameraCanvasRef.current;
      if (feedCanvas && camTickCounter % 3 === 0) {
        lander.visible = false;
        landerCam.position.set(lander.position.x, lander.position.y + 0.5, lander.position.z);
        landerCam.lookAt(lander.position.x, -5, lander.position.z);
        const origW = renderer.domElement.width;
        const origH = renderer.domElement.height;
        const fCtx = feedCanvas.getContext('2d');
        if (fCtx) {
          renderer.render(scene, landerCam);
          fCtx.drawImage(renderer.domElement, 0, 0, origW, origH, 0, 0, feedCanvas.width, feedCanvas.height);
          lander.visible = true;
          renderer.render(scene, camera);
        } else {
          lander.visible = true;
        }
      }

      if (isSoftwareGl) {
        frameId = scheduleAfterDraw(renderer, tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    const onResize = () => {
      if (!container || disposed) return;
      const w = container.clientWidth || 760;
      const h = container.clientHeight || 460;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      planeGeo.dispose();
      terrainMat.dispose();
      wacTexture?.dispose();
      threatDisposables.forEach((d) => d.dispose());
      envTex.dispose();
      renderer.dispose();
    };
  }, [terrain, resetSignal, lightweightMode, solarElevationDeg, randomTestField, cameraCanvasRef]);

  useEffect(() => {
    syncTargetRef.current();
  }, [targetOverride]);

  return (
    <div className="relative w-full h-full min-h-[440px] bg-[#05070C] border border-slate-800 rounded-lg overflow-hidden">
      <div ref={mountRef} className="w-full h-full min-h-[440px]" />
      <div className="pointer-events-none absolute top-3 left-3 bg-[#07090E]/90 border border-slate-800 px-3 py-1.5 rounded text-xs max-w-[92%]">
        <span className="text-violet-300 font-medium">Simulated 3D Descent, Hazard Escape &amp; Ramp Rover Egress</span>
        <span className="text-slate-400 ml-2">
          Left-click terrain to set target coordinates · Cyan: Nominal Target · Green: Safe Pad · Amber: Craters
        </span>
      </div>
    </div>
  );
}
