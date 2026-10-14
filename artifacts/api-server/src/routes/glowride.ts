import { Webhook } from "fedapay";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateCheckoutBody,
  CreateCheckoutResponse,
  CreateLocationBody,
  CreateLocationResponse,
  CreateReservationBody,
  CreateReservationResponse,
  CreateSessionBody,
  CreateSessionResponse,
  GetAvailabilityQueryParams,
  GetAvailabilityResponse,
  GetMyProfileResponse,
  GetMyReservationParams,
  GetMyReservationResponse,
  GetPublicSettingsResponse,
  GetAdminOverviewResponse,
  GetAdminSettingsResponse,
  ListAdminLocationsResponse,
  ListAdminReservationsQueryParams,
  ListAdminReservationsResponse,
  ListAdminSessionsQueryParams,
  ListAdminSessionsResponse,
  ListAdminUsersResponse,
  ListMyReservationsResponse,
  ListSessionsQueryParams,
  ListSessionsResponse,
  ReceiveFedapayWebhookResponse,
  UpdateAdminSettingsBody,
  UpdateAdminUserRoleBody,
  UpdateAdminUserRoleParams,
  UpdateLocationBody,
  UpdateLocationParams,
  UpdateLocationResponse,
  UpdateSessionBody,
  UpdateSessionParams,
  UpdateSessionResponse,
  UpdateAdminReservationParams,
  UpdateAdminReservationBody,
  UpdateAdminReservationResponse,
  UpdateAdminUserRoleResponse,
} from "@workspace/api-zod";
import {
  db,
  locationsTable,
  reservationsTable,
  sessionsTable,
  settingsTable,
  usersTable,
} from "@workspace/db";
import type { AuthenticatedRequest } from "../middlewares/glowrideAuth";
import { requireAdmin, requireAuth } from "../middlewares/glowrideAuth";

const router: IRouter = Router();
const occupiedStatuses = ["pending_payment", "confirmed", "in_progress"] as const;
const paymentHoldMinutes = 10;
const minutesPerDay = 24 * 60;

function userId(req: Parameters<typeof requireAuth>[0]): string {
  return (req as AuthenticatedRequest).userId;
}

function minutes(value: string): number {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function timeValue(value: number): string {
  const safe = ((value % minutesPerDay) + minutesPerDay) % minutesPerDay;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function formatTime(value: string): string {
  return value.slice(0, 5);
}

async function settings() {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(settingsTable)
    .values({ id: 1, unlockFeeXof: 100, pricePerMinuteXof: 50, durationsMinutes: [30, 60, 120] })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [raced] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1)).limit(1);
  if (!raced) throw new Error("Les tarifs Glow Ride ne sont pas configurés.");
  return raced;
}

function publicSettings(row: Awaited<ReturnType<typeof settings>>) {
  return {
    currency: "XOF" as const,
    unlockFeeXof: row.unlockFeeXof,
    pricePerMinuteXof: row.pricePerMinuteXof,
    durationsMinutes: row.durationsMinutes,
    maximumAdvanceDays: row.maximumAdvanceDays,
    cancellationCutoffMinutes: row.cancellationCutoffMinutes,
    paymentMethods: ["mtn_momo", "moov_money"] as const,
  };
}

async function sessionDetail(id: string) {
  const [row] = await db
    .select({
      session: sessionsTable,
      location: locationsTable,
    })
    .from(sessionsTable)
    .innerJoin(locationsTable, eq(sessionsTable.locationId, locationsTable.id))
    .where(eq(sessionsTable.id, id))
    .limit(1);
  return row;
}

function sessionResponse(row: NonNullable<Awaited<ReturnType<typeof sessionDetail>>>) {
  return {
    id: row.session.id,
    locationId: row.location.id,
    city: row.location.city,
    locationName: row.location.name,
    address: row.location.address,
    meetingPoint: row.location.meetingPoint,
    date: row.session.sessionDate,
    opensAt: formatTime(row.session.opensAt),
    closesAt: formatTime(row.session.closesAt),
    scooterCount: row.session.scooterCount,
    durationsMinutes: row.session.durationsMinutes,
    active: row.session.active && row.location.active,
  };
}

