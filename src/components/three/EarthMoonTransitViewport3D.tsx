import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLOBAL_LAUNCH_FACILITIES } from '../../lib/nasaCatalog';
import type { LaunchFacility } from '../../types/lunar';
import {
  applyStudioEnvironment,
  buildCompositeRocketGroup,
  createConfiguredRenderer,
  detectSoftwareWebGL,
  latLonToVec3,
  scheduleAfterDraw,
  vec3ToLatLon,
} from './ThreeUtils';

interface EarthMoonTransitViewport3DProps {
  selectedFacilityId: string;
  customEarthCoord?: { lat: number; lon: number } | null;
  targetLat: number;
  targetLon: number;
  transitPct: number;
  greenLaunchBackdrop: boolean;
  lightweightMode: boolean;
  onSelectFacility?: (facility: LaunchFacility) => void;
  onSelectEarthCoord?: (lat: number, lon: number) => void;
  onSelectMoonCoord?: (lat: number, lon: number) => void;
}

// Pre-allocated math objects for zero-GC animation ticks
const _vStart = new THREE.Vector3();
const _vCtrl = new THREE.Vector3();
const _vEnd = new THREE.Vector3();
const _vPos = new THREE.Vector3();
const _vNext = new THREE.Vector3();
const _vTangent = new THREE.Vector3();
const _vUp = new THREE.Vector3(0, 1, 0);
const _vNormal = new THREE.Vector3();
const _vCamOffset = new THREE.Vector3();
const _vLocalHit = new THREE.Vector3();
const _colGreen = new THREE.Color(0x0b331d);
const _colSpace = new THREE.Color(0x05070c);
const _colBg = new THREE.Color();

