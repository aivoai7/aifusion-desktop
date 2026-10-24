import { cn } from "@/lib/utils";

/**
 * Night Ops 字标：两道折线组成一个向上的 A，青绿主笔 + 青色副笔。
 * 顶栏与登录页共用同一枚，登录页只是放大一号。
 */
export function BrandMark({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-[7px] border border-[rgba(61,219,208,.3)]",
        className,
      )}
      style={{
        width: size,
        height: size,
        background:
          "linear-gradient(145deg, rgba(61,219,208,.22), rgba(76,201,240,.10))",
      }}
    >
      <svg
        width={size * 0.62}
        height={size * 0.62}
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M3.5 18.5 12 4.5l8.5 14"
          stroke="var(--action-bg)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8.2 18.5 12 12.2l3.8 6.3"
          stroke="var(--direct-fill)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity=".85"
        />
      </svg>
    </span>
  );
}
