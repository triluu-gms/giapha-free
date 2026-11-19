import { Router } from 'express';
import { createMeeting, deleteMeeting, listMeetings, meetingSchema, updateMeeting } from '../meetings/meetings';
import { vietnamDate } from '../reminders/anniversary';
import { currentTreeId, requireTreeManager } from '../trees/access';

// Mounted at /api/trees/:treeId/meetings behind loadTree: members see the family
// meetings (họp họ, họp chi); the owner and admins add, change and remove them.
export const meetingsRouter = Router();

// GET /api/trees/:treeId/meetings -> [{ ...meeting, chiRoot, next }], soonest first
meetingsRouter.get('/', async (req, res) => {
  res.json(await listMeetings(currentTreeId(req), vietnamDate(new Date())));
});

// POST /api/trees/:treeId/meetings { title, chiRootId, repeat, calendar, month, day, date, time, place, note }
meetingsRouter.post('/', requireTreeManager, async (req, res) => {
  const input = meetingSchema.parse(req.body);
  const id = await createMeeting(currentTreeId(req), req.user!.id, input);
  res.status(201).json({ id });
});

// PUT /api/trees/:treeId/meetings/:id (the whole meeting, as for POST)
meetingsRouter.put('/:id', requireTreeManager, async (req, res) => {
  const input = meetingSchema.parse(req.body);
  await updateMeeting(currentTreeId(req), String(req.params.id), input);
  res.status(204).end();
});

meetingsRouter.delete('/:id', requireTreeManager, async (req, res) => {
  await deleteMeeting(currentTreeId(req), String(req.params.id));
  res.status(204).end();
});
