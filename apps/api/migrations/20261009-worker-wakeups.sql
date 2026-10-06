BEGIN;

CREATE OR REPLACE FUNCTION notify_worker_work_available() RETURNS trigger AS $$
DECLARE
  channel_name text := TG_ARGV[0];
  watched_column text := TG_ARGV[1];
  queued_value text := TG_ARGV[2];
  new_value text;
  old_value text;
BEGIN
  new_value := to_jsonb(NEW) ->> watched_column;
  IF TG_OP = 'INSERT' THEN
  IF new_value = queued_value THEN
      PERFORM pg_notify(channel_name, jsonb_build_object(
        'table', TG_TABLE_NAME, 'id', to_jsonb(NEW)->>'id',
        'projectId', to_jsonb(NEW)->>'projectId', 'conversationId', to_jsonb(NEW)->>'conversationId',
        'meetingId', to_jsonb(NEW)->>'meetingId', 'agentType', to_jsonb(NEW)->>'agentType'
      )::text);
    END IF;
  ELSE
    old_value := to_jsonb(OLD) ->> watched_column;
    IF new_value = queued_value AND old_value IS DISTINCT FROM queued_value THEN
      PERFORM pg_notify(channel_name, jsonb_build_object(
        'table', TG_TABLE_NAME, 'id', to_jsonb(NEW)->>'id',
        'projectId', to_jsonb(NEW)->>'projectId', 'conversationId', to_jsonb(NEW)->>'conversationId',
        'meetingId', to_jsonb(NEW)->>'meetingId', 'agentType', to_jsonb(NEW)->>'agentType'
      )::text);
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_calendar_work_available() RETURNS trigger AS $$
DECLARE payload_row jsonb; project_id text; meeting_id text;
BEGIN
  payload_row := to_jsonb(NEW);
  IF TG_OP = 'DELETE' THEN payload_row := to_jsonb(OLD); END IF;
  meeting_id := COALESCE(payload_row->>'meetingId', CASE WHEN TG_TABLE_NAME = 'chat_meetings' THEN payload_row->>'id' END);
  project_id := payload_row->>'projectId';
  IF project_id IS NULL AND meeting_id IS NOT NULL THEN
    SELECT "projectId"::text INTO project_id FROM chat_meetings WHERE id = meeting_id::uuid;
  END IF;
  PERFORM pg_notify('calendar_work_available', jsonb_build_object(
    'table', TG_TABLE_NAME, 'id', payload_row->>'id', 'projectId', project_id,
    'conversationId', payload_row->>'conversationId', 'meetingId', meeting_id
  )::text);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_agent_task_change() RETURNS trigger AS $$
