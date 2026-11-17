import { z } from "zod";
import { colorKeys, styleNames, type StyleName, type UserConfig } from "./config";

const color = z.string().regex(/^(#[0-9a-f]{3,8}|(rgb|hsl|oklch|color)\([^;{}]+\))$/i, "Expected a CSS color like #6e56cf");
const font = z.string().regex(/^[\w\s,"'-]+$/, "Expected a font family list");

/** Validates config from files and flags. Rendering itself doesn't need zod. */
export const UserConfigSchema = z
  .object({
    style: z.enum(styleNames as [StyleName, ...StyleName[]]),
    mode: z.enum(["auto", "light", "dark"]),
    colors: z.object(Object.fromEntries(colorKeys.map((k) => [k, color]))).partial().strict(),
    fonts: z.object({ sans: font, mono: font }).partial().strict(),
    motion: z.boolean(),
    customCss: z.string(),
  })
  .partial()
  .strict();

export function parseConfig(input: unknown): UserConfig {
  const result = UserConfigSchema.safeParse(input);
  if (!result.success) throw new ConfigError(z.prettifyError(result.error));
  return result.data as UserConfig;
}

export class ConfigError extends Error {}
