import { QUOTA } from "@/lib/constants/quotas";
import { Workspace, db, eq, schema } from "@/lib/db";
import { stripeEnv } from "@/lib/env";
import { clerkClient } from "@clerk/nextjs";
import { TRPCError } from "@trpc/server";
import { newId } from "@unkey/id";
import Stripe from "stripe";
import { z } from "zod";
import { auth, t } from "../trpc";

export const workspaceRouter = t.router({
  create: t.procedure
    .use(auth)
    .input(
      z.object({
        name: z.string().min(1).max(50),
        slug: z.string().min(1).max(50).regex(/^[a-zA-Z0-9-_\.]+$/),
        plan: z.enum(["free", "pro"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let organizationId: string | null = null;
      const userId = ctx.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "unable to find userId" });
      }

      if (input.plan !== "free") {
        const org = await clerkClient.organizations.createOrganization({
          name: input.name,
          slug: input.slug,
          createdBy: userId,
        });
        organizationId = org.id;
      }

      const workspace: Workspace = {
        id: newId("workspace"),
        tenantId: organizationId ?? userId,
        name: input.name,
        slug: input.slug,
        plan: input.plan,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        internal: false,
        maxActiveKeys: QUOTA[input.plan].maxActiveKeys,
        maxVerifications: QUOTA[input.plan].maxVerifications,
        usageActiveKeys: null,
        usageVerifications: null,
        lastUsageUpdate: null,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        trialEnds: null,
      };
      await db.insert(schema.workspaces).values(workspace);

      if (stripeEnv) {
        const stripe = new Stripe(stripeEnv.STRIPE_SECRET_KEY, {
          apiVersion: "2022-11-15",
        });
        if (input.plan === "pro") {
          const customer = await stripe.customers.create({
            name: input.name,
          });
          workspace.stripeCustomerId = customer.id;
          await db
            .update(schema.workspaces)
            .set({ stripeCustomerId: customer.id })
            .where(eq(schema.workspaces.id, workspace.id));

          await stripe.subscriptions.create({
            customer: customer.id,
            items: [
              {
                // base
                price: stripeEnv.STRIPE_PRO_PLAN_PRICE_ID,
                quantity: 1,
              },
              {
                // additional keys
                price: stripeEnv.STRIPE_ACTIVE_KEYS_PRICE_ID,
              },
              {
                // additional verifications
                price: stripeEnv.STRIPE_KEY_VERIFICATIONS_PRICE_ID,
              },
            ],
            trial_period_days: 14,
          });
        }
      }

      return {
        workspace,
        organizationId,
      };
    }),
  get: t.procedure
    .use(auth)
    .input(
      z.object({
        slug: z.string(),
      }),
    )
    .query(({ input }) => {
      return db.query.workspaces.findFirst({
        where: eq(schema.workspaces.slug, input.slug),
        columns: {
          slug: true,
        },
      });
    }),
});
