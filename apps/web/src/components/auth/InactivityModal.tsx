'use client';

import { Modal } from '@/components/ui/Modal';

interface InactivityModalProps {
  secondsLeft: number;
  onContinue: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function InactivityModal({ secondsLeft, onContinue }: InactivityModalProps) {
  const urgent = secondsLeft <= 30;

  return (
    <Modal
      open={true}
      onClose={onContinue}
      title="¿Seguís ahí?"
      size="sm"
    >
      <div className="flex flex-col items-center gap-5 text-center">
        {/* Countdown ring */}
        <div
          className={`flex items-center justify-center w-20 h-20 rounded-full border-4 text-2xl font-bold tabular-nums transition-colors duration-300 ${
            urgent
              ? 'border-red-500 text-red-400'
              : 'border-[#32BFFF] text-[#32BFFF]'
          }`}
        >
          {formatTime(secondsLeft)}
        </div>

        <p className="text-sm text-[#7A9BAD] leading-relaxed">
          Tu sesión se cerrará automáticamente por inactividad.
          <br />
          ¿Querés continuar?
        </p>

        <button
          onClick={onContinue}
          className="w-full py-2.5 rounded-xl bg-[#32BFFF] hover:bg-[#1DA8E8] text-[#0B1F29] font-semibold text-sm transition-colors"
        >
          Continuar sesión
        </button>

        <p className={`text-xs transition-colors duration-300 ${urgent ? 'text-red-400' : 'text-[#7A9BAD]'}`}>
          {urgent
            ? 'La sesión se cerrará en menos de 30 segundos.'
            : 'Si no respondés, serás redirigido al inicio de sesión.'}
        </p>
      </div>
    </Modal>
  );
}
