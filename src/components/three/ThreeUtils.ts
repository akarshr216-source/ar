import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function detectSoftwareWebGL(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function createConfiguredRenderer(
  width: number,
  height: number,
  isSoftwareGl: boolean,
  lightweightMode = false,
): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl && !lightweightMode,
    powerPreference: lightweightMode ? 'low-power' : 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setPixelRatio(isSoftwareGl || lightweightMode ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(Math.max(1, width), Math.max(1, height));
  renderer.shadowMap.enabled = !isSoftwareGl && !lightweightMode;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function applyStudioEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmremGenerator.dispose();
  return envTex;
}

/**
 * Converts selenographic/geographic (lat, lon) in degrees to Three.js spherical coordinates
 * where lat=0, lon=0 sits on +Z (or rotated via group offset if GLB prime meridian differs).
 */
export function latLonToVec3(latDeg: number, lonDeg: number, radius: number, target = new THREE.Vector3()): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - latDeg);
  const theta = THREE.MathUtils.degToRad(lonDeg + 90);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return target.set(x, y, z);
}

export function vec3ToLatLon(vec: THREE.Vector3): { lat: number; lon: number } {
  const r = vec.length() || 1;
  const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(vec.y / r, -1, 1)));
  // Inverse of x = -r sin(phi) cos(lon+90) = r sin(phi) sin(lon), z = r sin(phi) cos(lon)
  const lon = THREE.MathUtils.radToDeg(Math.atan2(vec.x, vec.z));
  return {
    lat: Number(lat.toFixed(3)),
    lon: Number(lon.toFixed(3)),
  };
}

export function scheduleAfterDraw(renderer: THREE.WebGLRenderer, cb: () => void): number {
  try {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (gl && typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          window.setTimeout(cb, 70);
        }
      };
      return window.setTimeout(poll, 5);
    }
  } catch {
    // fallback if WebGL1
  }
  return window.setTimeout(cb, 80);
}

/**
 * Composite procedural Lunar Lander THREE.Group (bottom-center pivot at y=0)
 * including a stowed rover payload bay and a hinged dual-rail egress ramp (`rampPivot`).
 */
export function buildLunarLanderGroup(): {
  group: THREE.Group;
  plume: THREE.Mesh;
  rampPivot: THREE.Group;
} {
  const group = new THREE.Group();

  const goldFoilMat = new THREE.MeshStandardMaterial({
    color: 0xd4a024,
    metalness: 0.88,
    roughness: 0.24,
  });
  const alloyMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.72,
    roughness: 0.36,
  });
  const darkCarbonMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.35,
    roughness: 0.65,
  });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    metalness: 0.2,
    roughness: 0.15,
    emissive: 0x083344,
  });

  // 1. Octagonal descent stage
  const descentStage = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.9, 8), goldFoilMat);
  descentStage.position.y = 1.15;
  descentStage.castShadow = true;
  group.add(descentStage);

  // 2. Stowed Rover Payload Bay recess on +Z forward face
  const payloadBay = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.62, 0.22), darkCarbonMat);
  payloadBay.position.set(0, 1.15, 1.12);
  group.add(payloadBay);

  // 3. Hinged Dual-Rail Rover Egress Ramp anchored at bay sill (y=0.92, z=1.18)
  // rampPivot.rotation.x = 0 -> stowed upright flat against bay; +1.94 rad -> deployed at ~21 deg down to ground
  const rampPivot = new THREE.Group();
  rampPivot.position.set(0, 0.92, 1.18);

  const rampDeck = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.38, 0.05), alloyMat);
  rampDeck.position.set(0, 1.19, 0.03);
  rampDeck.castShadow = true;
  rampDeck.receiveShadow = true;
  rampPivot.add(rampDeck);

  for (const rx of [-0.46, 0.46]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.38, 0.11), goldFoilMat);
    rail.position.set(rx, 1.19, 0.06);
    rampPivot.add(rail);
  }
  group.add(rampPivot);

  // 4. Ascent cabin body
  const ascentCabin = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.95, 1.15), alloyMat);
  ascentCabin.position.y = 2.05;
  ascentCabin.castShadow = true;
  group.add(ascentCabin);

  // 5. Forward crew viewport visor
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.32, 0.12), windowMat);
  visor.position.set(0, 2.15, 0.58);
  group.add(visor);

  // 6. Descent engine bell
  const engineBell = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.48, 0.65, 16, 1, true), darkCarbonMat);
  engineBell.material.side = THREE.DoubleSide;
  engineBell.position.y = 0.55;
  group.add(engineBell);

  // 7. Exhaust plume cone (toggled by throttle)
  const plumeMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.0, 14, 1, true), plumeMat);
  plume.rotation.x = Math.PI;
  plume.position.y = -0.6;
  plume.visible = false;
  group.add(plume);

  // 8-11. Four landing gear struts & circular footpads
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.45, 8), alloyMat);
    strut.position.set(cos * 1.28, 0.65, sin * 1.28);
    strut.rotation.z = cos * 0.45;
    strut.rotation.x = -sin * 0.45;
    strut.castShadow = true;
    group.add(strut);

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.08, 12), goldFoilMat);
    pad.position.set(cos * 1.62, 0.04, sin * 1.62);
    pad.receiveShadow = true;
    group.add(pad);
  }

  // 12. High-gain S-band dish antenna
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), alloyMat);
  dish.material.side = THREE.DoubleSide;
  dish.position.set(0.45, 2.75, 0.15);
  dish.rotation.x = Math.PI * 0.75;
  group.add(dish);

  return { group, plume, rampPivot };
}

