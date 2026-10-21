import { z } from "zod";
export const PO_TOKEN_SERVICE_URL =
  "https://po-token.example.invalid";
export const poTokenResponseSchema = z
  .object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    poToken: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[A-Za-z0-9_-]+={0,2}$/),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type PoTokenResponse = z.infer<typeof poTokenResponseSchema>;
