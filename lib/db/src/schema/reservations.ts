import {
  index,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

export const reservationsTable = pgTable(
  "glowride_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reference: text("reference").notNull(),
    sessionId: uuid("session_id").notNull().references(() => sessionsTable.id),
    userId: text("user_id").notNull().references(() => usersTable.id),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    scooterCount: integer("scooter_count").notNull(),
    amountXof: integer("amount_xof").notNull(),
    bookingStatus: text("booking_status", {
      enum: ["pending_payment", "confirmed", "in_progress", "completed", "cancelled", "expired"],
    }).notNull().default("pending_payment"),
    paymentStatus: text("payment_status", {
      enum: ["unpaid", "pending", "paid", "failed", "refunded"],
    }).notNull().default("unpaid"),
    paymentMethod: text("payment_method", { enum: ["mtn_momo", "moov_money"] }),
    paymentReference: text("payment_reference"),
    providerTransactionId: text("provider_transaction_id"),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("glowride_reservation_reference_idx").on(table.reference),
    index("glowride_reservation_user_created_idx").on(table.userId, table.createdAt),
    index("glowride_reservation_session_status_idx").on(table.sessionId, table.bookingStatus),
  ],
);

export const insertReservationSchema = createInsertSchema(reservationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertReservation = z.infer<typeof insertReservationSchema>;
export type ReservationRecord = typeof reservationsTable.$inferSelect;