export function EarthMoonTransitViewport3D({
  selectedFacilityId,
  customEarthCoord,
  targetLat,
  targetLon,
  transitPct,
  greenLaunchBackdrop,
  lightweightMode,
  onSelectFacility,
  onSelectEarthCoord,
  onSelectMoonCoord,
}: EarthMoonTransitViewport3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState({ earth: false, moon: false });
  const [cameraMode, setCameraMode] = useState<'follow-rocket' | 'system-overview'>('follow-rocket');

  const transitPctRef = useRef(transitPct);
  transitPctRef.current = transitPct;
  const greenRef = useRef(greenLaunchBackdrop);
  greenRef.current = greenLaunchBackdrop;
  const facilityIdRef = useRef(selectedFacilityId);
  facilityIdRef.current = selectedFacilityId;
  const customEarthRef = useRef(customEarthCoord);
  customEarthRef.current = customEarthCoord;
  const targetCoordRef = useRef({ lat: targetLat, lon: targetLon });
  targetCoordRef.current = { lat: targetLat, lon: targetLon };
  const cameraModeRef = useRef(cameraMode);
  cameraModeRef.current = cameraMode;
  const onSelectFacRef = useRef(onSelectFacility);
  onSelectFacRef.current = onSelectFacility;
  const onSelectEarthRef = useRef(onSelectEarthCoord);
  onSelectEarthRef.current = onSelectEarthCoord;
  const onSelectMoonRef = useRef(onSelectMoonCoord);
  onSelectMoonRef.current = onSelectMoonCoord;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = container.clientWidth || 760;
    const height = container.clientHeight || 460;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(greenRef.current && transitPctRef.current < 22 ? 0x0b331d : 0x05070c);

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 450);
    camera.position.set(16, 11, 22);

    const renderer = createConfiguredRenderer(width, height, isSoftwareGl, lightweightMode);
    renderer.domElement.style.cursor = 'crosshair';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const envTex = applyStudioEnvironment(renderer, scene);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.minDistance = 4;
    controls.maxDistance = 120;

    const sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
    sunLight.position.set(25, 18, 35);
    scene.add(sunLight);
    scene.add(new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.45));

    // Exact 3.67 : 1 Earth-to-Moon radius ratio & 3.84 km scaled separation (38.4 scene units)
    const EARTH_RADIUS = 7.34;
    const MOON_RADIUS = 2.0; // 7.34 / 2.00 = 3.67 : 1 exact NASA ratio
    const SEPARATION_UNITS = 38.4; // Represents 384,400 km scaled to 3.84 km (38.4 units)

    const earthGroup = new THREE.Group();
    earthGroup.position.set(0, 0, 0);
    scene.add(earthGroup);

    const moonGroup = new THREE.Group();
    moonGroup.position.set(SEPARATION_UNITS, 0, 0);
    scene.add(moonGroup);

    // Fallback spheres while NASA GLBs load
    const earthFallback = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS, 36, 24),
      new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.72 }),
    );
    earthGroup.add(earthFallback);

    const moonFallback = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_RADIUS, 32, 22),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.9 }),
    );
    moonGroup.add(moonFallback);

    // Invisible raycast spheres for click-anywhere lat/lon selection on Earth & Moon
    const earthRaycastSphere = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS, 36, 24),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    earthGroup.add(earthRaycastSphere);

    const moonRaycastSphere = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_RADIUS, 32, 22),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    moonGroup.add(moonRaycastSphere);

    // Surface launch facilities only (NO revolving orbital satellites or rings)
    const stationPins: THREE.Mesh[] = [];
    for (const fac of GLOBAL_LAUNCH_FACILITIES) {
      const isNull = fac.id === 'null-island';
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(isNull ? 0.19 : 0.15, 12, 12),
        new THREE.MeshBasicMaterial({
          color: isNull ? 0x10b981 : fac.isNasaFacility ? 0x22d3ee : 0xf59e0b,
        }),
      );
      latLonToVec3(fac.lat, fac.lon, EARTH_RADIUS + 0.14, pin.position);
      pin.userData = { facility: fac };
      earthGroup.add(pin);
      stationPins.push(pin);
    }

    // Highlight ring around active surface launch coordinate
    const activeStationRing = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.34, 24),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide }),
    );
    earthGroup.add(activeStationRing);

    // Lunar landing target beacon on Moon surface
    const moonTargetBeacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x10b981 }),
    );
    moonGroup.add(moonTargetBeacon);

    // 3.84 km scaled Earth-Moon baseline distance ruler line
    const rulerGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -EARTH_RADIUS - 1.4, 0),
      new THREE.Vector3(SEPARATION_UNITS, -EARTH_RADIUS - 1.4, 0),
    ]);
    const rulerMat = new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.7 });
    scene.add(new THREE.Line(rulerGeo, rulerMat));

    // Curved Trans-Lunar Injection trajectory line
    const trajPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) trajPoints.push(new THREE.Vector3());
    const trajGeo = new THREE.BufferGeometry().setFromPoints(trajPoints);
    const trajMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.75 });
    const trajLine = new THREE.Line(trajGeo, trajMat);
    scene.add(trajLine);

    // Multi-stage composite rocket rig for 3-stage separation animation
    const rocketRig = buildCompositeRocketGroup();
    rocketRig.group.scale.setScalar(0.85);
    scene.add(rocketRig.group);

    let disposed = false;
    const gltfLoader = new GLTFLoader();

    gltfLoader.load('/nasa-models/Earth_1_12756.glb', (gltf) => {
      if (disposed) return;
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      root.position.sub(center);
      const wrapper = new THREE.Group();
      wrapper.add(root);
      wrapper.scale.setScalar((EARTH_RADIUS * 2) / maxDim);
      wrapper.rotation.y = -Math.PI / 4; // Null Island (0, 0) aligned to +Z
      earthGroup.remove(earthFallback);
      earthFallback.geometry.dispose();
      (earthFallback.material as THREE.Material).dispose();
      earthGroup.add(wrapper);
      setModelsLoaded((prev) => ({ ...prev, earth: true }));
    });

    gltfLoader.load('/nasa-models/moon_small.glb', (gltf) => {
      if (disposed) return;
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      root.position.sub(center);
      const wrapper = new THREE.Group();
      wrapper.add(root);
      wrapper.scale.setScalar((MOON_RADIUS * 2) / maxDim);
      wrapper.rotation.y = -Math.PI / 2;
      moonGroup.remove(moonFallback);
      moonFallback.geometry.dispose();
      (moonFallback.material as THREE.Material).dispose();
      moonGroup.add(wrapper);
      setModelsLoaded((prev) => ({ ...prev, moon: true }));
    });

    // Left-click handler for selecting stations, any Earth coordinate, or any Moon coordinate
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
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const pinHits = raycaster.intersectObjects(stationPins, false);
      if (pinHits.length > 0 && pinHits[0].object.userData.facility) {
        onSelectFacRef.current?.(pinHits[0].object.userData.facility as LaunchFacility);
        return;
      }

      const moonHits = raycaster.intersectObject(moonRaycastSphere, false);
      if (moonHits.length > 0) {
        _vLocalHit.copy(moonHits[0].point);
        moonGroup.worldToLocal(_vLocalHit);
        const { lat, lon } = vec3ToLatLon(_vLocalHit);
        onSelectMoonRef.current?.(Number(lat.toFixed(4)), Number(lon.toFixed(4)));
        return;
      }

      const earthHits = raycaster.intersectObject(earthRaycastSphere, false);
      if (earthHits.length > 0) {
        _vLocalHit.copy(earthHits[0].point);
        earthGroup.worldToLocal(_vLocalHit);
        const { lat, lon } = vec3ToLatLon(_vLocalHit);
        const nearNull = Math.abs(lat) < 2.5 && Math.abs(lon) < 2.5;
        onSelectEarthRef.current?.(
          nearNull ? 0 : Number(lat.toFixed(4)),
          nearNull ? 0 : Number(lon.toFixed(4)),
        );
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    let frameId = 0;
    let lastOriginKey = '';

    const updateTrajectoryAndRocket = () => {
      const fac =
        GLOBAL_LAUNCH_FACILITIES.find((f) => f.id === facilityIdRef.current) ??
        GLOBAL_LAUNCH_FACILITIES[0];
      const launchLat = customEarthRef.current ? customEarthRef.current.lat : fac.lat;
      const launchLon = customEarthRef.current ? customEarthRef.current.lon : fac.lon;
      const originKey = `${fac.id}:${launchLat}:${launchLon}`;

      latLonToVec3(launchLat, launchLon, EARTH_RADIUS + 0.16, activeStationRing.position);
      activeStationRing.lookAt(
        activeStationRing.position.x * 2,
        activeStationRing.position.y * 2,
        activeStationRing.position.z * 2,
      );

      latLonToVec3(
        targetCoordRef.current.lat,
        targetCoordRef.current.lon,
        MOON_RADIUS + 0.08,
        moonTargetBeacon.position,
      );

      // Start at active Earth origin surface normal, curve through mid-cislunar apex, end at Moon target
      latLonToVec3(launchLat, launchLon, EARTH_RADIUS + 0.15, _vStart);
      _vEnd.set(
        SEPARATION_UNITS + moonTargetBeacon.position.x,
        moonTargetBeacon.position.y,
        moonTargetBeacon.position.z,
      );
      _vCtrl.set(
        SEPARATION_UNITS * 0.45,
        Math.max(_vStart.y, _vEnd.y) + 7.5,
        (_vStart.z + _vEnd.z) * 0.5 + 3.0,
      );

      // Update trajectory curve vertices
      const tPos = trajGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i <= 48; i++) {
        const t = i / 48;
        const it = 1 - t;
        tPos.setXYZ(
          i,
          it * it * _vStart.x + 2 * it * t * _vCtrl.x + t * t * _vEnd.x,
          it * it * _vStart.y + 2 * it * t * _vCtrl.y + t * t * _vEnd.y,
          it * it * _vStart.z + 2 * it * t * _vCtrl.z + t * t * _vEnd.z,
        );
      }
      tPos.needsUpdate = true;

      const pct = THREE.MathUtils.clamp(transitPctRef.current, 0, 100);
      const t = pct / 100;

      // Green launch backdrop fades cleanly into deep space as rocket clears atmosphere (pct 14 -> 26)
      if (greenRef.current) {
        const spaceBlend = THREE.MathUtils.smoothstep(pct, 14, 26);
        _colBg.copy(_colGreen).lerp(_colSpace, spaceBlend);
        (scene.background as THREE.Color).copy(_colBg);
      } else {
        (scene.background as THREE.Color).copy(_colSpace);
      }

      // Position rocket along liftoff normal (0..6%) then smoothly onto Bezier TLI path
      if (pct <= 0.5) {
        _vNormal.copy(_vStart).normalize();
        rocketRig.group.position.copy(_vStart).addScaledVector(_vNormal, 0.05);
        rocketRig.group.quaternion.setFromUnitVectors(_vUp, _vNormal);
      } else {
        const it = 1 - t;
        _vPos.set(
          it * it * _vStart.x + 2 * it * t * _vCtrl.x + t * t * _vEnd.x,
          it * it * _vStart.y + 2 * it * t * _vCtrl.y + t * t * _vEnd.y,
          it * it * _vStart.z + 2 * it * t * _vCtrl.z + t * t * _vEnd.z,
        );
        const nt = Math.min(1, t + 0.015);
        const nit = 1 - nt;
        _vNext.set(
          nit * nit * _vStart.x + 2 * nit * nt * _vCtrl.x + nt * nt * _vEnd.x,
          nit * nit * _vStart.y + 2 * nit * nt * _vCtrl.y + nt * nt * _vEnd.y,
          nit * nit * _vStart.z + 2 * nit * nt * _vCtrl.z + nt * nt * _vEnd.z,
        );
        _vTangent.subVectors(_vNext, _vPos).normalize();
        rocketRig.group.position.copy(_vPos);
        rocketRig.group.quaternion.setFromUnitVectors(_vUp, _vTangent);
      }

      // 3-Stage Separation Choreography:
      if (pct < 10) {
        rocketRig.srbLeft.visible = true;
        rocketRig.srbRight.visible = true;
        rocketRig.srbLeft.position.set(-0.27, 0, 0);
        rocketRig.srbRight.position.set(0.27, 0, 0);
        rocketRig.srbLeft.rotation.set(0, 0, 0);
        rocketRig.srbRight.rotation.set(0, 0, 0);
      } else if (pct < 22) {
        const s = (pct - 10) / 12;
        rocketRig.srbLeft.visible = true;
        rocketRig.srbRight.visible = true;
        rocketRig.srbLeft.position.set(-0.27 - s * 1.4, -s * 1.6, 0);
        rocketRig.srbRight.position.set(0.27 + s * 1.4, -s * 1.6, 0);
        rocketRig.srbLeft.rotation.z = s * 0.9;
        rocketRig.srbRight.rotation.z = -s * 0.9;
      } else {
        rocketRig.srbLeft.visible = false;
        rocketRig.srbRight.visible = false;
      }

      if (pct < 22) {
        rocketRig.coreStage.visible = true;
        rocketRig.coreStage.position.set(0, 0, 0);
        rocketRig.corePlume.visible = pct > 0;
      } else if (pct < 38) {
        const c = (pct - 22) / 16;
        rocketRig.coreStage.visible = true;
        rocketRig.coreStage.position.set(0, -c * 2.4, 0);
        rocketRig.corePlume.visible = false;
      } else {
        rocketRig.coreStage.visible = false;
      }

      rocketRig.upperPlume.visible = pct >= 22 && pct < 96;
      if (pct < 38) {
        rocketRig.fairing.visible = true;
        rocketRig.fairing.position.set(0, 0, 0);
      } else if (pct < 55) {
        const f = (pct - 38) / 17;
        rocketRig.fairing.visible = true;
        rocketRig.fairing.position.set(f * 0.9, -f * 0.5, f * 0.7);
      } else {
        rocketRig.fairing.visible = false;
      }

      if (cameraModeRef.current === 'follow-rocket' && pct > 0 && pct < 100) {
        controls.target.lerp(rocketRig.group.position, 0.1);
        _vCamOffset.set(
          rocketRig.group.position.x + 6,
          rocketRig.group.position.y + 4.5,
          rocketRig.group.position.z + 10,
        );
        camera.position.lerp(_vCamOffset, 0.06);
      } else if (cameraModeRef.current === 'system-overview' && lastOriginKey !== originKey) {
        controls.target.set(SEPARATION_UNITS * 0.48, 0, 0);
        camera.position.set(SEPARATION_UNITS * 0.48, 16, 48);
      } else if (pct === 0 && lastOriginKey !== originKey) {
        _vNormal.copy(_vStart).normalize();
        controls.target.copy(_vStart);
        camera.position.copy(_vStart).addScaledVector(_vNormal, 11);
      }
      lastOriginKey = originKey;
    };

    const tick = () => {
      if (disposed) return;
      updateTrajectoryAndRocket();
      controls.update();
      renderer.render(scene, camera);

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
      rulerGeo.dispose();
      rulerMat.dispose();
      trajGeo.dispose();
      trajMat.dispose();
      envTex.dispose();
      renderer.dispose();
    };
  }, [lightweightMode]);

  const stageLabel =
    transitPct <= 0
      ? 'Pad Ready · Multi-Stage Stack Vertical'
      : transitPct < 10
        ? 'Stage 1 Liftoff · Twin SRBs + Core Ignited'
        : transitPct < 22
          ? 'Stage 1 Separation · Twin SRBs Jettisoned'
          : transitPct < 38
            ? 'Stage 2 MECO Drop · Upper Stage TLI Ignition'
            : transitPct < 55
              ? 'Stage 3 Fairing Jettison · Trans-Lunar Coast'
              : transitPct < 100
                ? 'Lunar Approach · Moon Capture Corridor'
                : 'Lunar Orbit Insertion Complete -> Handoff to LOLA Descent';

  return (
    <div className="relative w-full h-full min-h-[440px] bg-[#05070C] border border-slate-800 rounded-lg overflow-hidden">
      <div ref={mountRef} className="w-full h-full min-h-[440px]" />

      <div className="pointer-events-none absolute top-3 left-3 bg-[#07090E]/90 border border-slate-800 px-3 py-2 rounded-md space-y-0.5 max-w-[78%]">
        <div className="text-xs font-medium text-slate-100">
          NASA Earth (#2393) &amp; LRO Moon 3D Transit · Exact 3.67 : 1 Radius Ratio · 3.84 km Scaled Separation
        </div>
        <div className="text-[11px] font-mono text-cyan-300">{stageLabel}</div>
        <div className="text-[10px] font-mono text-slate-400">
          Left-click Earth station/globe for launch origin · Left-click Moon globe for lunar target coordinate
        </div>
      </div>

      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCameraMode((m) => (m === 'follow-rocket' ? 'system-overview' : 'follow-rocket'))}
          className="px-2.5 py-1 text-[11px] font-mono bg-[#07090E]/95 border border-slate-700 hover:border-cyan-500 text-cyan-200 rounded cursor-pointer whitespace-nowrap"
        >
          {cameraMode === 'follow-rocket' ? 'Overview (3.84 km)' : 'Track Rocket'}
        </button>
      </div>

      {(!modelsLoaded.earth || !modelsLoaded.moon) && (
        <div className="pointer-events-none absolute bottom-3 left-3 bg-[#07090E]/90 border border-cyan-800/70 px-2.5 py-1 rounded text-[11px] font-mono text-cyan-300">
          Streaming NASA GLB meshes...
        </div>
      )}
    </div>
  );
}