DECLARE task_row jsonb;
BEGIN
  task_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  PERFORM pg_notify('agent_task_available', jsonb_build_object(
    'table', TG_TABLE_NAME, 'id', task_row->>'id', 'agentType', task_row->>'agentType'
  )::text);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_source_job_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('source_event_available', jsonb_build_object(
    'jobId', NEW.id, 'sourceId', NEW.source_id,
    'data', jsonb_build_object(
      'status', NEW.status, 'currentStage', NEW."currentStage",
      'itemsProcessed', NEW."itemsProcessed", 'itemsTotal', NEW."itemsTotal",
      'errorMessage', NEW."errorMessage", 'completedAt', NEW."completedAt",
      'startedAt', NEW."startedAt", 'stages', NEW.stages, 'stats', NEW.stats
    )
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_source_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('source_change_available', jsonb_build_object(
    'sourceId', NEW.id,
    'update', jsonb_build_object(
      'name', NEW.name, 'type', NEW.type, 'status', NEW.status,
      'lastSync', NEW."lastSync", 'itemsCount', NEW."itemsCount",
      'syncMode', NEW."syncMode", 'errorMessage', NEW."errorMessage"
    )
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_work_available_notify ON chat_work;
CREATE TRIGGER chat_work_available_notify AFTER INSERT OR UPDATE OF status ON chat_work
  FOR EACH ROW EXECUTE FUNCTION notify_worker_work_available('chat_work_available', 'status', 'queued');

DROP TRIGGER IF EXISTS chat_delivery_available_notify ON chat_deliveries;
CREATE TRIGGER chat_delivery_available_notify AFTER INSERT OR UPDATE OF status ON chat_deliveries
  FOR EACH ROW EXECUTE FUNCTION notify_worker_work_available('chat_work_available', 'status', 'waiting');

DROP TRIGGER IF EXISTS chat_message_sent_notify ON chat_messages;
CREATE TRIGGER chat_message_sent_notify AFTER UPDATE OF status ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION notify_worker_work_available('chat_work_available', 'status', 'sent');

DROP TRIGGER IF EXISTS meeting_run_available_notify ON chat_meeting_runs;
CREATE TRIGGER meeting_run_available_notify AFTER INSERT OR UPDATE OF status ON chat_meeting_runs
  FOR EACH ROW EXECUTE FUNCTION notify_worker_work_available('chat_work_available', 'status', 'queued');

DROP TRIGGER IF EXISTS pipeline_job_available_notify ON sync_jobs;
CREATE TRIGGER pipeline_job_available_notify AFTER INSERT OR UPDATE OF status ON sync_jobs
  FOR EACH ROW EXECUTE FUNCTION notify_worker_work_available('pipeline_work_available', 'status', 'queued');

DROP TRIGGER IF EXISTS source_job_change_notify ON sync_jobs;
CREATE TRIGGER source_job_change_notify AFTER INSERT OR UPDATE ON sync_jobs
  FOR EACH ROW EXECUTE FUNCTION notify_source_job_change();

DROP TRIGGER IF EXISTS source_row_change_notify ON sources;
CREATE TRIGGER source_row_change_notify AFTER INSERT OR UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION notify_source_change();

DROP TRIGGER IF EXISTS calendar_schedule_changed_notify ON chat_calendars;
CREATE TRIGGER calendar_schedule_changed_notify AFTER INSERT OR UPDATE ON chat_calendars
  FOR EACH ROW EXECUTE FUNCTION notify_calendar_work_available();

DROP TRIGGER IF EXISTS calendar_event_insert_notify ON chat_calendar_events;
CREATE TRIGGER calendar_event_insert_notify AFTER INSERT ON chat_calendar_events
  FOR EACH ROW EXECUTE FUNCTION notify_calendar_work_available();

DROP TRIGGER IF EXISTS calendar_event_update_notify ON chat_calendar_events;
CREATE TRIGGER calendar_event_update_notify AFTER UPDATE ON chat_calendar_events
  FOR EACH ROW WHEN (
    OLD.status IS DISTINCT FROM NEW.status OR
    OLD."startsAt" IS DISTINCT FROM NEW."startsAt" OR
    OLD.skipped IS DISTINCT FROM NEW.skipped OR
    OLD."meetingId" IS DISTINCT FROM NEW."meetingId"
  ) EXECUTE FUNCTION notify_calendar_work_available();

DROP TRIGGER IF EXISTS meeting_calendar_state_changed_notify ON chat_meetings;
CREATE TRIGGER meeting_calendar_state_changed_notify AFTER INSERT OR UPDATE ON chat_meetings
  FOR EACH ROW EXECUTE FUNCTION notify_calendar_work_available();

DROP TRIGGER IF EXISTS meeting_entry_insert_notify ON chat_meeting_entries;
CREATE TRIGGER meeting_entry_insert_notify AFTER INSERT ON chat_meeting_entries
  FOR EACH ROW EXECUTE FUNCTION notify_calendar_work_available();

DROP TRIGGER IF EXISTS meeting_signal_insert_notify ON chat_meeting_signals;
CREATE TRIGGER meeting_signal_insert_notify AFTER INSERT ON chat_meeting_signals
  FOR EACH ROW EXECUTE FUNCTION notify_calendar_work_available();

DROP TRIGGER IF EXISTS meeting_peer_change_notify ON chat_meeting_peers;
CREATE TRIGGER meeting_peer_change_notify AFTER INSERT OR DELETE ON chat_meeting_peers
  FOR EACH ROW EXECUTE FUNCTION notify_calendar_work_available();

DROP TRIGGER IF EXISTS meeting_voice_state_notify ON chat_meeting_voice;
CREATE TRIGGER meeting_voice_state_notify AFTER UPDATE ON chat_meeting_voice
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.finalized IS DISTINCT FROM NEW.finalized OR OLD.seconds IS DISTINCT FROM NEW.seconds)
  EXECUTE FUNCTION notify_calendar_work_available();

DROP TRIGGER IF EXISTS chat_task_change_notify ON chat_tasks;
CREATE TRIGGER chat_task_change_notify AFTER INSERT OR UPDATE OR DELETE ON chat_tasks
  FOR EACH ROW EXECUTE FUNCTION notify_calendar_work_available();

DROP TRIGGER IF EXISTS agent_task_changed_notify ON agent_tasks;
CREATE TRIGGER agent_task_changed_notify AFTER INSERT OR UPDATE OR DELETE ON agent_tasks
  FOR EACH ROW EXECUTE FUNCTION notify_agent_task_change();

COMMIT;
