import { Router, type IRouter } from "express";
import adminAuthRouter from "./admin-auth";
import adminsRouter from "./admins";
import auditLogsRouter from "./audit-logs";
import customersRouter from "./customers";
import installationsRouter from "./installations";
import agentRouter from "./agent";
import agentUpdatesRouter from "./agent-updates";
import publicRouter from "./public";
import signupRouter from "./signup";
import feedbackRouter from "./feedback";
import releasesRouter from "./releases";
import dashboardRouter from "./dashboard";
import incidentsRouter from "./incidents";
import settingsRouter from "./settings";

const router: IRouter = Router();

// NOTE: customersRouter / installationsRouter / dashboardRouter each call
// router.use(requireAdminAuth) with no path, so they gate EVERY request that
// reaches them. Anything public (login, setup, agent) must be mounted
// before them - which is why adminAuthRouter and agentRouter stay first.
router.use(adminAuthRouter);
router.use(agentRouter);
router.use(agentUpdatesRouter);
router.use(publicRouter);
router.use(signupRouter);
router.use(adminsRouter);
router.use(auditLogsRouter);
router.use(incidentsRouter);
router.use(settingsRouter);
router.use(releasesRouter);
router.use(feedbackRouter);
router.use(customersRouter);
router.use(installationsRouter);
router.use(dashboardRouter);

export default router;
