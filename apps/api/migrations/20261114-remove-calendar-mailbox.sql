BEGIN;

-- Removes the calendar-view / mailbox-OAuth-connect feature entirely (AgentCalendar,
-- CalendarOAuth, CalendarEvent). Meeting history itself is unaffected — it never lived in
-- these tables, and chat_meetings' own title/scheduledStart/scheduledEnd/attendees columns
-- (general-purpose, used by every meeting) are kept; only the calendar-dispatch linkage
-- column is dropped, since no meeting can originate from a calendar invite anymore.
ALTER TABLE chat_meetings DROP COLUMN IF EXISTS "calendarEventId";

DROP TABLE IF EXISTS chat_calendar_events;
DROP TABLE IF EXISTS chat_calendar_oauth;
DROP TABLE IF EXISTS chat_calendars;

COMMIT;