async function reservationRows(whereClause?: ReturnType<typeof and>) {
  return db
    .select({ reservation: reservationsTable, session: sessionsTable, location: locationsTable })
    .from(reservationsTable)
    .innerJoin(sessionsTable, eq(reservationsTable.sessionId, sessionsTable.id))
    .innerJoin(locationsTable, eq(sessionsTable.locationId, locationsTable.id))
    .where(whereClause)
    .orderBy(desc(reservationsTable.createdAt));
}

function reservationResponse(row: Awaited<ReturnType<typeof reservationRows>>[number]) {
  const reservation = row.reservation;
  return {
    id: reservation.id,
    reference: reservation.reference,
    sessionId: reservation.sessionId,
    userId: reservation.userId,
    date: row.session.sessionDate,
    city: row.location.city,
    locationName: row.location.name,
    address: row.location.address,
    meetingPoint: row.location.meetingPoint,
    startTime: formatTime(reservation.startTime),
    endTime: formatTime(reservation.endTime),
    durationMinutes: reservation.durationMinutes,
    scooterCount: reservation.scooterCount,
    amountXof: reservation.amountXof,
    bookingStatus: reservation.bookingStatus,
    paymentStatus: reservation.paymentStatus,
    paymentMethod: reservation.paymentMethod,
    paymentReference: reservation.paymentReference,
    holdExpiresAt: reservation.holdExpiresAt?.toISOString() ?? null,
    createdAt: reservation.createdAt.toISOString(),
  };
}

async function occupiedQuantity(
  sessionId: string,
  startTime: string,
  durationMinutes: number,
  omitId?: string,
) {
  const start = minutes(startTime);
  const end = start + durationMinutes;
  const rows = await db
    .select()
    .from(reservationsTable)
    .where(and(eq(reservationsTable.sessionId, sessionId), inArray(reservationsTable.bookingStatus, [...occupiedStatuses])));
  return rows.reduce((total, row) => {
    if (row.id === omitId) return total;
    if (
      row.bookingStatus === "pending_payment" &&
      row.holdExpiresAt &&
      row.holdExpiresAt.getTime() <= Date.now()
    ) return total;
    const overlaps = minutes(row.startTime) < end && minutes(row.endTime) > start;
    return total + (overlaps ? row.scooterCount : 0);
  }, 0);
}

async function reservationById(id: string) {
  return db.select().from(reservationsTable).where(eq(reservationsTable.id, id)).limit(1);
}

router.get("/sessions", async (req, res): Promise<void> => {
  const query = ListSessionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = await db
    .select({ session: sessionsTable, location: locationsTable })
    .from(sessionsTable)
    .innerJoin(locationsTable, eq(sessionsTable.locationId, locationsTable.id))
    .where(and(
      eq(sessionsTable.active, true),
      eq(locationsTable.active, true),
      gte(sessionsTable.sessionDate, query.data.from),
      lte(sessionsTable.sessionDate, query.data.to),
    ))
    .orderBy(asc(sessionsTable.sessionDate), asc(sessionsTable.opensAt));
  res.json(ListSessionsResponse.parse(rows.map((row) => sessionResponse(row))));
});

