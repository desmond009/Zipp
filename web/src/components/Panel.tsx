import type { ReactNode } from 'react';

/** A bordered box with a "$ command" heading, the building block of every page. */
export function Panel({
  title,
  actions,
  className = '',
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-heading">
          {title && <h2 className="panel-title">{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** "$ clickpulse ls" with the green prompt. */
export function Command({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="accent">$</span> {children}
    </>
  );
}
