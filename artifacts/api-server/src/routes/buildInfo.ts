/**
 * GET /build-info — public, no auth required.
 *
 * Returns safe build/deploy identity information. No secrets, tokens, or
 * private environment variables are included. All unknown values return
 * "unknown". Safe to expose publicly on the internet.
 *
 * Registered in PUBLIC_ROUTES in auth.ts so it passes the session gate.
 */

import { Router, type IRouter } from "express";
import { getBuildInfo } from "../lib/buildInfo";

const router: IRouter = Router();

router.get("/build-info", (_req, res) => {
  res.json(getBuildInfo());
});

export default router;