router.get("/availability", async (req, res): Promise<void> => {
  const query = GetAvailabilityQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const row = await sessionDetail(query.data.sessionId);
  if (!row || !row.session.active || !row.location.active) {
    res.status(404).json({ error: "Cette disponibilité n’existe plus." });
    return;
  }
  const start = minutes(query.data.startTime);
  const end = start + query.data.durationMinutes;
  if (
    !row.session.durationsMinutes.includes(query.data.durationMinutes) ||
    start < minutes(row.session.opensAt) ||
    end > minutes(row.session.closesAt) ||
    end > minutesPerDay
  ) {
    res.status(200).json(GetAvailabilityResponse.parse({
      sessionId: row.session.id,
      startTime: query.data.startTime,
      durationMinutes: query.data.durationMinutes,
      requestedQuantity: query.data.quantity ?? 1,
      availableScooters: 0,
      priceXof: 0,
      available: false,
    }));
    return;
  }
  const occupied = await occupiedQuantity(row.session.id, query.data.startTime, query.data.durationMinutes);
  const remaining = Math.max(0, row.session.scooterCount - occupied);
  const requested = query.data.quantity ?? 1;
  const config = await settings();
  const price = (config.unlockFeeXof + config.pricePerMinuteXof * query.data.durationMinutes) * requested;
  res.json(GetAvailabilityResponse.parse({
    sessionId: row.session.id,
    startTime: query.data.startTime,
    durationMinutes: query.data.durationMinutes,
    requestedQuantity: requested,
    availableScooters: remaining,
    priceXof: price,
    available: remaining >= requested,
  }));
});

router.get("/settings/public", async (_req, res): Promise<void> => {
  res.json(GetPublicSettingsResponse.parse(publicSettings(await settings())));
});

router.get("/profile", requireAuth, async (req, res): Promise<void> => {
  const [profile] = await db.select().from(usersTable).where(eq(usersTable.id, userId(req))).limit(1);
  if (!profile) {
    res.status(404).json({ error: "Profil introuvable." });
    return;
  }
  res.json(GetMyProfileResponse.parse({
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    role: profile.role,
    createdAt: profile.createdAt.toISOString(),
  }));
});

router.get("/reservations", requireAuth, async (req, res): Promise<void> => {
  const rows = await reservationRows(eq(reservationsTable.userId, userId(req)));
  res.json(ListMyReservationsResponse.parse(rows.map(reservationResponse)));
});

