import { Router, type IRouter, type Request, type Response } from "express";
import Stripe from "stripe";
import { db, usersTable, creditTransactionsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router: IRouter = Router();

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key, { apiVersion: "2025-04-30.basil" });
}

export const CREDIT_PACKAGES = [
  {
    id: "pkg_15",
    credits: 15,
    price: 990, // in cents (R$ 9,90)
    currency: "brl",
    label: "15 créditos",
    labelEn: "15 credits",
  },
  {
    id: "pkg_60",
    credits: 60,
    price: 3490, // in cents (R$ 34,90)
    currency: "brl",
    label: "60 créditos",
    labelEn: "60 credits",
  },
];

router.get("/credits/packages", (_req: Request, res: Response) => {
  res.json(CREDIT_PACKAGES);
});

router.get("/credits/balance", requireAuth, async (req: Request, res: Response) => {
  try {
    const [user] = await db.select({ credits: usersTable.credits }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    res.json({ credits: user?.credits ?? 0 });
  } catch (err) {
    console.error("Balance error:", err);
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

router.get("/credits/history", requireAuth, async (req: Request, res: Response) => {
  try {
    const transactions = await db
      .select()
      .from(creditTransactionsTable)
      .where(eq(creditTransactionsTable.userId, req.user!.id))
      .orderBy(desc(creditTransactionsTable.createdAt))
      .limit(50);
    res.json(transactions);
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

router.post("/credits/checkout", requireAuth, async (req: Request, res: Response) => {
  try {
    const { packageId, successUrl, cancelUrl } = req.body as {
      packageId?: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    const pkg = CREDIT_PACKAGES.find((p) => p.id === packageId);
    if (!pkg) {
      res.status(400).json({ error: "Invalid package" });
      return;
    }

    const stripe = getStripe();
    const userId = req.user!.id;

    // Get or create Stripe customer
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { userId: String(userId), username: user.username },
      });
      customerId = customer.id;
      await db.update(usersTable).set({ stripeCustomerId: customerId }).where(eq(usersTable.id, userId));
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: pkg.currency,
            unit_amount: pkg.price,
            product_data: {
              name: pkg.labelEn,
              description: `${pkg.credits} credits for C3D STL Enhancer`,
            },
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: successUrl || `${req.headers.origin || ""}/?payment=success`,
      cancel_url: cancelUrl || `${req.headers.origin || ""}/?payment=cancelled`,
      metadata: {
        userId: String(userId),
        packageId: pkg.id,
        credits: String(pkg.credits),
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Failed to create checkout session", details: String(err) });
  }
});

// Webhook handler - must use raw body (registered separately in app.ts)
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn("STRIPE_WEBHOOK_SECRET not set, skipping webhook verification");
    res.status(400).json({ error: "Webhook secret not configured" });
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig as string, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    res.status(400).json({ error: "Invalid webhook signature" });
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const { userId, packageId, credits } = session.metadata || {};

    if (userId && credits) {
      const creditsToAdd = parseInt(credits, 10);
      const userIdNum = parseInt(userId, 10);

      // Check for duplicate webhook processing
      const existing = await db
        .select()
        .from(creditTransactionsTable)
        .where(eq(creditTransactionsTable.stripeSessionId, session.id))
        .limit(1);

      if (existing.length === 0) {
        // Atomic increment using drizzle SQL expression
        await db.update(usersTable).set({ credits: sql`${usersTable.credits} + ${creditsToAdd}` }).where(eq(usersTable.id, userIdNum));

        await db.insert(creditTransactionsTable).values({
          userId: userIdNum,
          amount: creditsToAdd,
          type: "purchase",
          description: `Purchased ${packageId} (${creditsToAdd} credits)`,
          stripeSessionId: session.id,
        });

        console.log(`Added ${creditsToAdd} credits to user ${userIdNum}`);
      }
    }
  }

  res.json({ received: true });
}

export default router;
