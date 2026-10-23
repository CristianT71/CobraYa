import { useState } from 'react';

// Bloque de código con botón para copiar. Si el navegador no permite copiar
// (por ejemplo, en una página sin https), el botón avisa en vez de fallar.
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 2000);
  }

  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span>{label}</span>
        <button type="button" className="btn btn-small btn-ghost" onClick={copy}>
          {state === 'copied'
            ? 'Copiado'
            : state === 'failed'
              ? 'No se pudo copiar'
              : 'Copiar'}
        </button>
      </div>
      <pre tabIndex={0} aria-label={label}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
