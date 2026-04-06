'use client';

import { useEffect, useRef } from 'react';

const AGENTS = [
  { id: 'maya',  name: 'Maya',  role: 'Analista BI',         abbr: 'BI',  color: '#ED7C00', delay: '0s'   },
  { id: 'brio',  name: 'Brio',  role: 'Agente de Ventas',    abbr: 'VT',  color: '#2B8CB8', delay: '0.4s' },
  { id: 'caro',  name: 'Caro',  role: 'Admin. Financiera',   abbr: 'FIN', color: '#2AAF7B', delay: '0.8s' },
  { id: 'luca',  name: 'Luca',  role: 'Jefe de Inventario',  abbr: 'INV', color: '#D4A017', delay: '1.2s' },
  { id: 'vera',  name: 'Vera',  role: 'Fidelización',        abbr: 'CRM', color: '#C84B7A', delay: '1.6s' },
  { id: 'hugo',  name: 'Hugo',  role: 'Coordinador Op.',     abbr: 'OPS', color: '#5A8FAF', delay: '2.0s' },
];

// Positions on a 360px circle around center (320 320)
const POSITIONS = [
  { x: 320, y: 100 },  // top
  { x: 530, y: 185 },  // top-right
  { x: 530, y: 385 },  // bottom-right
  { x: 320, y: 470 },  // bottom
  { x: 110, y: 385 },  // bottom-left
  { x: 110, y: 185 },  // top-left
];

const CX = 320;
const CY = 290;

export default function AgentsHubViz() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Intersection observer for entrance animation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) el.classList.add('viz-visible');
      },
      { threshold: 0.2 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full max-w-[640px] mx-auto">
      <style>{`
        @keyframes agentPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%        { opacity: 0.7; transform: scale(0.94); }
        }
        @keyframes lineDraw {
          from { stroke-dashoffset: 300; opacity: 0; }
          to   { stroke-dashoffset: 0;   opacity: 0.5; }
        }
        @keyframes dataPacket {
          0%   { offset-distance: 0%;   opacity: 1; }
          80%  { opacity: 1; }
          100% { offset-distance: 100%; opacity: 0; }
        }
        @keyframes hubGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(237,124,0,0.0); }
          50%       { box-shadow: 0 0 0 12px rgba(237,124,0,0.12); }
        }
        @keyframes staggerIn {
          from { opacity: 0; transform: scale(0.8) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .viz-visible .agent-node {
          animation-play-state: running;
        }
        .agent-node {
          animation: agentPulse 3s ease-in-out infinite paused;
        }
        .viz-line {
          stroke-dasharray: 300;
          animation: lineDraw 1s ease forwards paused;
        }
        .viz-visible .viz-line {
          animation-play-state: running;
        }
        .hub-center {
          animation: hubGlow 3s ease-in-out infinite;
        }
      `}</style>

      <svg
        viewBox="0 0 640 570"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="w-full"
      >
        {/* Connection lines */}
        {AGENTS.map((agent, i) => {
          const pos = POSITIONS[i];
          return (
            <g key={agent.id}>
              <line
                x1={CX} y1={CY}
                x2={pos.x} y2={pos.y}
                stroke={agent.color}
                strokeWidth="1.5"
                className="viz-line"
                style={{ animationDelay: agent.delay, opacity: 0.4 }}
              />
              {/* Animated packet dot traveling line */}
              <circle r="3" fill={agent.color} opacity="0.8">
                <animateMotion
                  dur="3s"
                  begin={agent.delay}
                  repeatCount="indefinite"
                  path={`M${CX},${CY} L${pos.x},${pos.y}`}
                />
                <animate attributeName="opacity" values="0;1;0" dur="3s" begin={agent.delay} repeatCount="indefinite" />
              </circle>
            </g>
          );
        })}

        {/* Central hub node */}
        <foreignObject x={CX - 52} y={CY - 52} width="104" height="104">
          <div
            className="hub-center w-[104px] h-[104px] rounded-[28px] bg-[#0F1E26] border-2 border-[#ED7C00]/50 flex flex-col items-center justify-center"
            style={{ fontFamily: 'Outfit, sans-serif' }}
          >
            <div className="w-10 h-10 rounded-xl bg-[#ED7C00] flex items-center justify-center text-white font-bold text-base select-none mb-1">
              α
            </div>
            <p className="text-[9px] text-[#ED7C00] font-semibold tracking-widest uppercase">HUB IA</p>
          </div>
        </foreignObject>

        {/* Agent nodes */}
        {AGENTS.map((agent, i) => {
          const pos = POSITIONS[i];
          return (
            <foreignObject
              key={agent.id}
              x={pos.x - 54}
              y={pos.y - 40}
              width="108"
              height="80"
            >
              <div
                className="agent-node w-[108px] h-[80px] rounded-2xl bg-[#1A2F3D] flex flex-col items-center justify-center gap-1 cursor-pointer group"
                style={{
                  animationDelay: agent.delay,
                  border: `1.5px solid ${agent.color}30`,
                  fontFamily: 'Outfit, sans-serif',
                  transition: 'transform 0.3s cubic-bezier(0.16,1,0.3,1), box-shadow 0.3s',
                }}
              >
                {/* Avatar circle */}
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs select-none"
                  style={{ backgroundColor: agent.color }}
                >
                  {agent.abbr.slice(0, 2)}
                </div>
                <p className="text-white text-[11px] font-semibold leading-none">{agent.name}</p>
                <p className="text-[9px] leading-none" style={{ color: agent.color }}>{agent.role}</p>
              </div>
            </foreignObject>
          );
        })}
      </svg>

      {/* Activity feed below */}
      <div className="mt-4 bg-[#1A2F3D] border border-[#32576F]/40 rounded-2xl p-4 space-y-2">
        <p className="text-[10px] text-[#7A9BAD] uppercase tracking-widest mb-3">Actividad en tiempo real</p>
        {[
          { agent: 'Luca', color: '#D4A017', msg: 'detectó quiebre de stock en Campera Bomber XL — reposición sugerida' },
          { agent: 'Maya', color: '#ED7C00', msg: 'generó reporte: ventas del local 2 subieron 18.4% vs. mes anterior' },
          { agent: 'Caro', color: '#2AAF7B', msg: 'alerta: ratio gastos/ventas en 38% — por encima del umbral recomendado' },
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <div
              className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
              style={{ backgroundColor: item.color }}
            >
              {item.agent.slice(0, 1)}
            </div>
            <p className="text-[11px] text-[#CDD4DA] leading-snug">
              <span className="font-semibold" style={{ color: item.color }}>{item.agent}</span>{' '}
              {item.msg}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
