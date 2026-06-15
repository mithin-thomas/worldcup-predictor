/**
 * Avatar — user avatar with image + initial-letter fallback.
 * Used across Leaderboard, HallOfFame, StandingCard.
 */

type AvatarProps = {
  name: string;
  avatarUrl?: string;
  size?: number;
  isMe?: boolean;
};

export function Avatar({ name, avatarUrl, size = 30, isMe = false }: AvatarProps) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Deterministic hue from name string
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;

  const bg = isMe ? "var(--coral)" : `oklch(0.45 0.12 ${h})`;
  const fg = isMe ? "#1a0a06" : "#fff";

  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: bg,
        color: fg,
        minWidth: size,
      }}
      aria-hidden="true"
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          width={size}
          height={size}
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
          onError={(e) => {
            // Hide the broken image and fall back to initials
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        initials
      )}
    </span>
  );
}
