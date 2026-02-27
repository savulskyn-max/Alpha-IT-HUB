'use client';

import { useRef, useState } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  exportFileName?: string;
  children: React.ReactNode;
  className?: string;
}

export function ChartContainer({ title, subtitle, exportFileName, children, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!containerRef.current) return;
    setExporting(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      const canvas = await html2canvas(containerRef.current, {
        backgroundColor: '#1E3340',
        scale: 2,
        useCORS: true,
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvas.width / 2, canvas.height / 2],
      });

      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
      pdf.save(`${exportFileName ?? title.toLowerCase().replace(/\s+/g, '_')}.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={`bg-[#1E3340] border border-[#32576F] rounded-2xl overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#32576F]">
        <div>
          <h3 className="text-white font-semibold text-sm">{title}</h3>
          {subtitle && <p className="text-[#7A9BAD] text-xs mt-0.5">{subtitle}</p>}
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-1.5 text-xs text-[#7A9BAD] hover:text-[#ED7C00] transition-colors disabled:opacity-50"
        >
          {exporting ? (
            <span className="w-3.5 h-3.5 border border-[#7A9BAD] border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
          Exportar PDF
        </button>
      </div>
      <div ref={containerRef} className="p-5">
        {children}
      </div>
    </div>
  );
}
