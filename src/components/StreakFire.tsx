import React from 'react';

export type FlameTier = 0 | 1 | 2 | 3 | 4 | 5;

export interface StreakFireProps {
  streakDays: number;
  activeToday?: boolean;
  activeYesterday?: boolean;
  size?: number;
  showBadge?: boolean;
  className?: string;
}

export function getFlameTier(days: number): FlameTier {
  if (days <= 0) return 0;
  if (days <= 2) return 1;
  if (days <= 6) return 2;
  if (days <= 13) return 3;
  if (days <= 29) return 4;
  return 5;
}

export function getFlameTierLabel(tier: FlameTier, days: number): string {
  switch (tier) {
    case 0:
      return 'Cold Start (0d)';
    case 1:
      return `Kindling Ember (${days}d)`;
    case 2:
      return `Steady Flame (${days}d)`;
    case 3:
      return `Blazing Torch (${days}d)`;
    case 4:
      return `Roaring Inferno (${days}d)`;
    case 5:
      return `Legendary Plasma (${days}d)`;
  }
}

/**
 * StreakFire renders an animated SVG flame whose size, color palette,
 * inner tongues, and glow intensity scale dynamically with the user's streak.
 */
export const StreakFire: React.FC<StreakFireProps> = ({
  streakDays,
  activeToday = false,
  activeYesterday = false,
  size = 24,
  showBadge = false,
  className = '',
}) => {
  const tier = getFlameTier(streakDays);
  const tierLabel = getFlameTierLabel(tier, streakDays);

  // Status text for accessibility and tooltips
  const statusHint = activeToday
    ? 'Solved today! Flame fully fueled.'
    : activeYesterday
    ? 'Streak alive from yesterday! Solve today to keep the fire burning.'
    : streakDays > 0
    ? 'Active streak'
    : 'No active streak. Solve a problem to light the flame!';

  return (
    <div
      className={`streak-fire-container tier-${tier} ${activeToday ? 'is-active-today' : activeYesterday ? 'is-active-yesterday' : 'is-dormant'} ${className}`}
      title={`${tierLabel} · ${statusHint}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
      }}
      role="img"
      aria-label={`Streak fire: ${tierLabel}`}
    >
      {/* Background ambient radial glow for higher tiers */}
      {tier >= 2 && <div className={`streak-fire-glow tier-${tier}-glow`} />}

      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`streak-fire-svg tier-${tier}-svg`}
      >
        <defs>
          {/* Tier 0 Gradient - Dormant Slate / Ash */}
          <linearGradient id="cf-flame-grad-0" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#64748b" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#334155" stopOpacity="0.4" />
          </linearGradient>

          {/* Tier 1 Gradient - Kindling Amber */}
          <linearGradient id="cf-flame-grad-1" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>

          {/* Tier 2 Gradient - Steady Orange Flame */}
          <linearGradient id="cf-flame-grad-2" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="35%" stopColor="#fb923c" />
            <stop offset="75%" stopColor="#ea580c" />
            <stop offset="100%" stopColor="#c2410c" />
          </linearGradient>

          {/* Tier 3 Gradient - Blazing Torch */}
          <linearGradient id="cf-flame-grad-3" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="30%" stopColor="#f97316" />
            <stop offset="70%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#b91c1c" />
          </linearGradient>

          {/* Tier 4 Gradient - Roaring Inferno */}
          <linearGradient id="cf-flame-grad-4" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="25%" stopColor="#fde047" />
            <stop offset="55%" stopColor="#f97316" />
            <stop offset="85%" stopColor="#dc2626" />
            <stop offset="100%" stopColor="#7f1d1d" />
          </linearGradient>

          {/* Tier 5 Gradient - Legendary Cosmic Plasma */}
          <linearGradient id="cf-flame-grad-5" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="20%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#818cf8" />
            <stop offset="80%" stopColor="#c084fc" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>

          {/* Inner Core Gradients */}
          <linearGradient id="cf-flame-core-warm" x1="12" y1="10" x2="12" y2="21" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="60%" stopColor="#fef08a" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fb923c" stopOpacity="0.2" />
          </linearGradient>

          <linearGradient id="cf-flame-core-cosmic" x1="12" y1="9" x2="12" y2="21" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="40%" stopColor="#e0e7ff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {/* Outer Flame Silhouette */}
        <path
          className="flame-outer"
          d="M12 2C11.5 4 10 5.5 8.5 7C6.5 9 5 11.5 5 14.5C5 18.5 8.1 22 12 22C15.9 22 19 18.5 19 14.5C19 10.5 16 8 15 5.5C14.5 7.5 13.5 8.5 12 9C12 6.5 12.8 4 12 2Z"
          fill={`url(#cf-flame-grad-${tier})`}
        />

        {/* Mid-Tongue (Visible on Tiers >= 2) */}
        {tier >= 2 && (
          <path
            className="flame-mid"
            d="M12 7C11.2 8.5 10.5 9.8 9.2 11.2C8 12.5 7.2 14 7.2 16C7.2 18.8 9.3 21 12 21C14.7 21 16.8 18.8 16.8 16C16.8 13.2 14.8 11.5 14 9.5C13.6 11 13 11.8 12 12C12 10.2 12.5 8.5 12 7Z"
            fill={tier === 5 ? 'url(#cf-flame-core-cosmic)' : 'url(#cf-flame-core-warm)'}
            opacity={tier >= 4 ? 0.95 : 0.85}
          />
        )}

        {/* Intense Hot Inner Core / Heart (Visible on Tiers >= 3) */}
        {tier >= 3 && (
          <path
            className="flame-core"
            d="M12 12.5C11.3 13.7 10.5 14.5 10.5 16C10.5 17.5 11.2 19 12 19C12.8 19 13.5 17.5 13.5 16C13.5 14.8 12.7 13.8 12 12.5Z"
            fill="#ffffff"
            opacity={tier >= 4 ? 0.95 : 0.8}
          />
        )}

        {/* Sparks / Embers for Tier 4 & 5 */}
        {tier >= 4 && (
          <g className="flame-sparks">
            <circle cx="7" cy="8" r="0.9" fill={tier === 5 ? '#38bdf8' : '#fef08a'} className="spark spark-1" />
            <circle cx="17" cy="9" r="1.1" fill={tier === 5 ? '#c084fc' : '#fbbf24'} className="spark spark-2" />
            <circle cx="12" cy="1" r="0.8" fill="#ffffff" className="spark spark-3" />
          </g>
        )}
      </svg>

      {showBadge && (
        <span className={`streak-fire-badge tier-${tier}-badge`}>
          {streakDays}d
        </span>
      )}
    </div>
  );
};
