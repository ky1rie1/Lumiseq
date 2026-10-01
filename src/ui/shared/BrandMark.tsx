import lumiseqMarkUrl from '../../assets/brand/lumiseq-mark.svg';

export function BrandMark({ className = '' }: { className?: string }) {
  return <img src={lumiseqMarkUrl} alt="" aria-hidden="true" draggable={false} className={`brand-mark ${className}`} />;
}
