import { z } from "zod";

export const ReviewResultSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
