import React, { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, StopCircle, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useMission } from '../../context/MissionContext';

export interface CameraObstacleScanResult {
  capturedAtUtc: string;
  sourceKind: 'live-camera' | 'uploaded-frame';
  resolutionLabel: string;
  obstacleCoveragePct: number;
  shadowOcclusionPct: number;
  glareSaturationPct: number;
  roughnessScore: number;
  estimatedVisibilityPct: number;
  clearLandingGridCells: number;
  totalGridCells: number;
  recommendation: string;
}

export function RealCameraScanner() {
  const { setFaultInjection, pushNotification } = useMission();
  const [streamActive, setStreamActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Zero preloaded metrics: strictly null until user captures or uploads a real frame
  const [scanResult, setScanResult] = useState<CameraObstacleScanResult | null>(null);
  const [appliedToSim, setAppliedToSim] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      for (const tr of streamRef.current.getTracks()) tr.stop();
      streamRef.current = null;
    }
    setStreamActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const analyzeImageSource = (
    source: HTMLVideoElement | HTMLImageElement,
    srcW: number,
    srcH: number,
    sourceKind: CameraObstacleScanResult['sourceKind'],
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 320;
    const H = 240;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(source, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    const data = img.data;

    // Convert to luminance buffer
    const lum = new Float32Array(W * H);
    let shadowPixels = 0;
    let glarePixels = 0;
    for (let i = 0; i < W * H; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[i] = y;
      if (y < 38) shadowPixels++;
      if (y > 242) glarePixels++;
    }

    // Divide frame into 8x6 tactical cells and measure Sobel/gradient edge density & contrast
    const cols = 8;
    const rows = 6;
    const cellW = W / cols;
    const cellH = H / rows;
    let hazardCells = 0;
    let edgeSumTotal = 0;

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const x0 = Math.floor(gx * cellW);
        const y0 = Math.floor(gy * cellH);
        const x1 = Math.floor((gx + 1) * cellW);
        const y1 = Math.floor((gy + 1) * cellH);

        let cellEdgeSum = 0;
        let cellDark = 0;
        let cellBright = 0;
        let count = 0;

        for (let py = y0 + 1; py < y1 - 1; py++) {
          for (let px = x0 + 1; px < x1 - 1; px++) {
            const idx = py * W + px;
            const dx = Math.abs(lum[idx + 1] - lum[idx - 1]);
            const dy = Math.abs(lum[idx + W] - lum[idx - W]);
            const edge = dx + dy;
            cellEdgeSum += edge;
            if (lum[idx] < 38) cellDark++;
            if (lum[idx] > 242) cellBright++;
            count++;
          }
        }

        const avgEdge = cellEdgeSum / Math.max(1, count);
        edgeSumTotal += avgEdge;
        const darkRatio = cellDark / Math.max(1, count);
        const glareRatio = cellBright / Math.max(1, count);

        const isRedHazard = avgEdge > 24 || darkRatio > 0.52 || glareRatio > 0.45;
        const isAmberCaution = !isRedHazard && (avgEdge > 14 || darkRatio > 0.25);
        if (isRedHazard) hazardCells++;

        ctx.strokeStyle = isRedHazard
          ? 'rgba(239, 68, 68, 0.85)'
          : isAmberCaution
            ? 'rgba(245, 158, 11, 0.75)'
            : 'rgba(16, 185, 129, 0.45)';
        ctx.fillStyle = isRedHazard
          ? 'rgba(239, 68, 68, 0.22)'
          : isAmberCaution
            ? 'rgba(245, 158, 11, 0.14)'
            : 'rgba(16, 185, 129, 0.06)';
        ctx.lineWidth = 1.25;
        ctx.fillRect(x0 + 1, y0 + 1, cellW - 2, cellH - 2);
        ctx.strokeRect(x0 + 1, y0 + 1, cellW - 2, cellH - 2);
      }
    }

    const totalCells = cols * rows;
    const clearCells = totalCells - hazardCells;
    const obstacleCoveragePct = Number(((hazardCells / totalCells) * 100).toFixed(1));
    const shadowOcclusionPct = Number(((shadowPixels / (W * H)) * 100).toFixed(1));
    const glareSaturationPct = Number(((glarePixels / (W * H)) * 100).toFixed(1));
    const roughnessScore = Number(Math.min(100, (edgeSumTotal / totalCells) * 2.2).toFixed(1));
    const estimatedVisibilityPct = Number(
      Math.max(5, 100 - shadowOcclusionPct * 0.7 - glareSaturationPct * 0.85).toFixed(1),
    );

    const recommendation =
      clearCells === 0
        ? 'No low-gradient optical cell detected — command crater/roughness divert burn'
        : obstacleCoveragePct > 45
          ? `High optical clutter (${obstacleCoveragePct}% hazard cells) — divert to ${clearCells} green clear zone(s)`
          : `Optical surface scan clear (${clearCells}/${totalCells} green cells usable)`;

    setScanResult({
      capturedAtUtc: new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z',
      sourceKind,
      resolutionLabel: `${srcW}×${srcH}`,
      obstacleCoveragePct,
      shadowOcclusionPct,
      glareSaturationPct,
      roughnessScore,
      estimatedVisibilityPct,
      clearLandingGridCells: clearCells,
      totalGridCells: totalCells,
      recommendation,
    });
    setAppliedToSim(false);
  };

  const startLiveCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Browser MediaDevices API unavailable. Use "Upload Optical Frame" to scan a real image.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      setStreamActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? `Camera access denied or absent (${err.message}). Upload an optical image below to scan real pixels.`
          : 'Camera access unavailable. Upload an optical image below to scan real pixels.',
      );
      setStreamActive(false);
    }
  };

  const captureFromLiveCamera = () => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return;
    analyzeImageSource(v, v.videoWidth, v.videoHeight, 'live-camera');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      analyzeImageSource(img, img.naturalWidth, img.naturalHeight, 'uploaded-frame');
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setCameraError('Failed to decode uploaded image frame.');
    };
    img.src = url;
    e.target.value = '';
  };

  const applyScanToThreatEngine = () => {
    if (!scanResult) return;
    setFaultInjection((prev) => ({
      ...prev,
      active: true,
      scenarioId: 'camera-obstacle-scan',
      scenarioName: 'Live Optical Camera Scan Injection',
      cameraSaturation: scanResult.glareSaturationPct > 22,
      forcePoorIlluminationDeg: scanResult.shadowOcclusionPct > 45 ? 1.5 : prev.forcePoorIlluminationDeg,
      forceCraterHazard: scanResult.obstacleCoveragePct > 55 ? true : prev.forceCraterHazard,
    }));
    setAppliedToSim(true);
    pushNotification('Applied real optical camera obstacle metrics to LUNASIGHT Threat Engine', 'info');
  };

  return (
    <div className="bg-[#0D121C] border border-slate-800 rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-display font-semibold text-slate-100 flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-cyan-400" />
            Real-Time Optical Camera Obstacle Scanner
          </h3>
          <p className="text-[11px] text-slate-400">
            Zero preloaded metrics — captures real pixel luminance &amp; Sobel edge gradients to map obstacles.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!streamActive ? (
            <button
              type="button"
              onClick={() => void startLiveCamera()}
              className="px-3 py-1.5 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              Camera Scan
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={captureFromLiveCamera}
                className="px-3 py-1.5 text-xs font-medium bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Capture &amp; Scan Frame
              </button>
              <button
                type="button"
                onClick={stopCamera}
                className="px-2.5 py-1.5 text-xs bg-rose-950/50 border border-rose-800 text-rose-200 rounded-md inline-flex items-center gap-1 cursor-pointer"
              >
                <StopCircle className="w-3.5 h-3.5" />
                Stop
              </button>
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1.5 text-xs bg-[#07090E] hover:border-slate-500 border border-slate-700 text-slate-200 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Frame
          </button>
        </div>
      </div>

      {cameraError && (
        <div className="bg-amber-950/40 border border-amber-800 rounded p-2.5 text-[11px] text-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span>{cameraError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-[#07090E] border border-slate-800 rounded overflow-hidden min-h-[168px] flex items-center justify-center relative">
          <video
            ref={videoRef}
            muted
            playsInline
            className={`w-full h-44 object-cover ${streamActive ? 'block' : 'hidden'}`}
          />
          {!streamActive && (
            <div className="p-4 text-center text-xs text-slate-500 space-y-1">
              <div>Camera feed idle</div>
              <div className="text-[11px]">Press &quot;Camera Scan&quot; or upload an image frame to begin real pixel detection.</div>
            </div>
          )}
        </div>

        <div className="bg-[#07090E] border border-slate-800 rounded overflow-hidden min-h-[168px] flex items-center justify-center relative">
          <canvas
            ref={canvasRef}
            className={`w-full h-44 object-cover ${scanResult ? 'block' : 'hidden'}`}
          />
          {!scanResult && (
            <div className="p-4 text-center text-xs text-slate-500 space-y-1 font-mono">
              <div>No optical scan recorded yet</div>
              <div className="text-[11px] font-sans">Green = Clear · Amber = Caution · Red = Obstacle/Shadow/Glare</div>
            </div>
          )}
        </div>
      </div>

      {scanResult && (
        <div className="space-y-2.5 pt-1">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono tabular-nums">
            <div className="bg-[#07090E] border border-slate-800 rounded p-2">
              <div className="text-[10px] font-sans text-slate-400">Obstacles</div>
              <div className="text-sm font-semibold text-rose-300">{scanResult.obstacleCoveragePct}%</div>
            </div>
            <div className="bg-[#07090E] border border-slate-800 rounded p-2">
              <div className="text-[10px] font-sans text-slate-400">Roughness Index</div>
              <div className="text-sm font-semibold text-amber-300">{scanResult.roughnessScore}</div>
            </div>
            <div className="bg-[#07090E] border border-slate-800 rounded p-2">
              <div className="text-[10px] font-sans text-slate-400">Shadow Occlusion</div>
              <div className="text-sm font-semibold text-slate-200">{scanResult.shadowOcclusionPct}%</div>
            </div>
            <div className="bg-[#07090E] border border-slate-800 rounded p-2">
              <div className="text-[10px] font-sans text-slate-400">Optical Visibility</div>
              <div className="text-sm font-semibold text-cyan-300">{scanResult.estimatedVisibilityPct}%</div>
            </div>
            <div className="bg-[#07090E] border border-slate-800 rounded p-2">
              <div className="text-[10px] font-sans text-slate-400">Clear Cells</div>
              <div className="text-sm font-semibold text-emerald-300">
                {scanResult.clearLandingGridCells}/{scanResult.totalGridCells}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#07090E] border border-slate-800 rounded p-2.5 text-xs">
            <div className="text-slate-300">
              <span className="font-mono text-cyan-300 mr-2">[{scanResult.capturedAtUtc}]</span>
              {scanResult.recommendation}
            </div>
            <button
              type="button"
              onClick={applyScanToThreatEngine}
              className={`px-3 py-1 text-xs rounded border inline-flex items-center gap-1.5 cursor-pointer shrink-0 ${
                appliedToSim
                  ? 'bg-emerald-950/50 border-emerald-700 text-emerald-300'
                  : 'bg-cyan-600/20 border-cyan-700 hover:bg-cyan-600/30 text-cyan-200'
              }`}
            >
              {appliedToSim && <CheckCircle2 className="w-3.5 h-3.5" />}
              {appliedToSim ? 'Applied to Threat Engine' : 'Apply Scan to Simulation'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
