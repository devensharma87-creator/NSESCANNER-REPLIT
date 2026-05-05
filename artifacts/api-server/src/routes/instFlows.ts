import { Router, type IRouter } from "express";
import {
  getFiiDiiMonthly,
  getParticipantOi,
  refreshFiiDii,
  refreshParticipantOi,
} from "../lib/instFlows";
import { getFnoBanList } from "../lib/fnoBanList";

const router: IRouter = Router();

router.get("/inst/fii-dii", async (req, res, next) => {
  try {
    const monthsBack = Math.min(36, Math.max(1, Number(req.query.months) || 12));
    const months = await getFiiDiiMonthly(monthsBack);
    res.json({ months, generatedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

router.get("/inst/participant-oi", async (req, res, next) => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const data = await getParticipantOi(date);
    if (!data) {
      res.json({ date: null, rows: [], availableDates: [], generatedAt: new Date().toISOString() });
      return;
    }
    res.json({ ...data, generatedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

router.get("/inst/fno-ban", async (_req, res, next) => {
  try {
    const list = await getFnoBanList();
    if (!list) {
      res.json({
        symbols: [],
        count: 0,
        sourceUrl: null,
        fetchedAt: null,
        cached: false,
        available: false,
      });
      return;
    }
    res.json({ ...list, available: true });
  } catch (err) {
    next(err);
  }
});

router.post("/inst/refresh", async (_req, res, next) => {
  try {
    const [fii, oi] = await Promise.all([
      refreshFiiDii(),
      refreshParticipantOi(15),
    ]);
    res.json({ ok: true, fiiDii: fii, participantOi: oi });
  } catch (err) {
    next(err);
  }
});

export default router;
