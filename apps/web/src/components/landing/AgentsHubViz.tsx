'use client';

import { useEffect, useRef, useState } from 'react';

// ── Agent definitions ──────────────────────────────────────────────────────────

const AGENTS = [
  {
    id: 'maya',
    name: 'Maya',
    role: 'Analista BI',
    abbr: 'BI',
    color: '#ED7C00',
    tasks: ['Detecta tendencias de venta', 'Genera reportes automáticos', 'Predice demanda por talle'],
    connections: ['Instagram Insights', 'Google Analytics', 'Panel HUB'],
    autonomy: 3,
  },
  {
    id: 'brio',
    name: 'Brio',
    role: 'Agente de Ventas',
    abbr: 'VT',
    color: '#2B8CB8',
    tasks: ['Analiza conversión por canal', 'Identifica clientes en riesgo', 'Sugiere upsell por historial'],
    connections: ['Tienda Nube', 'WhatsApp Business', 'Meta Ads'],
    autonomy: 2,
  },
  {
    id: 'caro',
    name: 'Caro',
    role: 'Admin. Financiera',
    abbr: 'FIN',
    color: '#2AAF7B',
    tasks: ['Controla flujo de caja diario', 'Alerta si el ratio gastos/ventas sube', 'Prepara informes mensuales'],
    connections: ['Mercado Pago', 'Gmail', 'AFIP/ARCA'],
    autonomy: 2,
  },
  {
    id: 'luca',
    name: 'Luca',
    role: 'Jefe de Inventario',
    abbr: 'INV',
    color: '#D4A017',
    tasks: ['Detecta quiebre de stock', 'Genera órdenes de compra sugeridas', 'Optimiza distribución entre locales'],
    connections: ['Proveedores externos', 'Email automático', 'Sistema ERP'],
    autonomy: 3,
  },
  {
    id: 'vera',
    name: 'Vera',
    role: 'Fidelización',
    abbr: 'CRM',
    color: '#C84B7A',
    tasks: ['Segmenta base de clientes', 'Envía campañas personalizadas', 'Detecta clientes inactivos'],
    connections: ['Gmail', 'WhatsApp', 'Instagram DM'],
    autonomy: 2,
  },
  {
    id: 'hugo',
    name: 'Hugo',
    role: 'Coordinador Op.',
    abbr: 'OPS',
    color: '#5A8FAF',
    tasks: ['Organiza fichadas del personal', 'Coordina tareas entre locales', 'Reporta KPIs operativos'],
    connections: ['Google Calendar', 'Gmail', 'Sistema ERP'],
    autonomy: 1,
  },
];

const AUTONOMY_LABELS = ['Asistido', 'Semi-autónomo', 'Autónomo'];
const AUTONOMY_DESCS = [
  'Sugiere acciones, vos decidís',
  'Ejecuta tareas rutinarias con tu aprobación',
  'Opera de forma independiente las 24hs',
];

// ── Before/After data ──────────────────────────────────────────────────────────

const BEFORE_TASKS = [
  { who: 'Vos', task: 'Revisás el stock manualmente cada mañana', time: '45 min/día' },
  { who: 'Vos', task: 'Calculás márgenes en una planilla Excel', time: '2 hrs/sem' },
  { who: 'Vos', task: 'Respondés consultas de stock a distancia', time: '30 min/día' },
  { who: 'Vos', task: 'Armás el informe de ventas del mes', time: '3 hrs/mes' },
];

const AFTER_TASKS = [
  { who: 'Luca', task: 'Monitorea stock y avisa con 3 días de anticipación', time: 'Automático' },
  { who: 'Caro', task: 'Calcula márgenes en tiempo real y envía reporte', time: 'Instantáneo' },
  { who: 'Maya', task: 'Responde automáticamente con datos actualizados', time: 'Siempre activo' },
  { who: 'Maya', task: 'Genera el informe y lo envía por email el día 1', time: 'Programado' },
];

// ── Positions for the 6-node circle SVG ───────────────────────────────────────