router.post("/reservations", requireAuth, async (req, res): Promise<void> => {
  const body = CreateReservationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const request = body.data;
  const config = await settings();
  const created = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, request.sessionId))
      .for("update")
      .limit(1);
    if (!session || !session.active) return { error: "Session introuvable.", status: 404 as const };
    const start = minutes(request.startTime);
    const end = start + request.durationMinutes;
    if (
      !session.durationsMinutes.includes(request.durationMinutes) ||
      start < minutes(session.opensAt) ||
      end > minutes(session.closesAt) ||
      end > minutesPerDay
    ) return { error: "Durée ou horaire incompatible avec cette session.", status: 400 as const };
    const existing = await tx
      .select()
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.sessionId, session.id),
        inArray(reservationsTable.bookingStatus, [...occupiedStatuses]),
      ));
    const occupied = existing.reduce((total, booking) => {
      if (
        booking.bookingStatus === "pending_payment" &&
        booking.holdExpiresAt &&
        booking.holdExpiresAt.getTime() <= Date.now()
      ) return total;
      const overlaps = minutes(booking.startTime) < end && minutes(booking.endTime) > start;
      return total + (overlaps ? booking.scooterCount : 0);
    }, 0);
    if (session.scooterCount - occupied < request.scooterCount) {
      return { error: "Le stock vient de changer. Choisissez un autre créneau ou une quantité inférieure.", status: 409 as const };
    }
    const reference = `GR-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const [reservation] = await tx
      .insert(reservationsTable)
      .values({
        reference,
        sessionId: session.id,
        userId: userId(req),
        startTime: timeValue(start),
        endTime: timeValue(end),
        durationMinutes: request.durationMinutes,
        scooterCount: request.scooterCount,
        amountXof: (config.unlockFeeXof + config.pricePerMinuteXof * request.durationMinutes) * request.scooterCount,
        bookingStatus: "pending_payment",
        paymentStatus: "unpaid",
        holdExpiresAt: new Date(Date.now() + paymentHoldMinutes * 60_000),
      })
      .returning();
    return { reservation };
  });
  if ("error" in created) {
    res.status(created.status || 400).json({ error: created.error });
    return;
  }
  const rows = await reservationRows(and(
    eq(reservationsTable.id, created.reservation.id),
    eq(reservationsTable.userId, userId(req)),
  ));
  res.status(201).json(CreateReservationResponse.parse(reservationResponse(rows[0])));
});

router.get("/reservations/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetMyReservationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await reservationRows(and(
    eq(reservationsTable.id, params.data.id),
    eq(reservationsTable.userId, userId(req)),
  ));
  if (!rows[0]) {
    res.status(404).json({ error: "Réservation introuvable." });
    return;
  }
  res.json(GetMyReservationResponse.parse(reservationResponse(rows[0])));
});

router.post("/reservations/:id/cancel", requireAuth, async (req, res): Promise<void> => {
  const params = GetMyReservationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await reservationRows(and(
    eq(reservationsTable.id, params.data.id),
    eq(reservationsTable.userId, userId(req)),
  ));
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Réservation introuvable." });
    return;
  }
  if (["cancelled", "expired", "completed", "in_progress"].includes(row.reservation.bookingStatus)) {
    res.status(409).json({ error: "Cette réservation ne peut plus être annulée depuis votre espace." });
    return;
  }
  if (row.reservation.bookingStatus !== "pending_payment") {
    const config = await settings();
    const startAt = new Date(`${row.session.sessionDate}T${row.reservation.startTime}+01:00`).getTime();
    if (startAt - Date.now() < config.cancellationCutoffMinutes * 60_000) {
      res.status(409).json({ error: "Le délai d’annulation de ce créneau est dépassé." });
      return;
    }
  }
  await db.update(reservationsTable)
    .set({ bookingStatus: "cancelled", holdExpiresAt: null })
    .where(eq(reservationsTable.id, row.reservation.id));
  const updated = await reservationRows(and(eq(reservationsTable.id, row.reservation.id), eq(reservationsTable.userId, userId(req))));
  res.json(GetMyReservationResponse.parse(reservationResponse(updated[0])));
});

function fedapayBaseUrl() {
  return process.env.FEDAPAY_ENV === "live"
    ? "https://api.fedapay.com/v1"
    : "https://sandbox-api.fedapay.com/v1";
}

async function fedapayRequest(path: string, method: "GET" | "POST", body?: unknown) {
  const key = process.env.FEDAPAY_SECRET_KEY;
  if (!key) throw new Error("FedaPay n’est pas configuré.");
  const response = await fetch(`${fedapayBaseUrl()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : "FedaPay a refusé la transaction.";
    throw new Error(message);
  }
  return payload;
}

