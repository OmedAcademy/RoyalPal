/**
 * The RoyalPal crown, in antique gold. Shared by the logo tile and the auth
 * brand panel so the mark is defined once. `withJewels` adds the three
 * crown points used in the compact tile lockup.
 */
export function CrownGlyph({
  size = 15,
  withJewels = false,
  className = "",
}: {
  size?: number;
  withJewels?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <path d="M3.5 16.8 5.4 8.2l3.5 4.2L12 6l3.1 6.4 3.5-4.2 1.9 8.6z" fill="var(--gold-soft)" />
      <path d="M4.4 18.4h15.2v1.7H4.4z" fill="var(--gold-soft)" />
      {withJewels && (
        <>
          <circle cx="5.4" cy="6.8" r="1.15" fill="var(--gold-soft)" />
          <circle cx="12" cy="4.6" r="1.25" fill="var(--gold-soft)" />
          <circle cx="18.6" cy="6.8" r="1.15" fill="var(--gold-soft)" />
        </>
      )}
    </svg>
  );
}