const CX = 320;
const CY = 280;
const NODE_POSITIONS = [
  { x: 320, y:  80 },
  { x: 520, y: 165 },
  { x: 520, y: 350 },
  { x: 320, y: 435 },
  { x: 120, y: 350 },
  { x: 120, y: 165 },
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function AgentsHubViz() {
  const vizRef = useRef<HTMLDivElement>(null);
  const [activeAgent, setActiveAgent] = useState<number | null>(null);
  const [tab, setTab] = useState<'network' | 'before' | 'autonomy'>('network');

  useEffect(() => {
    const el = vizRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) el.classList.add('viz-in');
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const agent = activeAgent !== null ? AGENTS[activeAgent] : null;

  return (
    <div ref={vizRef} className="w-full max-w-[640px] mx-auto">
      <style>{`
        @keyframes agentBreathe {
          0%,100% { transform: scale(1);   opacity:1; }
          50%      { transform: scale(.92); opacity:.75; }
        }
        @keyframes lineIn {
          from { stroke-dashoffset:400; opacity:0; }
          to   { stroke-dashoffset:0;   opacity:.45; }
        }
        @keyframes packetMove {
          0%   { offset-distance:0%;   opacity:1; }
          85%  { opacity:1; }
          100% { offset-distance:100%; opacity:0; }
        }
        @keyframes hubPulse {
          0%,100% { box-shadow:0 0 0 0 rgba(237,124,0,.0); }
          50%      { box-shadow:0 0 0 14px rgba(237,124,0,.1); }
        }
        .viz-in .agent-node { animation-play-state:running; }
        .viz-in .viz-line   { animation-play-state:running; }
        .agent-node { animation:agentBreathe 3s ease-in-out infinite paused; }
        .viz-line   { stroke-dasharray:400; animation:lineIn 0.9s ease forwards paused; }
        .hub-ring   { animation:hubPulse 3s ease-in-out infinite; }
      `}</style>

      {/* Tab switcher */}
      <div className="flex gap-2 mb-5 p-1 bg-[#1A2F3D] rounded-xl border border-[#32576F]/40">
        {(['network', 'before', 'autonomy'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={[
              'flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all duration-200',
              tab === t
                ? 'bg-[#ED7C00] text-white shadow-sm'
                : 'text-[#7A9BAD] hover:text-white',
            ].join(' ')}>
            {t === 'network' ? 'Red de agentes' : t === 'before' ? 'Antes vs Después' : 'Autonomía'}
          </button>
        ))}
      </div>

      {/* ── NETWORK TAB ── */}
      {tab === 'network' && (
        <div>
          <svg viewBox="0 0 640 520" fill="none" xmlns="http://www.w3.org/2000/svg"
               aria-label="Red de agentes de IA de Alpha IT Hub" className="w-full">
            {/* Connection lines */}
            {AGENTS.map((ag, i) => (
              <g key={ag.id}>
                <line
                  x1={CX} y1={CY} x2={NODE_POSITIONS[i].x} y2={NODE_POSITIONS[i].y}
                  stroke={ag.color} strokeWidth="1.5"
                  className="viz-line"
                  style={{ animationDelay: `${i * 0.15}s`, opacity: activeAgent === i ? 0.8 : 0.4 }}
                />
                <circle r="3.5" fill={ag.color} opacity="0.9">
                  <animateMotion dur={`${2.5 + i * 0.4}s`} begin={`${i * 0.5}s`} repeatCount="indefinite"
                    path={`M${CX},${CY} L${NODE_POSITIONS[i].x},${NODE_POSITIONS[i].y}`} />
                  <animate attributeName="opacity" values="0;1;0" dur={`${2.5 + i * 0.4}s`}
                    begin={`${i * 0.5}s`} repeatCount="indefinite" />
                </circle>
              </g>
            ))}

            {/* Central hub */}
            <foreignObject x={CX - 56} y={CY - 56} width="112" height="112">
              <div className="hub-ring w-[112px] h-[112px] rounded-[28px] bg-[#0F1E26] border-2 border-[#ED7C00]/60
                              flex flex-col items-center justify-center"
                   style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                <svg width="36" height="36" viewBox="0 0 300 220" fill="#ED7C00" aria-hidden="true">
                  <path d="M139.21,65.64c14.46,23.45,28.66,47.06,42.86,70.66,13.74,22.84,27.42,45.74,40.92,68.72h37.73c-3.19-5.15-6.38-10.31-9.57-15.46-14.46-23.45-28.66-47.06-42.86-70.66-14.2-23.6-28.34-47.25-42.27-71.02-4.12-6.93-8.16-13.9-12.12-20.91-1.37-2.25-2.62-4.57-3.81-6.92-4.67,7.7-9.34,15.39-14.06,23.05-1.77,2.91-3.58,5.78-5.39,8.67,2.86,4.62,5.72,9.24,8.58,13.86Z"/>
                  <path d="M118.68,74.63c-9.28,15.66-18.61,31.28-27.98,46.89-2.3,3.83-4.61,7.65-6.92,11.48-3.8,6.34-7.59,12.68-11.39,19.02-10.63,17.71-21.33,35.39-32.11,53.01h40.45c19.51-31.8,39.02-63.6,58.54-95.39-6.86-11.67-13.73-23.34-20.59-35Z"/>
                  <path d="M106.69,205.03h91.97c-6.94-11.56-13.88-23.13-20.82-34.69h-49.47c-7.23,11.56-14.45,23.13-21.68,34.69Z"/>
                </svg>
                <p className="text-[9px] text-[#ED7C00] font-semibold tracking-widest uppercase mt-1">HUB IA</p>
              </div>
            </foreignObject>

            {/* Agent nodes */}
            {AGENTS.map((ag, i) => (
              <foreignObject key={ag.id}
                x={NODE_POSITIONS[i].x - 58} y={NODE_POSITIONS[i].y - 44}
                width="116" height="88">
                <button
                  onClick={() => setActiveAgent(activeAgent === i ? null : i)}
                  className={[
                    'agent-node w-[116px] h-[88px] rounded-2xl flex flex-col items-center justify-center gap-1',
                    'cursor-pointer transition-all duration-300',
                    activeAgent === i
                      ? 'bg-[#1A2F3D] shadow-lg'
                      : 'bg-[#1A2F3D]/90 hover:bg-[#1A2F3D]',
                  ].join(' ')}
                  style={{
                    animationDelay: `${i * 0.5}s`,
                    border: `1.5px solid ${activeAgent === i ? ag.color : ag.color + '35'}`,
                    fontFamily: 'Space Grotesk, sans-serif',
                    boxShadow: activeAgent === i ? `0 0 20px ${ag.color}30` : 'none',
                  }}
                  aria-label={`Ver detalles de ${ag.name}`}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold"
                       style={{ backgroundColor: ag.color }}>
                    {ag.abbr.slice(0, 2)}
                  </div>
                  <p className="text-white text-[11px] font-semibold leading-none">{ag.name}</p>
                  <p className="text-[9px] leading-none" style={{ color: ag.color }}>{ag.role}</p>
                </button>
              </foreignObject>
            ))}
          </svg>

          {/* Agent detail panel */}
          {agent && (
            <div className="mt-3 bg-[#1A2F3D] border rounded-2xl p-5 transition-all duration-300"
                 style={{ borderColor: agent.color + '40' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                     style={{ backgroundColor: agent.color }}>
                  {agent.abbr}
                </div>
                <div>
                  <p className="text-white font-semibold">{agent.name} — {agent.role}</p>
                  <p className="text-[11px]" style={{ color: agent.color }}>
                    Autonomía: {AUTONOMY_LABELS[agent.autonomy - 1]}
                  </p>
                </div>
                <div className="ml-auto flex gap-1">
                  {[1,2,3].map(l => (
                    <div key={l} className="w-5 h-2 rounded-full"
                         style={{ backgroundColor: l <= agent.autonomy ? agent.color : agent.color + '25' }} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] text-[#7A9BAD] uppercase tracking-widest mb-2">Tareas</p>
                  {agent.tasks.map(t => (
                    <div key={t} className="flex items-start gap-2 mb-1.5">
                      <div className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                           style={{ backgroundColor: agent.color }} />
                      <p className="text-xs text-[#CDD4DA]">{t}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] text-[#7A9BAD] uppercase tracking-widest mb-2">Integraciones</p>
                  {agent.connections.map(c => (
                    <div key={c} className="inline-flex items-center gap-1.5 mr-2 mb-2 px-2.5 py-1 rounded-lg text-[10px] font-medium border"
                         style={{ borderColor: agent.color + '30', color: agent.color, backgroundColor: agent.color + '10' }}>
                      {c}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!agent && (
            <p className="text-center text-[11px] text-[#32576F] mt-3">
              Tocá un agente para ver sus tareas e integraciones
            </p>
          )}
        </div>
      )}

      {/* ── BEFORE / AFTER TAB ── */}
      {tab === 'before' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Before */}
            <div className="bg-[#1A2F3D] border border-[#32576F]/40 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-[#32576F]/40 flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                       stroke="#7A9BAD" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z"/>
                  </svg>
                </div>
                <p className="text-[#7A9BAD] font-semibold text-sm">Sin Alpha IT Hub</p>
              </div>
              {BEFORE_TASKS.map(t => (
                <div key={t.task} className="mb-3 p-3 bg-[#0F1E26]/60 rounded-xl border border-[#32576F]/20">
                  <p className="text-[#CDD4DA] text-xs leading-snug mb-1">{t.task}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#7A9BAD]">Responsable: {t.who}</span>
                    <span className="text-[10px] text-red-400 font-mono">{t.time}</span>
                  </div>
                </div>
              ))}
              <div className="mt-4 pt-3 border-t border-[#32576F]/30">
                <p className="text-[10px] text-[#7A9BAD] uppercase tracking-widest mb-1">Tiempo total estimado</p>
                <p className="text-red-400 font-bold font-mono">~7 horas/semana</p>
              </div>
            </div>

            {/* After */}
            <div className="bg-[#1A2F3D] border border-[#ED7C00]/30 rounded-2xl p-5"
                 style={{ boxShadow: '0 0 30px rgba(237,124,0,0.08)' }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-[#ED7C00]/20 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 300 220" fill="#ED7C00" aria-hidden="true">
                    <path d="M139.21,65.64c14.46,23.45,28.66,47.06,42.86,70.66,13.74,22.84,27.42,45.74,40.92,68.72h37.73c-3.19-5.15-6.38-10.31-9.57-15.46-14.46-23.45-28.66-47.06-42.86-70.66-14.2-23.6-28.34-47.25-42.27-71.02-4.12-6.93-8.16-13.9-12.12-20.91-1.37-2.25-2.62-4.57-3.81-6.92-4.67,7.7-9.34,15.39-14.06,23.05-1.77,2.91-3.58,5.78-5.39,8.67,2.86,4.62,5.72,9.24,8.58,13.86Z"/>
                    <path d="M118.68,74.63c-9.28,15.66-18.61,31.28-27.98,46.89-2.3,3.83-4.61,7.65-6.92,11.48-3.8,6.34-7.59,12.68-11.39,19.02-10.63,17.71-21.33,35.39-32.11,53.01h40.45c19.51-31.8,39.02-63.6,58.54-95.39-6.86-11.67-13.73-23.34-20.59-35Z"/>
                    <path d="M106.69,205.03h91.97c-6.94-11.56-13.88-23.13-20.82-34.69h-49.47c-7.23,11.56-14.45,23.13-21.68,34.69Z"/>
                  </svg>
                </div>
                <p className="text-white font-semibold text-sm">Con Alpha IT Hub</p>
              </div>
              {AFTER_TASKS.map((t, i) => (
                <div key={t.task} className="mb-3 p-3 bg-[#0F1E26]/60 rounded-xl border border-[#ED7C00]/15"
                     style={{ animationDelay: `${i * 0.1}s` }}>
                  <p className="text-[#CDD4DA] text-xs leading-snug mb-1">{t.task}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[#ED7C00] text-[10px] font-semibold">Agente: {t.who}</span>
                    <span className="text-emerald-400 text-[10px] font-mono">{t.time}</span>
                  </div>
                </div>
              ))}
              <div className="mt-4 pt-3 border-t border-[#ED7C00]/20">
                <p className="text-[10px] text-[#7A9BAD] uppercase tracking-widest mb-1">Tiempo liberado</p>
                <p className="text-emerald-400 font-bold font-mono">~7 horas/semana</p>
              </div>
            </div>
          </div>

          <div className="bg-[#1A2F3D] border border-[#ED7C00]/20 rounded-2xl p-5 text-center">
            <p className="text-white font-semibold mb-1">
              Más de <span className="text-[#ED7C00]">300 horas al año</span> que volvés a tu negocio
            </p>
            <p className="text-[#7A9BAD] text-sm">
              Los agentes trabajan mientras vos atendés clientes, descansás o crecés.
            </p>
          </div>
        </div>
      )}

      {/* ── AUTONOMY TAB ── */}
      {tab === 'autonomy' && (
        <div className="space-y-4">
          {[1, 2, 3].map((level) => (
            <div key={level}
                 className="bg-[#1A2F3D] border border-[#32576F]/40 rounded-2xl p-5 hover:border-[#ED7C00]/30
                            transition-all duration-300">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    {[1,2,3].map(l => (
                      <div key={l} className="w-6 h-2.5 rounded-full"
                           style={{ backgroundColor: l <= level ? '#ED7C00' : 'rgba(237,124,0,0.2)' }} />
                    ))}
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">
                      Nivel {level} — {AUTONOMY_LABELS[level - 1]}
                    </p>
                    <p className="text-[#7A9BAD] text-xs mt-0.5">{AUTONOMY_DESCS[level - 1]}</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                {AGENTS.filter(a => a.autonomy === level).map(a => (
                  <div key={a.id} className="flex items-center gap-2 bg-[#0F1E26]/50 rounded-xl px-3 py-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                         style={{ backgroundColor: a.color }}>
                      {a.abbr.slice(0, 2)}
                    </div>
                    <div>
                      <p className="text-white text-xs font-semibold leading-none">{a.name}</p>
                      <p className="text-[10px] leading-none mt-0.5" style={{ color: a.color }}>{a.role}</p>
                    </div>
                  </div>
                ))}
              </div>
              {level === 3 && (
                <div className="mt-3 pt-3 border-t border-[#32576F]/20">
                  <p className="text-[11px] text-[#7A9BAD]">
                    Los agentes autónomos pueden ejecutar acciones, enviar emails y generar reportes
                    sin requerir tu confirmación. Podés ajustar el nivel en cualquier momento.
                  </p>
                </div>
              )}
            </div>
          ))}

          <div className="bg-[#1A2F3D] border border-[#32576F]/40 rounded-2xl p-5">
            <p className="text-[#ED7C00] text-xs font-semibold uppercase tracking-widest mb-3">
              Contratalos uno por uno
            </p>
            <p className="text-[#7A9BAD] text-sm leading-relaxed">
              No necesitás activar todos los agentes desde el inicio. Empezá con el que más
              necesitás, configurá sus conexiones y expandí el equipo cuando estés listo.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              {['Instagram', 'Meta Ads', 'Gmail', 'WhatsApp', 'Tienda Nube', 'Proveedores'].map(s => (
                <span key={s} className="text-[10px] px-2.5 py-1 rounded-lg font-medium
                                         border border-[#32576F]/40 text-[#CDD4DA] bg-[#0F1E26]/40">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
