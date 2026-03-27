import { Bot, BarChart3, Package, MessageSquare } from 'lucide-react';

const agents = [
  {
    icon: BarChart3,
    title: 'Analista BI',
    description: 'Responde preguntas sobre tu negocio en lenguaje natural. Preguntale lo que quieras.',
  },
  {
    icon: Package,
    title: 'Gestor de Stock',
    description: 'Automatiza reposición y detecta quiebres de stock antes de que pasen.',
  },
  {
    icon: MessageSquare,
    title: 'Agente de Ventas',
    description: 'Atiende consultas de clientes 24/7 con información actualizada de tu tienda.',
  },
];

export default function AgentsPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center py-8">
        <div className="w-20 h-20 rounded-2xl bg-[#ED7C00]/10 flex items-center justify-center mx-auto mb-5">
          <Bot className="w-10 h-10 text-[#ED7C00]" />
        </div>
        <h1 className="text-2xl font-bold text-[#132229] mb-2">Agentes de IA</h1>
        <p className="text-gray-500 text-lg mb-1">Tu equipo virtual de trabajo está en desarrollo</p>
        <p className="text-gray-400 max-w-lg mx-auto">
          Pronto vas a poder interactuar con agentes especializados que analizan tu negocio,
          te alertan sobre problemas y te recomiendan acciones. Todo desde este panel.
        </p>
      </div>

      {/* Agent cards */}
      <div className="grid md:grid-cols-3 gap-5">
        {agents.map((agent) => (
          <div
            key={agent.title}
            className="bg-white rounded-xl border border-gray-200 p-6 opacity-75"
          >
            <div className="w-12 h-12 rounded-xl bg-[#132229]/5 flex items-center justify-center mb-4">
              <agent.icon className="w-6 h-6 text-[#32576F]" />
            </div>
            <h3 className="font-semibold text-[#132229] mb-2">{agent.title}</h3>
            <p className="text-gray-500 text-sm">{agent.description}</p>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="text-center">
        <button
          disabled
          className="bg-gray-200 text-gray-400 font-medium px-6 py-3 rounded-xl cursor-not-allowed"
        >
          Próximamente
        </button>
      </div>
    </div>
  );
}
