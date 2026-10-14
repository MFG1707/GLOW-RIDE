import { boolean, date, integer, pgTable, time, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { locationsTable } from "./locations";
import { z } from "zod/v4";

export const sessionsTable = pgTable(
  "glowride_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    locationId: uuid("location_id").notNull().references(() => locationsTable.id),
    sessionDate: date("session_date", { mode: "string" }).notNull(),
    opensAt: time("opens_at").notNull(),
    closesAt: time("closes_at").notNull(),
    scooterCount: integer("scooter_count").notNull(),
    durationsMinutes: integer("durations_minutes").array().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("glowride_session_date_place_hours_idx").on(table.sessionDate, table.locationId, table.opensAt)],
);

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