/**
 * Composite articulated Lunar Rover THREE.Group with spinning wheels and panning NavCam head.
 */
export function buildLunarRoverRig(): {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  navCamHead: THREE.Group;
} {
  const group = new THREE.Group();

  const frameMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.75, roughness: 0.3 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.85, roughness: 0.25 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.3, roughness: 0.75 });
  const solarMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.65, roughness: 0.2, emissive: 0x082f49 });
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0e7490, metalness: 0.3, roughness: 0.2 });

  // 1. Warm Electronics Box chassis
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.42, 1.8), goldMat);
  chassis.position.y = 0.58;
  chassis.castShadow = true;
  group.add(chassis);

  // 2. Solar deck wing
  const solarDeck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 1.25), solarMat);
  solarDeck.position.set(0, 0.84, -0.15);
  solarDeck.castShadow = true;
  group.add(solarDeck);

  // 3. Camera mast pole
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 10), frameMat);
  mast.position.set(0.32, 1.25, 0.62);
  group.add(mast);

  // 4. Articulated Stereo NavCam head
  const navCamHead = new THREE.Group();
  navCamHead.position.set(0.32, 1.72, 0.65);
  const camBox = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.18, 0.2), frameMat);
  navCamHead.add(camBox);
  for (const lx of [-0.11, 0.11]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 10), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(lx, 0, 0.11);
    navCamHead.add(lens);
  }
  group.add(navCamHead);

  // 5. High-gain dish
  const hga = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.08, 0.12, 16), frameMat);
  hga.position.set(-0.42, 1.15, -0.5);
  hga.rotation.x = 0.45;
  group.add(hga);

  // 6-9. Four mesh-tire wheels
  const wheelOffsets: Array<[number, number]> = [
    [-0.88, 0.68],
    [0.88, 0.68],
    [-0.88, -0.68],
    [0.88, -0.68],
  ];
  const wheels: THREE.Mesh[] = [];
  for (const [wx, wz] of wheelOffsets) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 16), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.28, wz);
    wheel.castShadow = true;
    group.add(wheel);
    wheels.push(wheel);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.24, 12), frameMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wx, 0.28, wz);
    group.add(hub);
  }

  return { group, wheels, navCamHead };
}

export function buildLunarRoverGroup(): THREE.Group {
  return buildLunarRoverRig().group;
}

/**
 * Multi-stage Saturn/Artemis-style launch vehicle for the Earth -> Moon transit animation
 * supporting realistic 3-stage separation (SRB detach, Core MECO drop, Fairing jettison).
 */
