ALTER TABLE chat_meetings
  ADD COLUMN IF NOT EXISTS "participantMemberIds" jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "agentParticipants" jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "shareTranscriptWithAgents" boolean NOT NULL DEFAULT true;

UPDATE chat_meetings
SET "participantMemberIds" = conversations."memberIds",
    "agentParticipants" = jsonb_build_array(jsonb_build_object('agentId', chat_meetings."agentId", 'role', 'Participate as the meeting QA teammate.'))
FROM chat_conversations AS conversations
WHERE conversations.id = chat_meetings."conversationId"
  AND (chat_meetings."participantMemberIds" = '[]'::jsonb OR chat_meetings."agentParticipants" = '[]'::jsonb);
