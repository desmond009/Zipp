export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span>
          <span className="accent">exit 0</span> · react · node · mongodb · redis
        </span>
        <span className="footer-links">
          <a href="https://github.com/desmond009/Zipp" target="_blank" rel="noreferrer">
            github
          </a>
          <a href="#/api">docs</a>
          <a href="/health" target="_blank" rel="noreferrer">
            status
          </a>
        </span>
      </div>
    </footer>
  );
}
