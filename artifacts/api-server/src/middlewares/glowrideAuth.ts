import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { db, usersTable } from "@workspace/db";

export type AuthenticatedRequest = Request & { userId: string };

async function syncCurrentUser(userId: string) {
  const existing = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (existing[0]) {
    if (
      existing[0].role !== "admin" &&
      adminEmails.includes(existing[0].email.toLowerCase())
    ) {
      const [promoted] = await db.update(usersTable)
        .set({ role: "admin" })
        .where(eq(usersTable.id, userId))
        .returning();
      if (promoted) return promoted;
    }
    return existing[0];
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("Authentication service is not configured");

  const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) throw new Error("Unable to verify the account profile");
  const account = (await response.json()) as {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    primary_email_address_id?: string | null;
    email_addresses?: Array<{
      id: string;
      email_address: string;
      verification?: { status?: string | null } | null;
    }>;
  };
  if (account.id !== userId) throw new Error("The account profile did not match the session");

  const primaryAddress = account.email_addresses?.find(
    (entry) => entry.id === account.primary_email_address_id,
  );
  const primaryEmail = primaryAddress?.email_address;
  if (!primaryEmail || primaryAddress?.verification?.status !== "verified") {
    throw new Error("A verified email is required for this account");
  }

  const fullName = [account.first_name, account.last_name].filter(Boolean).join(" ");
  const role = adminEmails.includes(primaryEmail.toLowerCase()) ? "admin" : "user";
  const [user] = await db
    .insert(usersTable)
    .values({ id: userId, email: primaryEmail, fullName, role })
    .onConflictDoNothing()
    .returning();
  if (user) return user;
  const [racedUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!racedUser) throw new Error("Unable to create the account profile");
  return racedUser;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Connexion requise." });
    return;
  }
  try {
    await syncCurrentUser(userId);
    (req as AuthenticatedRequest).userId = userId;
    next();
  } catch (error) {
    req.log.error({ err: error }, "Unable to synchronize authenticated profile");
    res.status(503).json({ error: "Le profil du compte n’a pas pu être vérifié." });
  }
};

export const requireAdmin: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const userId = (req as AuthenticatedRequest).userId;
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.role, "admin")))
    .limit(1);
  if (!user) {
    res.status(403).json({ error: "Accès réservé à l’administration." });
    return;
  }
  next();
};
