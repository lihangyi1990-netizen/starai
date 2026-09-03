import { clsx } from "clsx";

type PixelPetKind = "cat" | "bunny" | "bear";

export function PixelPet({
  kind = "cat",
  size = 56,
  className,
  label,
}: {
  kind?: PixelPetKind;
  size?: number;
  className?: string;
  label?: string;
}) {
  const face =
    kind === "bunny" ? (
      <>
        <rect x="15" y="4" width="8" height="17" rx="3" fill="#ffd1df" />
        <rect x="41" y="4" width="8" height="17" rx="3" fill="#ffd1df" />
        <rect x="12" y="16" width="40" height="38" rx="12" fill="#fff0d1" />
        <rect x="19" y="29" width="5" height="5" fill="#3c3152" />
        <rect x="40" y="29" width="5" height="5" fill="#3c3152" />
        <rect x="29" y="36" width="6" height="4" fill="#e9859d" />
        <rect x="22" y="42" width="8" height="3" fill="#f9b4bf" />
        <rect x="34" y="42" width="8" height="3" fill="#f9b4bf" />
      </>
    ) : kind === "bear" ? (
      <>
        <rect x="10" y="13" width="13" height="13" rx="5" fill="#a86a47" />
        <rect x="41" y="13" width="13" height="13" rx="5" fill="#a86a47" />
        <rect x="11" y="18" width="42" height="37" rx="13" fill="#d99766" />
        <rect x="19" y="31" width="5" height="5" fill="#3d2a28" />
        <rect x="40" y="31" width="5" height="5" fill="#3d2a28" />
        <rect x="28" y="37" width="8" height="6" rx="2" fill="#f1c18a" />
        <rect x="30" y="38" width="4" height="3" fill="#3d2a28" />
      </>
    ) : (
      <>
        <path d="M13 22V9l11 8h16l11-8v13" fill="#ffba63" />
        <rect x="10" y="18" width="44" height="38" rx="13" fill="#ffd477" />
        <rect x="18" y="30" width="5" height="5" fill="#3b3150" />
        <rect x="41" y="30" width="5" height="5" fill="#3b3150" />
        <rect x="29" y="36" width="6" height="5" fill="#ed8c9c" />
        <rect x="20" y="43" width="8" height="3" fill="#f5adad" />
        <rect x="36" y="43" width="8" height="3" fill="#f5adad" />
      </>
    );

  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label={label || (kind === "bunny" ? "tuna 像素小兔" : kind === "bear" ? "tuna 像素小熊" : "tuna 像素小猫")}
      width={size}
      height={size}
      className={clsx("pixel-pet", className)}
    >
      <rect x="6" y="49" width="52" height="7" rx="3.5" fill="#d7b887" opacity=".35" />
      {face}
    </svg>
  );
}
