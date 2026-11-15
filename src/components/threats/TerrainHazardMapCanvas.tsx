import React, { useEffect, useRef, useState } from 'react';
import type { TerrainAnalysisResult } from '../../types/lunar';
import type { TerrainHazardCell, TerrainSubsystemState } from '../../types/threats';

interface TerrainHazardMapCanvasProps {
  terrain: TerrainAnalysisResult;
  terrainSub: TerrainSubsystemState;
}

export function TerrainHazardMapCanvas({ terrain, terrainSub }: TerrainHazardMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hovered, setHovered] = useState<TerrainHazardCell | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, w, h);

    const n = terrain.gridSize;
    const innerN = Math.max(1, n - 2);
    const cellW = w / innerN;
    const cellH = h / innerN;

    for (const cell of terrainSub.hazardCells) {
      const px = (cell.c - 1) * cellW;
      const py = (cell.r - 1) * cellH;
      if (cell.isDiscontinuity) {
        ctx.fillStyle = '#dc2626'; // Elevation discontinuity step (T10)
      } else if (cell.isHiddenDepression) {
        ctx.fillStyle = '#a855f7'; // Hidden depression pit (T05)
      } else if (cell.slopeDeg > 16) {
        ctx.fillStyle = '#ef4444'; // Critical slope (>16°, T03)
      } else if (cell.isHazard) {
        ctx.fillStyle = '#f59e0b'; // Marginal / hazard slope
      } else {
        ctx.fillStyle = '#10b981'; // Candidate compliant macro-pad
      }
      ctx.fillRect(px, py, Math.ceil(cellW), Math.ceil(cellH));
    }

    // Draw detected LOLA craters
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    for (const cr of terrain.detectedCraters) {
      if (cr.distanceKm > terrain.radiusKm) continue;
      const az = (cr.azimuthDeg * Math.PI) / 180;
      const dxKm = cr.distanceKm * Math.sin(az);
      const dyKm = -cr.distanceKm * Math.cos(az);
      const cx = (dxKm / (terrain.radiusKm * 2) + 0.5) * w;
      const cy = (dyKm / (terrain.radiusKm * 2) + 0.5) * h;
      const rPx = Math.max(6, ((cr.diameterKm / 2) / (terrain.radiusKm * 2)) * w);
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Mark divert target crosshair
    const midX = w / 2;
    const midY = h / 2;
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(midX - 8, midY);
    ctx.lineTo(midX + 8, midY);
    ctx.moveTo(midX, midY - 8);
    ctx.lineTo(midX, midY + 8);
    ctx.stroke();
  }, [terrain, terrainSub]);

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    const n = terrain.gridSize;
    const c = Math.max(1, Math.min(n - 2, Math.floor(u * (n - 2)) + 1));
    const r = Math.max(1, Math.min(n - 2, Math.floor(v * (n - 2)) + 1));
    const match = terrainSub.hazardCells.find((cell) => cell.r === r && cell.c === c) ?? null;
    setHovered(match);
  };

  return (
    <div className="space-y-2">
      <div className="relative border border-slate-800 rounded overflow-hidden bg-[#05070C]">
        <canvas
          ref={canvasRef}
          width={420}
          height={320}
          onMouseMove={handleMove}
          onMouseLeave={() => setHovered(null)}
          className="w-full h-64 block cursor-crosshair"
        />
        {hovered && (
          <div className="pointer-events-none absolute bottom-2 left-2 bg-[#07090E]/95 border border-slate-700 px-2.5 py-1.5 rounded text-[11px] font-mono text-slate-200">
            {hovered.lat}°, {hovered.lon}° · Elev {hovered.elevationM} m · Slope {hovered.slopeDeg}°
            {hovered.isHiddenDepression ? ' · PIT' : hovered.isDiscontinuity ? ' · STEP' : ''}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
        <span className="text-emerald-400">Green: Candidate Safe Pad</span>
        <span className="text-amber-300">Amber: Slope Hazard / Crater Rim</span>
        <span className="text-rose-400">Red: Steep (&gt;16°) / Discontinuity</span>
        <span className="text-violet-300">Violet: Concave Pit</span>
      </div>
    </div>
  );
}
