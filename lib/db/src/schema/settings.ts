import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("glowride_settings", {
  id: integer("id").primaryKey().default(1),
  unlockFeeXof: integer("unlock_fee_xof").notNull().default(100),
  pricePerMinuteXof: integer("price_per_minute_xof").notNull().default(50),
  durationsMinutes: integer("durations_minutes").array().notNull().default([30, 60, 120]),
  maximumAdvanceDays: integer("maximum_advance_days").notNull().default(60),
  cancellationCutoffMinutes: integer("cancellation_cutoff_minutes").notNull().default(10),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({
  updatedAt: true,
});
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
