// XRE SOFTWARE SANTRAL: logodaki XRE işareti + "XRE" mavi, "SOFTWARE SANTRAL" beyaz
export function Brand({ size = 'md', href }: { size?: 'md' | 'lg'; href?: string }) {
  const body = (
    <>
      <img src="/logo-mark.png" alt="XRE" className="brand-mark" />
      <span className="brand-text"><b>XRE</b> <span className="brand-sw">SOFTWARE </span>SANTRAL</span>
    </>
  );
  const cls = `brand brand-${size}`;
  return href ? <a href={href} className={cls}>{body}</a> : <div className={cls}>{body}</div>;
}