export function buildCompositeRocketGroup(): {
  group: THREE.Group;
  coreStage: THREE.Group;
  srbLeft: THREE.Group;
  srbRight: THREE.Group;
  upperStage: THREE.Group;
  fairing: THREE.Group;
  corePlume: THREE.Mesh;
  upperPlume: THREE.Mesh;
} {
  const group = new THREE.Group();

  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.25, roughness: 0.45 });
  const orangeMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.2, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.5 });

  // Core Stage
  const coreStage = new THREE.Group();
  const coreTank = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.35, 14), orangeMat);
  coreTank.position.y = 0.675;
  coreStage.add(coreTank);

  const coreSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.22, 14), darkMat);
  coreSkirt.position.y = 0.11;
  coreStage.add(coreSkirt);

  const plumeMat = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const corePlume = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 12, 1, true), plumeMat);
  corePlume.rotation.x = Math.PI;
  corePlume.position.y = -0.45;
  coreStage.add(corePlume);
  group.add(coreStage);

  // Twin Solid Rocket Boosters
  const makeSrb = (xOffset: number) => {
    const srb = new THREE.Group();
    srb.position.set(xOffset, 0, 0);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.12, 12), whiteMat);
    body.position.y = 0.56;
    srb.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.22, 12), whiteMat);
    nose.position.y = 1.23;
    srb.add(nose);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55, 10, 1, true), plumeMat);
    flame.rotation.x = Math.PI;
    flame.position.y = -0.28;
    srb.add(flame);
    return srb;
  };

  const srbLeft = makeSrb(-0.27);
  const srbRight = makeSrb(0.27);
  group.add(srbLeft, srbRight);

  // Upper Stage + Spacecraft
  const upperStage = new THREE.Group();
  upperStage.position.y = 1.35;
  const icps = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.48, 14), whiteMat);
  icps.position.y = 0.24;
  upperStage.add(icps);

  const spacecraft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 0.34, 12), darkMat);
  spacecraft.position.y = 0.65;
  upperStage.add(spacecraft);

  const upperPlumeMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const upperPlume = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.65, 12, 1, true), upperPlumeMat);
  upperPlume.rotation.x = Math.PI;
  upperPlume.position.y = -0.32;
  upperPlume.visible = false;
  upperStage.add(upperPlume);

  // Fairing / LES shroud around payload
  const fairing = new THREE.Group();
  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.42, 14), whiteMat);
  shroud.position.y = 0.68;
  fairing.add(shroud);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.36, 14), whiteMat);
  cone.position.y = 1.07;
  fairing.add(cone);
  upperStage.add(fairing);

  group.add(upperStage);

  return { group, coreStage, srbLeft, srbRight, upperStage, fairing, corePlume, upperPlume };
}

/**
 * Generates seamless procedural lunar regolith micro-crater albedo + bump textures
 * for close-up high-detail terrain shading (e.g., Shackleton Crater Rim).
 */
export function createLunarRegolithTextures(): {
  albedoMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const size = 256;
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const aCtx = albedoCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  // Base regolith grain
  aCtx.fillStyle = '#9aa3b0';
  aCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  // Deterministic pseudo-random generator for consistent lunar micro-craters
  let seed = 19690720;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Fine mineral grain speckles
  for (let i = 0; i < 3200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.6 + rand() * 1.4;
    const v = Math.floor(115 + rand() * 75);
    aCtx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    aCtx.fillRect(x, y, r, r);

    const bv = Math.floor(95 + rand() * 70);
    bCtx.fillStyle = `rgb(${bv},${bv},${bv})`;
    bCtx.fillRect(x, y, r, r);
  }

  // Multi-scale micro-impact craters with bright ejecta rims and dark bowls
  for (let i = 0; i < 85; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const cr = 2.5 + rand() * 14;

    const bGrad = bCtx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    bGrad.addColorStop(0, '#202020');
    bGrad.addColorStop(0.62, '#525252');
    bGrad.addColorStop(0.82, '#e2e2e2');
    bGrad.addColorStop(1, 'rgba(128,128,128,0)');
    bCtx.fillStyle = bGrad;
    bCtx.beginPath();
    bCtx.arc(cx, cy, cr, 0, Math.PI * 2);
    bCtx.fill();

    const aGrad = aCtx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    aGrad.addColorStop(0, 'rgba(55,62,74,0.65)');
    aGrad.addColorStop(0.65, 'rgba(110,118,130,0.25)');
    aGrad.addColorStop(0.84, 'rgba(218,226,238,0.45)');
    aGrad.addColorStop(1, 'rgba(154,163,176,0)');
    aCtx.fillStyle = aGrad;
    aCtx.beginPath();
    aCtx.arc(cx, cy, cr, 0, Math.PI * 2);
    aCtx.fill();
  }

  const albedoMap = new THREE.CanvasTexture(albedoCanvas);
  albedoMap.wrapS = THREE.RepeatWrapping;
  albedoMap.wrapT = THREE.RepeatWrapping;
  albedoMap.repeat.set(6, 6);
  albedoMap.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(6, 6);

  return { albedoMap, bumpMap };
}
