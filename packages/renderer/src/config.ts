export type StyleName = "inspector" | "map" | "guide";
export const styleNames: StyleName[] = ["inspector", "map", "guide"];

export const colorKeys = ["path", "query", "header", "body", "ok", "err", "canvas", "paper", "ink"] as const;
export type ColorKey = (typeof colorKeys)[number];

export type RenderConfig = {
  style: StyleName;
  mode: "auto" | "light" | "dark";
  colors: Partial<Record<ColorKey, string>>;
  fonts: { sans?: string; mono?: string };
  motion: boolean;
  customCss?: string;
};

export type UserConfig = Partial<RenderConfig>;

export const defaultConfig: RenderConfig = {
  style: "inspector",
  mode: "auto",
  colors: {},
  fonts: {},
  motion: true,
};

export function resolveConfig(user: UserConfig = {}): RenderConfig {
  return {
    ...defaultConfig,
    ...user,
    colors: { ...user.colors },
    fonts: { ...user.fonts },
  };
}