router.post("/reservations/:id/checkout", requireAuth, async (req, res): Promise<void> => {
  const params = GetMyReservationParams.safeParse(req.params);
  const body = CreateCheckoutBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .select({ reservation: reservationsTable, user: usersTable })
    .from(reservationsTable)
    .innerJoin(usersTable, eq(reservationsTable.userId, usersTable.id))
    .where(and(eq(reservationsTable.id, params.data.id), eq(reservationsTable.userId, userId(req))))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Réservation introuvable." });
    return;
  }
  if (row.reservation.bookingStatus !== "pending_payment" || row.reservation.amountXof < 1) {
    res.status(409).json({ error: "Cette réservation n’est pas payable." });
    return;
  }
  if (row.reservation.holdExpiresAt && row.reservation.holdExpiresAt.getTime() <= Date.now()) {
    await db.update(reservationsTable)
      .set({ bookingStatus: "expired", paymentStatus: "failed" })
      .where(eq(reservationsTable.id, row.reservation.id));
    res.status(409).json({ error: "Le délai de paiement a expiré. Veuillez réserver à nouveau." });
    return;
  }
  try {
    const secret = process.env.FEDAPAY_SECRET_KEY;
    if (!secret) {
      res.status(503).json({ error: "Le paiement FedaPay n’est pas encore configuré." });
      return;
    }
    let transactionId = row.reservation.providerTransactionId;
    if (!transactionId) {
      const phone = body.data.phoneNumber.replace(/[^\d+]/g, "");
      const digits = phone.replace(/\D/g, "");
      const national = digits.startsWith("229") ? digits.slice(3) : digits;
      const domain = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get("host")}`;
      const callbackUrl = new URL(
        `/reserve/confirmation?id=${encodeURIComponent(row.reservation.id)}&reference=${encodeURIComponent(row.reservation.reference)}`,
        domain,
      ).toString();
      const transactionPayload = await fedapayRequest("/transactions", "POST", {
        description: `Glow Ride ${row.reservation.reference}`,
        amount: row.reservation.amountXof,
        currency: { iso: "XOF" },
        callback_url: callbackUrl,
        mode: body.data.paymentMethod === "mtn_momo" ? "mtn_open" : "moov_open",
        custom_metadata: { reservation_id: row.reservation.id, reference: row.reservation.reference },
        customer: {
          email: row.user.email,
          firstname: row.user.fullName.split(" ")[0] || "Client",
          lastname: row.user.fullName.split(" ").slice(1).join(" ") || "Glow Ride",
          phone_number: { number: national, country: "bj" },
        },
      });
      const transaction = (transactionPayload.v1 ?? transactionPayload.transaction ?? transactionPayload) as Record<string, unknown>;
      if (!transaction.id) throw new Error("FedaPay n’a pas retourné de référence de transaction.");
      transactionId = String(transaction.id);
      await db.update(reservationsTable)
        .set({
          paymentMethod: body.data.paymentMethod,
          paymentStatus: "pending",
          providerTransactionId: transactionId,
          paymentReference: typeof transaction.reference === "string" ? transaction.reference : transactionId,
        })
        .where(eq(reservationsTable.id, row.reservation.id));
    }
    const tokenPayload = await fedapayRequest(`/transactions/${encodeURIComponent(transactionId)}/token`, "POST");
    const token = (tokenPayload.v1 ?? tokenPayload.token ?? tokenPayload) as Record<string, unknown>;
    const redirectUrl = typeof token.url === "string" ? token.url : typeof token.payment_url === "string" ? token.payment_url : null;
    if (!redirectUrl) throw new Error("FedaPay n’a pas retourné de lien de paiement.");
    res.json(CreateCheckoutResponse.parse({ redirectUrl, reference: row.reservation.reference }));
  } catch (error) {
    req.log.error({ err: error }, "FedaPay checkout could not be created");
    res.status(502).json({ error: error instanceof Error ? error.message : "Le paiement n’a pas pu être créé." });
  }
});

router.post("/payments/fedapay/webhook", async (req, res): Promise<void> => {
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  const signature = req.header("x-fedapay-signature");
  const endpointSecret = process.env.FEDAPAY_WEBHOOK_SECRET;
  if (!endpointSecret) {
    res.status(503).json({ error: "La vérification du webhook FedaPay n’est pas configurée." });
    return;
  }
  if (!rawBody || !signature) {
    res.status(400).json({ error: "Signature ou corps du webhook absent." });
    return;
  }
  let event: Record<string, unknown>;
  try {
    event = Webhook.constructEvent(rawBody, signature, endpointSecret) as unknown as Record<string, unknown>;
  } catch (error) {
    req.log.warn({ err: error }, "Rejected FedaPay webhook signature");
    res.status(401).json({ error: "Signature FedaPay invalide." });
    return;
  }
  const entity = (event.entity ?? (event.data as Record<string, unknown> | undefined)?.entity) as Record<string, unknown> | undefined;
  const transactionId = entity?.id == null ? null : String(entity.id);
  const eventName = typeof event.name === "string" ? event.name : "";
  if (!transactionId) {
    res.status(400).json({ error: "Événement FedaPay sans transaction." });
    return;
  }
  const [reservation] = await db.select().from(reservationsTable)
    .where(eq(reservationsTable.providerTransactionId, transactionId)).limit(1);
  if (!reservation) {
    res.status(200).json(ReceiveFedapayWebhookResponse.parse({ success: true, message: "Transaction sans réservation locale ignorée." }));
    return;
  }
  const approved = eventName === "transaction.approved";
  const failed = eventName === "transaction.canceled" || eventName === "transaction.declined";
  if (approved) {
    const amount = Number(entity?.amount);
    if (Number.isFinite(amount) && amount !== reservation.amountXof) {
      res.status(400).json({ error: "Le montant FedaPay ne correspond pas à la réservation." });
      return;
    }
    await db.update(reservationsTable)
      .set({ bookingStatus: "confirmed", paymentStatus: "paid", holdExpiresAt: null })
      .where(eq(reservationsTable.id, reservation.id));
  } else if (failed) {
    await db.update(reservationsTable)
      .set({ bookingStatus: "expired", paymentStatus: "failed", holdExpiresAt: null })
      .where(eq(reservationsTable.id, reservation.id));
  }
  res.json(ReceiveFedapayWebhookResponse.parse({ success: true, message: "Événement traité." }));
});

router.use("/admin", requireAuth, requireAdmin);

router.get("/admin/overview", async (_req, res): Promise<void> => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Porto-Novo" }).format(new Date());
  const all = await reservationRows();
  const recentReservations = all.slice(0, 6).map(reservationResponse);
  const [upcoming] = await db.select({ count: sql<number>`count(*)::int` }).from(sessionsTable)
    .where(and(eq(sessionsTable.active, true), gte(sessionsTable.sessionDate, today)));
  const overview = {
    todayReservations: all.filter((row) => row.session.sessionDate === today && row.reservation.bookingStatus !== "cancelled").length,
    pendingPayments: all.filter((row) => row.reservation.paymentStatus === "pending").length,
    scootersInUse: all.filter((row) => row.reservation.bookingStatus === "in_progress").reduce((count, row) => count + row.reservation.scooterCount, 0),
    upcomingSessions: upcoming?.count ?? 0,
    revenueTodayXof: all.filter((row) => row.session.sessionDate === today && row.reservation.paymentStatus === "paid").reduce((sum, row) => sum + row.reservation.amountXof, 0),
    recentReservations,
  };
  res.json(GetAdminOverviewResponse.parse(overview));
});

router.get("/admin/locations", async (_req, res): Promise<void> => {
  const rows = await db.select().from(locationsTable).orderBy(asc(locationsTable.city), asc(locationsTable.name));
  res.json(ListAdminLocationsResponse.parse(rows));
});

router.post("/admin/locations", async (req, res): Promise<void> => {
  const body = CreateLocationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [location] = await db.insert(locationsTable).values(body.data).returning();
  res.status(201).json(CreateLocationResponse.parse(location));
});

router.patch("/admin/locations/:id", async (req, res): Promise<void> => {
  const params = UpdateLocationParams.safeParse(req.params);
  const body = UpdateLocationBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [location] = await db.update(locationsTable).set(body.data)
    .where(eq(locationsTable.id, params.data.id)).returning();
  if (!location) {
    res.status(404).json({ error: "Lieu introuvable." });
    return;
  }
  res.json(UpdateLocationResponse.parse(location));
});

router.delete("/admin/locations/:id", async (req, res): Promise<void> => {
  const params = UpdateLocationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.update(locationsTable).set({ active: false }).where(eq(locationsTable.id, params.data.id));
  res.json({ success: true, message: "Lieu désactivé; son historique est conservé." });
});

router.get("/admin/sessions", async (req, res): Promise<void> => {
  const query = ListAdminSessionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const filters = [];
  if (query.data.from) filters.push(gte(sessionsTable.sessionDate, query.data.from));
  if (query.data.to) filters.push(lte(sessionsTable.sessionDate, query.data.to));
  const rows = await db.select({ session: sessionsTable, location: locationsTable })
    .from(sessionsTable).innerJoin(locationsTable, eq(sessionsTable.locationId, locationsTable.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(sessionsTable.sessionDate), asc(sessionsTable.opensAt));
  res.json(ListAdminSessionsResponse.parse(rows.map(sessionResponse)));
});

router.post("/admin/sessions", async (req, res): Promise<void> => {
  const body = CreateSessionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [location] = await db.select().from(locationsTable)
    .where(and(eq(locationsTable.id, body.data.locationId), eq(locationsTable.active, true))).limit(1);
  if (!location) {
    res.status(400).json({ error: "Choisissez un lieu actif." });
    return;
  }
  try {
    const [session] = await db.insert(sessionsTable).values({
      locationId: body.data.locationId,
      sessionDate: body.data.date,
      opensAt: body.data.opensAt,
      closesAt: body.data.closesAt,
      scooterCount: body.data.scooterCount,
      durationsMinutes: body.data.durationsMinutes,
      active: body.data.active ?? true,
    }).returning();
    res.status(201).json(CreateSessionResponse.parse(sessionResponse((await sessionDetail(session.id))!)));
  } catch (error) {
    req.log.warn({ err: error }, "Could not create Glow Ride session");
    res.status(409).json({ error: "Une session existe déjà pour ce lieu, cette date et cette heure." });
  }
});

router.patch("/admin/sessions/:id", async (req, res): Promise<void> => {
  const params = UpdateSessionParams.safeParse(req.params);
  const body = UpdateSessionBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const changes = body.data;
  const [updated] = await db.update(sessionsTable).set({
    ...(changes.locationId === undefined ? {} : { locationId: changes.locationId }),
    ...(changes.date === undefined ? {} : { sessionDate: changes.date }),
    ...(changes.opensAt === undefined ? {} : { opensAt: changes.opensAt }),
    ...(changes.closesAt === undefined ? {} : { closesAt: changes.closesAt }),
    ...(changes.scooterCount === undefined ? {} : { scooterCount: changes.scooterCount }),
    ...(changes.durationsMinutes === undefined ? {} : { durationsMinutes: changes.durationsMinutes }),
    ...(changes.active === undefined ? {} : { active: changes.active }),
  }).where(eq(sessionsTable.id, params.data.id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Session introuvable." });
    return;
  }
  const detail = await sessionDetail(updated.id);
  res.json(UpdateSessionResponse.parse(sessionResponse(detail!)));
});

router.delete("/admin/sessions/:id", async (req, res): Promise<void> => {
  const params = UpdateSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id)).limit(1);
  if (!session) {
    res.status(404).json({ error: "Session introuvable." });
    return;
  }
  const [active] = await db.select({ count: sql<number>`count(*)::int` }).from(reservationsTable)
    .where(and(eq(reservationsTable.sessionId, session.id), inArray(reservationsTable.bookingStatus, ["confirmed", "in_progress"])));
  if ((active?.count ?? 0) > 0) {
    res.status(409).json({ error: "Cette session comporte des réservations confirmées; désactivez-la après les avoir gérées." });
    return;
  }
  await db.update(sessionsTable).set({ active: false }).where(eq(sessionsTable.id, session.id));
  res.json({ success: true, message: "Session désactivée." });
});

router.get("/admin/reservations", async (req, res): Promise<void> => {
  const query = ListAdminReservationsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const filters = [];
  if (query.data.status) filters.push(eq(reservationsTable.bookingStatus, query.data.status));
  if (query.data.from) filters.push(gte(sessionsTable.sessionDate, query.data.from));
  if (query.data.to) filters.push(lte(sessionsTable.sessionDate, query.data.to));
  const rows = await db.select({ reservation: reservationsTable, session: sessionsTable, location: locationsTable })
    .from(reservationsTable)
    .innerJoin(sessionsTable, eq(reservationsTable.sessionId, sessionsTable.id))
    .innerJoin(locationsTable, eq(sessionsTable.locationId, locationsTable.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(reservationsTable.createdAt));
  res.json(ListAdminReservationsResponse.parse(rows.map(reservationResponse)));
});

router.patch("/admin/reservations/:id", async (req, res): Promise<void> => {
  const params = UpdateAdminReservationParams.safeParse(req.params);
  const body = UpdateAdminReservationBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [current] = await reservationById(params.data.id);
  if (!current) {
    res.status(404).json({ error: "Réservation introuvable." });
    return;
  }
  if (body.data.bookingStatus === "confirmed" && current.paymentStatus !== "paid") {
    res.status(409).json({ error: "Le paiement doit être confirmé avant de valider la réservation." });
    return;
  }
  await db.update(reservationsTable).set({ bookingStatus: body.data.bookingStatus })
    .where(eq(reservationsTable.id, current.id));
  const rows = await reservationRows(eq(reservationsTable.id, current.id));
  res.json(UpdateAdminReservationResponse.parse(reservationResponse(rows[0])));
});

router.get("/admin/settings", async (_req, res): Promise<void> => {
  res.json(GetAdminSettingsResponse.parse(publicSettings(await settings())));
});

router.patch("/admin/settings", async (req, res): Promise<void> => {
  const body = UpdateAdminSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const changes = body.data;
  const [updated] = await db.insert(settingsTable).values({
    id: 1,
    unlockFeeXof: changes.unlockFeeXof ?? 100,
    pricePerMinuteXof: changes.pricePerMinuteXof ?? 50,
    durationsMinutes: changes.durationsMinutes ?? [30, 60, 120],
    maximumAdvanceDays: changes.maximumAdvanceDays ?? 60,
    cancellationCutoffMinutes: changes.cancellationCutoffMinutes ?? 10,
  }).onConflictDoUpdate({
    target: settingsTable.id,
    set: {
      ...(changes.unlockFeeXof === undefined ? {} : { unlockFeeXof: changes.unlockFeeXof }),
      ...(changes.pricePerMinuteXof === undefined ? {} : { pricePerMinuteXof: changes.pricePerMinuteXof }),
      ...(changes.durationsMinutes === undefined ? {} : { durationsMinutes: changes.durationsMinutes }),
      ...(changes.maximumAdvanceDays === undefined ? {} : { maximumAdvanceDays: changes.maximumAdvanceDays }),
      ...(changes.cancellationCutoffMinutes === undefined ? {} : { cancellationCutoffMinutes: changes.cancellationCutoffMinutes }),
    },
  }).returning();
  res.json(GetAdminSettingsResponse.parse(publicSettings(updated)));
});

router.get("/admin/users", async (_req, res): Promise<void> => {
  const rows = await db.select().from(usersTable).orderBy(asc(usersTable.fullName));
  res.json(ListAdminUsersResponse.parse(rows.map((user) => ({
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  }))));
});

router.patch("/admin/users/:id/role", async (req, res): Promise<void> => {
  const params = UpdateAdminUserRoleParams.safeParse(req.params);
  const body = UpdateAdminUserRoleBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (body.data.role === "user") {
    const [adminCount] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable)
      .where(eq(usersTable.role, "admin"));
    const [target] = await db.select({ role: usersTable.role }).from(usersTable)
      .where(eq(usersTable.id, params.data.id)).limit(1);
    if (target?.role === "admin" && (adminCount?.count ?? 0) <= 1) {
      res.status(409).json({ error: "Le dernier administrateur ne peut pas être retiré." });
      return;
    }
  }
  const [updated] = await db.update(usersTable).set({ role: body.data.role })
    .where(eq(usersTable.id, params.data.id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Compte introuvable." });
    return;
  }
  res.json(UpdateAdminUserRoleResponse.parse({
    id: updated.id,
    email: updated.email,
    fullName: updated.fullName,
    role: updated.role,
    createdAt: updated.createdAt.toISOString(),
  }));
});

export default router;
