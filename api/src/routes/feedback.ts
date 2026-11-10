import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, clientFeedbackTable, customersTable } from "@masterctl/db";
import { requireAdminAuth, requirePermission } from "../middlewares/auth";
import { writeMasterAuditLog } from "../lib/audit";

/** Master-side inbox for feedback customers send from inside the app. (Submission is in routes/agent.ts.) */
const router: IRouter = Router();

router.get("/feedback", requireAdminAuth, requirePermission("feedback.view"), async (req, res) => {
  const status = req.query.status;
  const rows = await db
    .select({
      id: clientFeedbackTable.id,
      customerId: clientFeedbackTable.customerId,
      customerName: customersTable.businessName,
      customerContact: customersTable.contactEmail,
      fromEmail: clientFeedbackTable.fromEmail,
      category: clientFeedbackTable.category,
      rating: clientFeedbackTable.rating,
      message: clientFeedbackTable.message,
      status: clientFeedbackTable.status,
      createdAt: clientFeedbackTable.createdAt,
    })
    .from(clientFeedbackTable)
    .innerJoin(customersTable, eq(customersTable.id, clientFeedbackTable.customerId))
    .where(status === "new" || status === "read" || status === "resolved" ? eq(clientFeedbackTable.status, status) : undefined)
    .orderBy(desc(clientFeedbackTable.createdAt))
    .limit(500);
  res.json(rows);
});

router.put("/feedback/:id", requireAdminAuth, requirePermission("feedback.manage"), async (req, res) => {
  const parsed = z.object({ status: z.enum(["new", "read", "resolved"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "status must be new, read or resolved" });
  const [row] = await db
    .update(clientFeedbackTable)
    .set({ status: parsed.data.status })
    .where(eq(clientFeedbackTable.id, Number(req.params.id)))
    .returning();
  if (!row) return res.status(404).json({ error: "Feedback not found" });
  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "feedback.update",
    entity: "feedback",
    entityId: row.id,
    description: `Marked feedback #${row.id} as ${row.status}`,
  });
  res.json(row);
});

export default router;
