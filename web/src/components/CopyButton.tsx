import { useState } from 'react';

export function CopyButton({ text, label = 'copy', className = 'btn' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked (non-HTTPS origin, permissions); fall back to a prompt.
      window.prompt('Copy this link:', text);
    }
  };

  return (
    <button className={className} onClick={copy}>
      {copied ? 'copied ✓' : label}
    </button>
  );
}
